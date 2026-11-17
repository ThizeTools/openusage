(function () {
  const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
  const TOKEN_URL = "https://auth.openai.com/oauth/token"
  const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
  const REFRESH_MARGIN_MS = 5 * 60 * 1000
  const SESSION_MS = 5 * 60 * 60 * 1000
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000
  // OpenAI sells ChatGPT credits at 4 cents each; the usage API reports only the count.
  const CREDIT_USD = 0.04
  const ERR_SIGN_IN = "Sign in again in Settings → Accounts."
  const REFRESH_DENIED = ["invalid_grant", "refresh_token_expired", "refresh_token_reused", "refresh_token_invalidated"]

  function isObj(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
  }

  function toNum(value) {
    if (typeof value === "string" && value.trim() !== "") value = Number(value)
    return typeof value === "number" && Number.isFinite(value) ? value : null
  }

  function send(ctx, opts) {
    try {
      return ctx.util.request(opts)
    } catch (e) {
      ctx.host.log.error("request failed: " + String(e))
      throw "Network error. Check your connection."
    }
  }

  function readCredentials(ctx) {
    const creds = ctx.account && ctx.account.credentials
    if (!isObj(creds) || typeof creds.access_token !== "string" || !creds.access_token) throw ERR_SIGN_IN
    return creds
  }

  function errorCode(ctx, text) {
    const json = ctx.util.tryParseJson(text)
    if (!isObj(json)) return null
    if (typeof json.error === "string") return json.error
    if (isObj(json.error) && typeof json.error.code === "string") return json.error.code
    return typeof json.code === "string" ? json.code : null
  }

  // expires_in wins; without it the access token's own exp is used; else keep the old value.
  function expiryFrom(ctx, json, previous) {
    if (typeof json.expires_in === "number") return Date.now() + json.expires_in * 1000
    const claims = ctx.jwt.decodePayload(json.access_token)
    if (isObj(claims) && typeof claims.exp === "number") return claims.exp * 1000
    return previous
  }

  // Merges the token response over the stored credentials and saves the whole object.
  function saveRefreshed(ctx, creds, resp) {
    const code = errorCode(ctx, resp.bodyText)
    if ([400, 401, 403].indexOf(resp.status) >= 0 && REFRESH_DENIED.indexOf(code) >= 0) {
      ctx.host.log.warn("token refresh refused: " + code)
      throw ERR_SIGN_IN
    }
    if (resp.status < 200 || resp.status > 299) {
      throw "Token refresh failed (HTTP " + resp.status + "). Try again later."
    }
    const json = ctx.util.tryParseJson(resp.bodyText)
    if (!isObj(json) || typeof json.access_token !== "string" || !json.access_token) {
      throw "Token refresh response invalid. Try again later."
    }
    const merged = Object.assign({}, creds, json)
    merged.expiresAt = expiryFrom(ctx, json, creds.expiresAt)
    ctx.account.saveCredentials(JSON.stringify(merged))
    return merged
  }

  function refreshCodex(ctx, creds) {
    const resp = send(ctx, {
      method: "POST",
      url: TOKEN_URL,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      bodyText:
        "grant_type=refresh_token" +
        "&client_id=" + encodeURIComponent(CLIENT_ID) +
        "&refresh_token=" + encodeURIComponent(creds.refresh_token),
      timeoutMs: 15000,
    })
    return saveRefreshed(ctx, creds, resp)
  }

  // Refreshes ~5 min before expiry. If the refresh fails while the token is still valid, keep it (logged).
  function refreshIfDue(ctx, creds, refresh) {
    const nowMs = Date.now()
    if (!creds.refresh_token || typeof creds.expiresAt !== "number") return creds
    if (creds.expiresAt - REFRESH_MARGIN_MS > nowMs) return creds
    try {
      return refresh(creds)
    } catch (e) {
      if (creds.expiresAt > nowMs) {
        ctx.host.log.warn("early token refresh failed; keeping current token: " + String(e))
        return creds
      }
      throw e
    }
  }

  function accountIdOf(ctx, token) {
    const claims = ctx.jwt.decodePayload(token)
    const auth = isObj(claims) ? claims["https://api.openai.com/auth"] : null
    const id = isObj(auth) ? auth.chatgpt_account_id : null
    return typeof id === "string" && id ? id : null
  }

  function usageHeaders(ctx, token) {
    const headers = {
      Authorization: "Bearer " + token,
      Accept: "application/json",
      "User-Agent": "OpenUsage",
    }
    const accountId = accountIdOf(ctx, token)
    if (accountId) headers["ChatGPT-Account-Id"] = accountId
    return headers
  }

  function formatCodexPlan(value) {
    if (typeof value !== "string") return null
    const raw = value.trim()
    if (!raw) return null
    switch (raw.toLowerCase()) {
      case "prolite": return "Pro 100"
      case "pro": return "Pro 200"
      case "promax": return "Pro 500"
      case "self_serve_business_prolite": return "Business Premium"
      default:
        return raw
          .split("_")
          .filter(Boolean)
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ")
    }
  }

  function percentLine(ctx, label, used, resetsAt, periodMs) {
    const opts = { label: label, used: used, limit: 100, format: { kind: "percent" }, periodDurationMs: periodMs }
    if (resetsAt) opts.resetsAt = resetsAt
    return ctx.line.progress(opts)
  }

  function periodOf(win) {
    const seconds = win ? toNum(win.limit_window_seconds) : null
    return seconds === null ? null : Math.round(seconds * 1000)
  }

  function resetOf(win, nowMs) {
    const at = toNum(win.reset_at)
    if (at !== null) return new Date(at * 1000).toISOString()
    const after = toNum(win.reset_after_seconds)
    return after !== null ? new Date(nowMs + after * 1000).toISOString() : null
  }

  // A window slot; a header-only percent (x-codex-*-used-percent) stands in when the window is missing.
  function slotOf(win, headerPercent) {
    const value = isObj(win) ? win : headerPercent === null ? null : {}
    if (value === null) return null
    const used = toNum(value.used_percent) !== null ? toNum(value.used_percent) : headerPercent
    return { win: value, used: used }
  }

  // Each meter takes the window whose own duration matches it; otherwise the window in its own slot,
  // when that window's duration is missing or unfamiliar.
  function pushWindowMeters(ctx, lines, rateLimit, meters, headers, nowMs) {
    const slots = [
      slotOf(rateLimit ? rateLimit.primary_window : null, headers ? toNum(headers["x-codex-primary-used-percent"]) : null),
      slotOf(rateLimit ? rateLimit.secondary_window : null, headers ? toNum(headers["x-codex-secondary-used-percent"]) : null),
    ]
    const familiar = meters.map((meter) => meter.periodMs)
    meters.forEach((meter, index) => {
      const exact = slots.find((slot) => slot && periodOf(slot.win) === meter.periodMs)
      const own = slots[index]
      const ownPeriod = own ? periodOf(own.win) : null
      const fallback = own && (ownPeriod === null || familiar.indexOf(ownPeriod) < 0) ? own : null
      const chosen = exact || fallback
      if (!chosen || chosen.used === null) return
      const periodMs = periodOf(chosen.win) !== null ? periodOf(chosen.win) : meter.periodMs
      lines.push(percentLine(ctx, meter.label, chosen.used, resetOf(chosen.win, nowMs), periodMs))
    })
  }

  function sparkEntry(body) {
    const list = Array.isArray(body.additional_rate_limits) ? body.additional_rate_limits : []
    return list.find((entry) => isObj(entry) && [entry.limit_name, entry.metered_feature].some((name) =>
      typeof name === "string" && name.toLowerCase().indexOf("spark") >= 0
    )) || null
  }

  function headerFlag(value) {
    if (value === "true") return true
    if (value === "false") return false
    return null
  }

  function creditsLine(ctx, body, headers) {
    const credits = isObj(body.credits) ? body.credits : {}
    const flag = typeof credits.has_credits === "boolean" ? credits.has_credits : headerFlag(headers["x-codex-credits-has-credits"])
    if (flag === false) return null
    const balance = toNum(credits.balance) !== null ? toNum(credits.balance) : toNum(headers["x-codex-credits-balance"])
    if (balance === null) return null
    const count = Math.max(0, Math.floor(balance))
    return ctx.line.text({
      label: "Extra Usage",
      value: "$" + (count * CREDIT_USD).toFixed(2),
      subtitle: count + " credits",
    })
  }

  function creditLimitLine(ctx, body) {
    const spend = isObj(body.spend_control) ? body.spend_control : null
    const limit = spend && isObj(spend.individual_limit) ? spend.individual_limit : null
    if (!limit) return null
    const used = toNum(limit.used)
    const cap = toNum(limit.limit)
    if (used === null || used < 0 || cap === null || cap < 0) return null
    const opts = { label: "Credit Limit", used: used, limit: cap, format: { kind: "count", suffix: "credits" } }
    const resetAt = toNum(limit.reset_at)
    if (resetAt !== null) opts.resetsAt = new Date(resetAt * 1000).toISOString()
    return ctx.line.progress(opts)
  }

  function usageLines(ctx, body, headers, nowMs) {
    const lines = []
    const rateLimit = isObj(body.rate_limit) ? body.rate_limit : null
    pushWindowMeters(ctx, lines, rateLimit, [
      { label: "Session", periodMs: SESSION_MS },
      { label: "Weekly", periodMs: WEEK_MS },
    ], headers, nowMs)

    const spark = sparkEntry(body)
    if (spark && isObj(spark.rate_limit)) {
      pushWindowMeters(ctx, lines, spark.rate_limit, [
        { label: "Spark", periodMs: SESSION_MS },
        { label: "Spark Weekly", periodMs: WEEK_MS },
      ], null, nowMs)
    }

    const credits = creditsLine(ctx, body, headers)
    if (credits) lines.push(credits)
    const creditLimit = creditLimitLine(ctx, body)
    if (creditLimit) lines.push(creditLimit)
    return lines
  }

  function probe(ctx) {
    let creds = readCredentials(ctx)
    creds = refreshIfDue(ctx, creds, (c) => refreshCodex(ctx, c))

    let current = creds
    const resp = ctx.util.retryOnceOnAuth({
      request: (token) => send(ctx, {
        method: "GET",
        url: USAGE_URL,
        headers: usageHeaders(ctx, token || current.access_token),
        timeoutMs: 10000,
      }),
      refresh: () => {
        if (!current.refresh_token) return null
        current = refreshCodex(ctx, current)
        return current.access_token
      },
    })

    const idClaims = typeof current.id_token === "string" && current.id_token
      ? ctx.jwt.decodePayload(current.id_token)
      : null
    const email = isObj(idClaims) && typeof idClaims.email === "string" ? idClaims.email : null
    if (email) ctx.account.setLabel(email)

    if (ctx.util.isAuthStatus(resp.status)) throw ERR_SIGN_IN
    if (resp.status < 200 || resp.status > 299) {
      throw "Usage request failed (HTTP " + resp.status + "). Try again later."
    }
    const body = ctx.util.tryParseJson(resp.bodyText)
    if (!isObj(body)) throw "Usage response invalid. Try again later."
    return {
      plan: formatCodexPlan(body.plan_type),
      lines: usageLines(ctx, body, resp.headers || {}, Date.now()),
    }
  }

  globalThis.__openusage_plugin = { id: "codex", probe: probe }
})()
