(function () {
  const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
  const TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
  const USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
  const PROFILE_URL = "https://api.anthropic.com/api/oauth/profile"
  const SCOPES = "user:profile user:inference"
  const PROFILE_ONLY_SCOPES = "user:profile"
  // Tracks Claude Code: Anthropic rejects old client versions on usage reads.
  const CLAUDE_CODE_VERSION = "2.1.294"
  const REFRESH_MARGIN_MS = 5 * 60 * 1000
  const SESSION_MS = 5 * 60 * 60 * 1000
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000
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

  // expires_in wins; without it the access token's own exp (if it is a JWT); else keep the old value.
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

  function refreshClaude(ctx, creds) {
    const post = (scope) => send(ctx, {
      method: "POST",
      url: TOKEN_URL,
      headers: { "Content-Type": "application/json" },
      bodyText: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: creds.refresh_token,
        client_id: CLIENT_ID,
        scope: scope,
      }),
      timeoutMs: 15000,
    })
    let resp = post(SCOPES)
    if (resp.status === 400 && errorCode(ctx, resp.bodyText) === "invalid_scope") {
      resp = post(PROFILE_ONLY_SCOPES)
    }
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

  function usageHeaders(token) {
    return {
      Authorization: "Bearer " + token.trim(),
      Accept: "application/json",
      "Content-Type": "application/json",
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": "claude-cli/" + CLAUDE_CODE_VERSION + " (external, cli)",
    }
  }

  // Best effort: a failed profile read only loses the label and plan.
  function fetchProfile(ctx, token) {
    let resp
    try {
      resp = ctx.util.request({
        method: "GET",
        url: PROFILE_URL,
        headers: {
          Authorization: "Bearer " + token.trim(),
          Accept: "application/json",
          "anthropic-beta": "oauth-2025-04-20",
        },
        timeoutMs: 10000,
      })
    } catch (e) {
      ctx.host.log.warn("profile request failed: " + String(e))
      return null
    }
    if (resp.status < 200 || resp.status > 299) {
      ctx.host.log.warn("profile returned HTTP " + resp.status)
      return null
    }
    return ctx.util.tryParseJson(resp.bodyText)
  }

  function formatLivePlan(org) {
    if (!isObj(org) || typeof org.organization_type !== "string") return null
    const raw = org.organization_type.replace(/^claude_/, "").trim()
    if (!raw) return null
    const base = raw
      .split(" ")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ")
    const tier = typeof org.rate_limit_tier === "string" ? org.rate_limit_tier : ""
    if (base === "Ultra" || (base === "Max" && (tier.indexOf("ultra") >= 0 || tier.indexOf("20x") >= 0))) {
      return "Ultra"
    }
    if (base === "Max") return "Max"
    const match = tier.match(/\d+x/)
    return match ? base + " " + match[0] : base
  }

  function percentLine(ctx, label, used, resetsAt, periodMs) {
    const opts = { label: label, used: used, limit: 100, format: { kind: "percent" }, periodDurationMs: periodMs }
    if (resetsAt) opts.resetsAt = resetsAt
    return ctx.line.progress(opts)
  }

  function windowLine(ctx, label, win, periodMs) {
    if (!isObj(win)) return null
    const used = toNum(win.utilization)
    if (used === null) return null
    return percentLine(ctx, label, used, ctx.util.toIso(win.resets_at), periodMs)
  }

  function fableLine(ctx, limits) {
    const list = Array.isArray(limits) ? limits : []
    const entry = list.find((item) =>
      isObj(item) &&
      item.kind === "weekly_scoped" &&
      isObj(item.scope) &&
      isObj(item.scope.model) &&
      item.scope.model.display_name === "Fable" &&
      toNum(item.percent) !== null
    )
    if (!entry) return null
    return percentLine(ctx, "Fable", toNum(entry.percent), ctx.util.toIso(entry.resets_at), WEEK_MS)
  }

  function extraLine(ctx, extra) {
    if (!isObj(extra) || extra.is_enabled !== true) return null
    const currency = typeof extra.currency === "string" && extra.currency ? extra.currency : "USD"
    const decimals = toNum(extra.decimal_places)
    const minorUnits = Math.pow(10, decimals === null ? 2 : decimals)
    const used = Math.round(toNum(extra.used_credits) || 0) / minorUnits
    const limitMinor = toNum(extra.monthly_limit)
    const limit = limitMinor !== null && limitMinor > 0 ? Math.round(limitMinor) / minorUnits : null
    if (currency === "USD") {
      if (limit !== null) {
        return ctx.line.progress({ label: "Extra Usage", used: used, limit: limit, format: { kind: "dollars" } })
      }
      return ctx.line.text({ label: "Extra Usage", value: "$" + used.toFixed(2) })
    }
    // The progress format carries no currency code, so other currencies show as text.
    const opts = { label: "Extra Usage", value: used.toFixed(2) + " " + currency }
    if (limit !== null) opts.subtitle = "Monthly limit " + limit.toFixed(2) + " " + currency
    return ctx.line.text(opts)
  }

  function usageLines(ctx, data) {
    return [
      windowLine(ctx, "Session", data.five_hour, SESSION_MS),
      windowLine(ctx, "Weekly", data.seven_day, WEEK_MS),
      windowLine(ctx, "Sonnet", data.seven_day_sonnet, WEEK_MS),
      fableLine(ctx, data.limits),
      extraLine(ctx, data.extra_usage),
    ].filter(Boolean)
  }

  function parseRetryAfter(headers) {
    const raw = headers ? headers["retry-after"] : null
    if (!raw) return null
    const seconds = Number(raw)
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null
  }

  function rateLimitBadge(ctx, resp) {
    const retryAfter = parseRetryAfter(resp.headers)
    ctx.host.signalRateLimit(retryAfter)
    const text = retryAfter === null
      ? "Rate limited, try again later"
      : "Rate limited, retry in ~" + Math.max(1, Math.ceil(retryAfter / 60)) + "m"
    return ctx.line.badge({ label: "Status", text: text, color: "#f59e0b" })
  }

  function probe(ctx) {
    let creds = readCredentials(ctx)
    creds = refreshIfDue(ctx, creds, (c) => refreshClaude(ctx, c))

    let current = creds
    const resp = ctx.util.retryOnceOnAuth({
      request: (token) => send(ctx, {
        method: "GET",
        url: USAGE_URL,
        headers: usageHeaders(token || current.access_token),
        timeoutMs: 10000,
      }),
      refresh: () => {
        if (!current.refresh_token) return null
        current = refreshClaude(ctx, current)
        return current.access_token
      },
    })
    if (ctx.util.isAuthStatus(resp.status)) throw ERR_SIGN_IN

    const profile = fetchProfile(ctx, current.access_token)
    const email = isObj(profile)
      ? (isObj(profile.account) && profile.account.email) || profile.email
      : null
    if (typeof email === "string" && email) ctx.account.setLabel(email)
    const plan = isObj(profile) ? formatLivePlan(profile.organization) : null

    if (resp.status === 429) return { plan: plan, lines: [rateLimitBadge(ctx, resp)] }
    if (resp.status < 200 || resp.status > 299) {
      throw "Usage request failed (HTTP " + resp.status + "). Try again later."
    }
    const data = ctx.util.tryParseJson(resp.bodyText)
    if (!isObj(data)) throw "Usage response invalid. Try again later."
    return { plan: plan, lines: usageLines(ctx, data) }
  }

  globalThis.__openusage_plugin = { id: "claude", probe: probe }
})()
