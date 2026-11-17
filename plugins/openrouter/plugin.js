(function () {
  const BASE_URL = "https://openrouter.ai/api/v1"
  const CREDITS_URL = BASE_URL + "/credits"
  const KEY_URL = BASE_URL + "/key"
  const KEYS_URL = BASE_URL + "/keys?include_disabled=true&include_expired=true&offset="
  const ACTIVITY_URL = BASE_URL + "/activity"
  const KEYS_PAGE_SIZE = 100
  const MAX_KEYS_PAGES = 50
  const DAY_MS = 24 * 60 * 60 * 1000
  const TIMEOUT_MS = 15000
  const KEY_REJECTED = "Invalid API key. Replace it in Settings → Accounts."
  const INVALID = "OpenRouter response invalid. Try again later."

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

  function dollars(value) {
    return "$" + value.toFixed(2)
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

  function send(ctx, key, url) {
    try {
      return ctx.util.request({
        method: "GET",
        url,
        headers: { Authorization: "Bearer " + key, Accept: "application/json" },
        timeoutMs: TIMEOUT_MS,
      })
    } catch (e) {
      ctx.host.log.error("OpenRouter request exception: " + String(e))
      throw "OpenRouter request failed. Check your connection."
    }
  }

  function checkStatus(resp) {
    if (resp.status === 401 || resp.status === 403) throw KEY_REJECTED
    if (resp.status < 200 || resp.status >= 300) {
      throw "OpenRouter request failed (HTTP " + resp.status + "). Try again later."
    }
  }

  function getJson(ctx, key, url) {
    const resp = send(ctx, key, url)
    checkStatus(resp)
    const json = ctx.util.tryParseJson(resp.bodyText)
    if (!isObject(json)) throw INVALID
    return json
  }

  function dataOf(json) {
    if (!isObject(json.data)) throw INVALID
    return json.data
  }

  // Balance = credits bought minus spent. 403 means a workspace-scoped management key, which gets no balance.
  function balanceLine(ctx, key) {
    const resp = send(ctx, key, CREDITS_URL)
    if (resp.status === 403) return null
    checkStatus(resp)
    const data = dataOf(ctx.util.tryParseJson(resp.bodyText) || {})
    const credits = toNumber(data.total_credits)
    const usage = toNumber(data.total_usage)
    if (credits === null || usage === null) throw INVALID
    const balance = Math.max(0, Math.max(0, credits) - Math.max(0, usage))
    return ctx.line.text({ label: "Balance", value: dollars(balance) + " left" })
  }

  // Spend of one key: today, this week and this month, BYOK excluded.
  function keySpend(item) {
    if (!isObject(item)) throw INVALID
    const today = toNumber(item.usage_daily)
    const week = toNumber(item.usage_weekly)
    const month = toNumber(item.usage_monthly)
    if (today === null || week === null || month === null) throw INVALID
    return { today: Math.max(0, today), week: Math.max(0, week), month: Math.max(0, month) }
  }

  // Management key: spend summed over every listed key, disabled and expired included.
  function keysSpend(ctx, key) {
    const total = { today: 0, week: 0, month: 0 }
    for (let page = 0; page < MAX_KEYS_PAGES; page++) {
      const json = getJson(ctx, key, KEYS_URL + page * KEYS_PAGE_SIZE)
      if (!Array.isArray(json.data)) throw INVALID
      for (const item of json.data) {
        const spend = keySpend(item)
        total.today += spend.today
        total.week += spend.week
        total.month += spend.month
      }
      if (json.data.length < KEYS_PAGE_SIZE) return total
    }
    throw INVALID
  }

  // Yesterday and the 30 days before today, from the UTC activity rows. null when the read fails.
  function activityTotals(ctx, key, today) {
    let json
    try {
      json = getJson(ctx, key, ACTIVITY_URL)
    } catch (e) {
      ctx.host.log.warn("OpenRouter activity skipped: " + String(e))
      return null
    }
    const byDay = {}
    if (!Array.isArray(json.data)) {
      ctx.host.log.warn("OpenRouter activity response invalid; skipped")
      return null
    }
    for (const row of json.data) {
      const match = isObject(row) && typeof row.date === "string" ? row.date.match(/^(\d{4}-\d{2}-\d{2})/) : null
      const day = match ? Date.parse(match[1] + "T00:00:00Z") : NaN
      const usd = isObject(row) ? toNumber(row.usage) : null
      const prompt = isObject(row) ? toNumber(row.prompt_tokens) : null
      const completion = isObject(row) ? toNumber(row.completion_tokens) : null
      if (!Number.isFinite(day) || typeof row.model !== "string" || usd === null || usd < 0 || prompt === null || completion === null) {
        ctx.host.log.warn("OpenRouter activity response invalid; skipped")
        return null
      }
      byDay[day] = (byDay[day] || 0) + usd
    }
    let prior = 0
    for (let k = 1; k <= 30; k++) prior += byDay[today - k * DAY_MS] || 0
    return { yesterday: byDay[today - DAY_MS] || 0, prior }
  }

  // Period end and length in UTC, as OpenRouter resets them: midnight daily, Monday weekly, first of month monthly.
  function utcWindow(period, now) {
    const date = new Date(now)
    const dayStart = utcDayStart(now)
    let start
    let end
    if (period === "daily") {
      start = dayStart
      end = dayStart + DAY_MS
    } else if (period === "weekly") {
      start = dayStart - ((date.getUTCDay() + 6) % 7) * DAY_MS
      end = start + 7 * DAY_MS
    } else if (period === "monthly") {
      start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
      end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
    } else {
      return null
    }
    return { end: new Date(end).toISOString(), durationMs: end - start }
  }

  function progressLine(ctx, label, used, limit, format, period, now) {
    const opts = { label, used, limit, format }
    const window = utcWindow(period, now)
    if (window) {
      opts.resetsAt = window.end
      opts.periodDurationMs = window.durationMs
    }
    return ctx.line.progress(opts)
  }

  // Key Limit, Budget and Free Requests, each only when OpenRouter reports one.
  function keyLines(ctx, data, now) {
    const lines = []

    const limit = toNumber(data.limit)
    if (limit !== null && limit > 0) {
      const remaining = toNumber(data.limit_remaining)
      if (remaining === null) throw INVALID
      lines.push(
        progressLine(ctx, "Key Limit", Math.max(0, limit - Math.max(0, remaining)), limit, { kind: "dollars" }, data.limit_reset, now)
      )
    }

    const budget = isObject(data.effective_budget) ? data.effective_budget : null
    const budgetLimit = budget ? toNumber(budget.limit_usd) : null
    if (budget && budgetLimit !== null && budgetLimit > 0) {
      const spend = toNumber(budget.spend_usd)
      if (spend === null) throw INVALID
      lines.push(
        progressLine(ctx, "Budget", Math.max(0, spend), budgetLimit, { kind: "dollars" }, budget.reset_interval, now)
      )
    }

    const free = isObject(data.free_model_daily_requests) ? data.free_model_daily_requests : null
    const freeLimit = free ? toNumber(free.limit) : null
    if (free && freeLimit !== null && freeLimit > 0) {
      const used = toNumber(free.used)
      if (used === null) throw INVALID
      lines.push(
        progressLine(ctx, "Free Requests", Math.max(0, used), freeLimit, { kind: "count", suffix: "requests" }, "daily", now)
      )
    }

    return lines
  }

  function probe(ctx) {
    const key = apiKey(ctx)
    const data = dataOf(getJson(ctx, key, KEY_URL))
    if (typeof data.is_management_key !== "boolean") throw INVALID
    const now = nowMs(ctx)
    const today = utcDayStart(now)
    const plan = typeof data.is_free_tier === "boolean" ? (data.is_free_tier ? "Free" : "Pay-as-you-go") : null
    const lines = []

    if (data.is_management_key) {
      const balance = balanceLine(ctx, key)
      if (balance) lines.push(balance)
      const spend = keysSpend(ctx, key)
      const activity = activityTotals(ctx, key, today)
      lines.push(ctx.line.text({ label: "Today", value: dollars(spend.today) }))
      if (activity) lines.push(ctx.line.text({ label: "Yesterday", value: dollars(activity.yesterday) }))
      lines.push(ctx.line.text({ label: "This Week", value: dollars(spend.week) }))
      lines.push(ctx.line.text({ label: "This Month", value: dollars(spend.month) }))
      if (activity) lines.push(ctx.line.text({ label: "Prior 30 Days", value: dollars(activity.prior) }))
    } else {
      // A standard key reads its own spend only; its Yesterday and Prior 30 Days read $0.
      const spend = keySpend(data)
      lines.push(ctx.line.text({ label: "Today", value: dollars(spend.today) }))
      lines.push(ctx.line.text({ label: "Yesterday", value: dollars(0) }))
      lines.push(ctx.line.text({ label: "This Week", value: dollars(spend.week) }))
      lines.push(ctx.line.text({ label: "This Month", value: dollars(spend.month) }))
      lines.push(ctx.line.text({ label: "Prior 30 Days", value: dollars(0) }))
    }

    lines.push(...keyLines(ctx, data, now))

    const out = { lines }
    if (plan) out.plan = plan
    return out
  }

  globalThis.__openusage_plugin = { id: "openrouter", probe }
})()
