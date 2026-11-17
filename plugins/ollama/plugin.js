(function () {
  const BASE_URL = "https://ollama.com"
  const BALANCE_URL = BASE_URL + "/api/balance"
  const ACCOUNT_URL = BASE_URL + "/api/me"
  const USAGE_URL = BASE_URL + "/api/usage?range=30d&group_by=model"
  const SESSION_MS = 5 * 60 * 60 * 1000
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000
  const DAY_MS = 24 * 60 * 60 * 1000
  const TIMEOUT_MS = 15000
  const KEY_REJECTED = "Invalid API key. Replace it in Settings → Accounts."
  const INVALID = "Ollama response invalid. Try again later."

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
  }

  function toNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value.trim())
      return Number.isFinite(n) ? n : null
    }
    return null
  }

  // null when absent, NaN when present but not a number of zero or more.
  function optionalCount(value) {
    if (value === undefined || value === null) return null
    const n = toNumber(value)
    return n !== null && n >= 0 ? n : NaN
  }

  function textField(obj, first, second) {
    const value = typeof obj[first] === "string" ? obj[first] : typeof obj[second] === "string" ? obj[second] : ""
    return value.trim() || null
  }

  function dollars(value) {
    return "$" + value.toFixed(2)
  }

  function tokensText(count) {
    if (count >= 1000000) return (count / 1000000).toFixed(1) + "M tokens"
    if (count >= 1000) return (count / 1000).toFixed(1) + "K tokens"
    return Math.round(count) + " tokens"
  }

  function utcDayStart(ms) {
    return Math.floor(ms / DAY_MS) * DAY_MS
  }

  function nowMs(ctx) {
    const ms = Date.parse(ctx.nowIso)
    return Number.isFinite(ms) ? ms : Date.now()
  }

  function apiKey(ctx) {
    const creds = ctx.account && ctx.account.credentials
    const key = creds && typeof creds.apiKey === "string" ? creds.apiKey.trim() : ""
    if (!key) throw "Sign in again in Settings → Accounts."
    return key
  }

  function send(ctx, key, method, url) {
    let resp
    try {
      resp = ctx.util.request({
        method,
        url,
        headers: { Authorization: "Bearer " + key, Accept: "application/json" },
        timeoutMs: TIMEOUT_MS,
      })
    } catch (e) {
      ctx.host.log.error("Ollama request exception: " + String(e))
      throw "Ollama request failed. Check your connection."
    }
    if (ctx.util.isAuthStatus(resp.status)) throw KEY_REJECTED
    if (resp.status < 200 || resp.status >= 300) {
      throw "Ollama request failed (HTTP " + resp.status + "). Try again later."
    }
    return resp
  }

  // Plan and email are best effort: a failed read names nothing, it does not fail the probe.
  function readAccount(ctx, key) {
    try {
      const json = ctx.util.tryParseJson(send(ctx, key, "POST", ACCOUNT_URL).bodyText)
      return isObject(json) ? json : null
    } catch (e) {
      ctx.host.log.warn("Ollama account read skipped: " + String(e))
      return null
    }
  }

  function legacyLine(ctx, entry, label, periodMs) {
    if (!isObject(entry)) return null
    const remaining = toNumber(entry.remaining_percent)
    if (remaining === null) return null
    const opts = {
      label,
      used: Math.min(100, Math.max(0, 100 - remaining)),
      limit: 100,
      format: { kind: "percent" },
    }
    const resetsAt = ctx.util.toIso(entry.resets_at)
    if (resetsAt) {
      opts.resetsAt = resetsAt
      opts.periodDurationMs = periodMs
    }
    return ctx.line.progress(opts)
  }

  function monthlyLine(ctx, included) {
    const allowance = toNumber(included.allowance_usd)
    const balance = toNumber(included.balance_usd)
    if (!(allowance > 0) || balance === null) return null
    const period = isObject(included.period) ? included.period : {}
    const from = ctx.util.toIso(period.from)
    const until = ctx.util.toIso(period.until)
    const opts = {
      label: "Monthly",
      used: Math.min(allowance, Math.max(0, allowance - balance)),
      limit: allowance,
      format: { kind: "dollars" },
    }
    if (until) opts.resetsAt = until
    if (from && until && Date.parse(until) > Date.parse(from)) {
      opts.periodDurationMs = Date.parse(until) - Date.parse(from)
    }
    return ctx.line.progress(opts)
  }

  function purchasedLine(ctx, purchased) {
    if (!isObject(purchased)) return null
    const balance = toNumber(purchased.balance_usd)
    if (balance === null) return null
    return ctx.line.text({ label: "Purchased Credits", value: dollars(Math.max(0, balance)) + " left" })
  }

  function balanceLines(ctx, json) {
    const included = isObject(json) && isObject(json.included) ? json.included : null
    if (!included) throw INVALID
    const lines = []
    const session = legacyLine(ctx, included.session, "Session", SESSION_MS)
    if (session) lines.push(session)
    const weekly = legacyLine(ctx, included.weekly, "Weekly", WEEK_MS)
    if (weekly) lines.push(weekly)
    const monthly = monthlyLine(ctx, included)
    if (monthly) lines.push(monthly)
    const purchased = purchasedLine(ctx, json.purchased)
    if (purchased) lines.push(purchased)
    if (lines.length === 0) throw INVALID
    return lines
  }

  // Every bucket keyed by its UTC day start, or null when any bucket is malformed, so a read is never partly used.
  function parseBuckets(buckets) {
    const byDay = {}
    for (const bucket of buckets) {
      if (!isObject(bucket)) return null
      const from = Date.parse(bucket.from)
      const until = Date.parse(bucket.until)
      if (!Number.isFinite(from) || !Number.isFinite(until)) return null
      if (from % DAY_MS !== 0 || from in byDay || until <= from || until > from + DAY_MS) return null
      const requests = optionalCount(bucket.request_count)
      if (requests === null || Number.isNaN(requests)) return null
      const usd = optionalCount(bucket.usage_usd)
      const input = optionalCount(bucket.input_tokens)
      const output = optionalCount(bucket.output_tokens)
      if (Number.isNaN(usd) || Number.isNaN(input) || Number.isNaN(output)) return null
      // Cached input is part of input, so tokens are input plus output.
      const tokens = input !== null && output !== null ? input + output : null
      byDay[from] = { requests, usd, tokens }
    }
    return byDay
  }

  // null when the history cannot be read; the balance lines still show.
  function usageDays(ctx, key) {
    let json
    try {
      json = ctx.util.tryParseJson(send(ctx, key, "GET", USAGE_URL).bodyText)
    } catch (e) {
      ctx.host.log.warn("Ollama usage history skipped: " + String(e))
      return null
    }
    const byDay =
      isObject(json) && json.granularity === "day" && Array.isArray(json.buckets) ? parseBuckets(json.buckets) : null
    if (!byDay) ctx.host.log.warn("Ollama usage history invalid; skipped")
    return byDay
  }

  // Sums the days from `fromOffset` to `toOffset` back from today (0 = today). A field no day reported stays null.
  function windowSum(byDay, today, fromOffset, toOffset) {
    const sum = { usd: null, tokens: null, requests: null }
    for (let k = fromOffset; k <= toOffset; k++) {
      const day = byDay[today - k * DAY_MS]
      if (!day) continue
      for (const field of ["usd", "tokens", "requests"]) {
        if (day[field] !== null) sum[field] = (sum[field] || 0) + day[field]
      }
    }
    return sum
  }

  function rangeLine(label, sum) {
    const opts = { label, value: sum.usd === null ? "No data" : dollars(sum.usd) }
    if (sum.tokens !== null) opts.subtitle = tokensText(sum.tokens)
    return opts
  }

  function historyLines(ctx, byDay) {
    const today = utcDayStart(nowMs(ctx))
    const lines = []
    // A legacy plan reports only requests, so dollar and token rows are left out.
    const reportsDollars = Object.keys(byDay).some((ms) => byDay[ms].usd !== null)
    if (reportsDollars) {
      lines.push(ctx.line.text(rangeLine("Today", windowSum(byDay, today, 0, 0))))
      lines.push(ctx.line.text(rangeLine("Yesterday", windowSum(byDay, today, 1, 1))))
      lines.push(ctx.line.text(rangeLine("Last 30 Days", windowSum(byDay, today, 0, 29))))
    }
    const requests = windowSum(byDay, today, 0, 29).requests
    lines.push(
      ctx.line.text({
        label: "Requests",
        value: requests === null ? "No data" : Math.round(requests) + " requests",
      })
    )
    return lines
  }

  function probe(ctx) {
    const key = apiKey(ctx)
    const balanceJson = ctx.util.tryParseJson(send(ctx, key, "GET", BALANCE_URL).bodyText)
    const lines = balanceLines(ctx, balanceJson)

    const account = readAccount(ctx, key)
    const email = account ? textField(account, "Email", "email") : null
    if (email) ctx.account.setLabel(email)
    const plan = account ? textField(account, "Plan", "plan") : null

    const byDay = usageDays(ctx, key)
    if (byDay) lines.push(...historyLines(ctx, byDay))

    const out = { lines }
    if (plan) out.plan = ctx.fmt.planLabel(plan)
    return out
  }

  globalThis.__openusage_plugin = { id: "ollama", probe }
})()
