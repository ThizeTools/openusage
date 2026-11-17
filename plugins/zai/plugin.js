(function () {
  const PROVIDER_ID = "zai"
  const SUBSCRIPTION_URL = "https://api.z.ai/api/biz/subscription/list"
  const QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit"
  const SIGN_IN_AGAIN = "Sign in again in Settings → Accounts."
  const HOUR_MS = 60 * 60 * 1000
  const DAY_MS = 24 * HOUR_MS
  const WEEK_MS = 7 * DAY_MS
  const MONTH_MS = 30 * DAY_MS

  function numberOf(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value)
      return Number.isFinite(n) ? n : null
    }
    return null
  }

  function clampPercent(value) {
    return Math.min(Math.max(value, 0), 100)
  }

  function isoFromMs(ms) {
    if (ms === null) return null
    const d = new Date(ms)
    return Number.isFinite(d.getTime()) ? d.toISOString() : null
  }

  function unitMs(unit) {
    switch (unit) {
      case 3: return HOUR_MS
      case 4: return DAY_MS
      case 5: return MONTH_MS
      case 6: return WEEK_MS
      default: return null
    }
  }

  function readApiKey(ctx) {
    const creds = ctx.account && ctx.account.credentials
    if (!creds || typeof creds.apiKey !== "string" || !creds.apiKey.trim()) {
      throw SIGN_IN_AGAIN
    }
    return creds.apiKey.trim()
  }

  function fetchQuota(ctx, apiKey) {
    let resp
    try {
      resp = ctx.util.request({
        method: "GET",
        url: QUOTA_URL,
        headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" },
        timeoutMs: 10000,
      })
    } catch (e) {
      ctx.host.log.error("usage request failed: " + String(e))
      throw "Usage request failed. Check your connection."
    }
    if (ctx.util.isAuthStatus(resp.status)) throw SIGN_IN_AGAIN
    if (resp.status < 200 || resp.status >= 300) {
      throw "Usage request failed (HTTP " + resp.status + "). Try again later."
    }
    const body = ctx.util.tryParseJson(resp.bodyText)
    if (!body || typeof body !== "object") throw "Usage response invalid. Try again later."
    return body
  }

  // Soft lookup: the plan name. A failure is logged and the plan is left out.
  function fetchPlan(ctx, apiKey) {
    try {
      const resp = ctx.util.request({
        method: "GET",
        url: SUBSCRIPTION_URL,
        headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" },
        timeoutMs: 10000,
      })
      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("subscription request failed: HTTP " + resp.status)
        return null
      }
      const body = ctx.util.tryParseJson(resp.bodyText)
      const list = body && Array.isArray(body.data) ? body.data : []
      const first = list[0]
      const name = first && typeof first.productName === "string" ? first.productName.trim() : ""
      return name || null
    } catch (e) {
      ctx.host.log.warn("subscription request failed: " + String(e))
      return null
    }
  }

  function classifyWindow(entry) {
    const unit = numberOf(entry.unit)
    const count = numberOf(entry.number)
    if (unit === null || count === null || count <= 0) {
      throw "Usage response invalid. Try again later."
    }
    const base = unitMs(unit)
    if (base === null) return null
    const periodMs = base * count
    return { label: periodMs < DAY_MS ? "Session" : "Weekly", periodMs: periodMs }
  }

  function percentLine(ctx, entry, label, periodMs) {
    const raw = numberOf(entry.percentage)
    if (raw === null) throw "Usage response invalid. Try again later."
    const resetsAt = isoFromMs(numberOf(entry.nextResetTime))
    return ctx.line.progress({
      label: label,
      used: clampPercent(raw),
      limit: 100,
      format: { kind: "percent" },
      resetsAt: resetsAt,
      periodDurationMs: periodMs,
    })
  }

  function findLimit(limits, type) {
    for (let i = 0; i < limits.length; i++) {
      const item = limits[i]
      if (item && (item.type === type || item.name === type)) return item
    }
    return null
  }

  function quotaLines(ctx, body) {
    if (body.success === false && typeof body.msg === "string" &&
        body.msg.toLowerCase().indexOf("coding plan") !== -1) {
      throw "No active GLM Coding Plan. Subscribe at z.ai/subscribe to see usage."
    }
    if (body.success === false && body.code === 401) throw SIGN_IN_AGAIN

    const container = body.data !== undefined ? body.data : body
    if (!container || typeof container !== "object") throw "Usage response invalid. Try again later."
    const limits = container.limits
    if (!Array.isArray(limits)) throw "Usage response invalid. Try again later."
    if (limits.length === 0) return []

    const lines = []
    for (let i = 0; i < limits.length; i++) {
      const entry = limits[i]
      const type = entry && (entry.type || entry.name)
      if (type !== "TOKENS_LIMIT" && type !== "CREDIT_LIMIT") continue
      const window = classifyWindow(entry)
      if (!window) continue
      lines.push(percentLine(ctx, entry, window.label, window.periodMs))
    }

    const web = findLimit(limits, "TIME_LIMIT")
    if (web) {
      const used = numberOf(web.currentValue)
      const limit = numberOf(web.usage)
      if (used === null || limit === null || used < 0 || limit < 0) {
        throw "Usage response invalid. Try again later."
      }
      if (limit === 0) {
        ctx.host.log.warn("web search limit is 0; Web Searches line skipped")
      } else {
        lines.push(ctx.line.progress({
          label: "Web Searches",
          used: used,
          limit: limit,
          format: { kind: "count", suffix: "searches" },
          resetsAt: isoFromMs(numberOf(web.nextResetTime)),
          periodDurationMs: MONTH_MS,
        }))
      }
    }
    return lines
  }

  function probe(ctx) {
    const apiKey = readApiKey(ctx)
    const body = fetchQuota(ctx, apiKey)
    const lines = quotaLines(ctx, body)
    const plan = fetchPlan(ctx, apiKey)
    return plan ? { plan: plan, lines: lines } : { lines: lines }
  }

  globalThis.__openusage_plugin = { id: PROVIDER_ID, probe: probe }
})()
