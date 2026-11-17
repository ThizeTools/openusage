(function () {
  const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"
  const TOKEN_URL = "https://auth.x.ai/oauth2/token"
  const CREDITS_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits"
  const SETTINGS_URL = "https://cli-chat-proxy.grok.com/v1/settings"
  const TOKEN_AUTH_HEADER = "xai-grok-cli"
  const WEEKLY_PERIOD = "USAGE_PERIOD_TYPE_WEEKLY"
  const REFRESH_MARGIN_MS = 5 * 60 * 1000
  const REFUSED_CODES = [
    "invalid_grant",
    "refresh_token_expired",
    "refresh_token_reused",
    "refresh_token_invalidated",
  ]
  const SIGN_IN_AGAIN = "Sign in again in Settings → Accounts."

  function num(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value)
      return Number.isFinite(n) ? n : null
    }
    return null
  }

  function clampPercent(value) {
    return Math.min(100, Math.max(0, value))
  }

  function errorCode(json) {
    if (!json) return null
    if (typeof json.error === "string") return json.error
    if (json.error && typeof json.error.code === "string") return json.error.code
    if (typeof json.code === "string") return json.code
    return null
  }

  // Refresh: rotated refresh tokens are saved; a refused refresh token means sign in again.
  function refreshGrant(ctx, creds) {
    const resp = ctx.host.http.request({
      method: "POST",
      url: TOKEN_URL,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      bodyText:
        "grant_type=refresh_token" +
        "&client_id=" + encodeURIComponent(CLIENT_ID) +
        "&refresh_token=" + encodeURIComponent(creds.refresh_token),
      timeoutMs: 15000,
    })
    const json = ctx.util.tryParseJson(resp.bodyText)
    if (
      [400, 401, 403].indexOf(resp.status) !== -1 &&
      REFUSED_CODES.indexOf(errorCode(json)) !== -1
    ) {
      ctx.host.log.warn("Grok sign-in renewal refused: " + errorCode(json))
      throw SIGN_IN_AGAIN
    }
    if (resp.status < 200 || resp.status >= 300) {
      throw "Grok sign-in renewal failed (HTTP " + resp.status + "). Try again later."
    }
    if (!json || typeof json.access_token !== "string" || !json.access_token) {
      throw "Grok sign-in renewal returned an invalid response."
    }
    return json
  }

  function renew(ctx, creds) {
    const nowMs = Date.now()
    const json = refreshGrant(ctx, creds)
    const next = Object.assign({}, creds, json)
    const expiresIn = num(json.expires_in)
    if (expiresIn !== null) {
      next.expiresAt = nowMs + expiresIn * 1000
    } else {
      delete next.expiresAt
    }
    next.obtainedAt = nowMs
    if (!ctx.account.saveCredentials(JSON.stringify(next))) {
      ctx.host.log.error("Grok renewed sign-in could not be saved; it may need sign in again")
    }
    return next
  }

  function needsRenewal(creds, nowMs) {
    if (!creds.refresh_token || typeof creds.expiresAt !== "number") return false
    return nowMs + REFRESH_MARGIN_MS >= creds.expiresAt
  }

  // Renews ahead of expiry. A failed early renewal keeps the still-valid token, as the app does.
  function freshCreds(ctx, creds) {
    if (!needsRenewal(creds, Date.now())) return creds
    try {
      return renew(ctx, creds)
    } catch (e) {
      if (creds.expiresAt > Date.now()) {
        ctx.host.log.warn("early token renewal failed; keeping the current token: " + String(e))
        return creds
      }
      throw e
    }
  }

  function get(ctx, url, token) {
    return ctx.host.http.request({
      method: "GET",
      url: url,
      headers: {
        Authorization: "Bearer " + token.trim(),
        "X-XAI-Token-Auth": TOKEN_AUTH_HEADER,
        Accept: "application/json",
        "User-Agent": "OpenUsage",
      },
      timeoutMs: 10000,
    })
  }

  function decodeCreditsConfig(body) {
    const config = body && body.config
    const period = config && config.currentPeriod
    if (!period || typeof period.type !== "string" || !period.type.trim()) return null
    if (typeof period.start !== "string" || typeof period.end !== "string") return null
    const start = Date.parse(period.start)
    const end = Date.parse(period.end)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null

    // Proto-JSON omits zero values: an absent percent is 0. A present, non-numeric one is a schema change.
    let percent = 0
    if (config.creditUsagePercent !== undefined) {
      percent = num(config.creditUsagePercent)
      if (percent === null) return null
    }

    // Cap in cents; absent means no pay-as-you-go cap.
    let capCents = 0
    if (config.onDemandCap !== undefined) {
      const cap = config.onDemandCap
      if (!cap || typeof cap !== "object" || Array.isArray(cap)) return null
      const val = cap.val === undefined ? 0 : num(cap.val)
      if (val === null || !Number.isInteger(val)) return null
      capCents = val
    }

    return {
      type: period.type.trim(),
      percent: percent,
      start: start,
      end: end,
      capCents: capCents,
    }
  }

  function mapCredits(ctx, bodyText) {
    const config = decodeCreditsConfig(ctx.util.tryParseJson(bodyText))
    if (!config) throw "Grok usage data is unreadable. Try again later."

    const lines = []
    if (config.type === WEEKLY_PERIOD) {
      lines.push(
        ctx.line.progress({
          label: "Weekly",
          used: clampPercent(config.percent),
          limit: 100,
          format: { kind: "percent" },
          resetsAt: new Date(config.end).toISOString(),
          periodDurationMs: config.end - config.start,
        })
      )
    }
    if (config.capCents > 0) {
      lines.push(
        ctx.line.badge({
          label: "Extra Usage",
          text: "Pay as you go",
          subtitle: "$" + (config.capCents / 100).toFixed(2) + " cap",
        })
      )
    }
    return lines
  }

  // The plan name is optional: a failed read leaves it out, as the app does.
  function readPlan(ctx, token) {
    try {
      const resp = get(ctx, SETTINGS_URL, token)
      if (resp.status < 200 || resp.status >= 300) return undefined
      const body = ctx.util.tryParseJson(resp.bodyText)
      const tier = body && body.subscription_tier_display
      if (typeof tier === "string" && tier.trim()) return tier.trim()
      return undefined
    } catch (e) {
      ctx.host.log.warn("Grok plan read failed: " + String(e))
      return undefined
    }
  }

  globalThis.__openusage_plugin = {
    id: "grok",
    probe: function (ctx) {
      const stored = ctx.account && ctx.account.credentials
      if (!stored || typeof stored.access_token !== "string" || !stored.access_token) {
        throw SIGN_IN_AGAIN
      }

      let creds = freshCreds(ctx, stored)
      let token = creds.access_token
      const resp = ctx.util.retryOnceOnAuth({
        request: (next) => get(ctx, CREDITS_URL, next || token),
        refresh: () => {
          if (!creds.refresh_token) return null
          creds = renew(ctx, creds)
          token = creds.access_token
          return token
        },
      })

      if (resp.status === 412) {
        const body = ctx.util.tryParseJson(resp.bodyText)
        const error = body && typeof body.error === "string" ? body.error : ""
        if (error.toLowerCase().indexOf("no personal team") !== -1) {
          return {
            lines: [ctx.line.text({ label: "Notice", value: "Grok team accounts have no personal quota." })],
          }
        }
      }
      if (resp.status === 401 || resp.status === 403) throw SIGN_IN_AGAIN
      if (resp.status < 200 || resp.status >= 300) {
        throw "Grok usage request failed (HTTP " + resp.status + "). Try again later."
      }

      const lines = mapCredits(ctx, resp.bodyText)

      const claims = creds.id_token ? ctx.jwt.decodePayload(creds.id_token) : null
      if (claims && typeof claims.email === "string" && claims.email) {
        ctx.account.setLabel(claims.email)
      }

      return { lines: lines, plan: readPlan(ctx, token) }
    },
  }
})()
