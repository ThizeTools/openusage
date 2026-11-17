(function () {
  const CLIENT_ID = "client_01JNSEYM3V0J5AXK4YXNXRXTGP"
  const AUTHENTICATE_URL = "https://authapi.ampcode.com/user_management/authenticate"
  const BALANCE_URL = "https://ampcode.com/api/internal?userDisplayBalanceInfo"
  const REFRESH_MARGIN_MS = 5 * 60 * 1000
  const DAY_MS = 24 * 60 * 60 * 1000
  const REFUSED_CODES = [
    "invalid_grant",
    "refresh_token_expired",
    "refresh_token_reused",
    "refresh_token_invalidated",
  ]
  const SIGN_IN_AGAIN = "Sign in again in Settings → Accounts."
  const UNREADABLE = "Amp usage data is unreadable. Try again later."

  const TIER_RE = /Amp (?<plan>[^\n]+?) Tier: agent usage \$(?<left>[0-9.,]+) of \$(?<limit>[0-9.,]+) remaining(?<rest>[^\n]*)/
  const ORB_RE = /orb usage (?<left>[0-9.,]+)h of (?<limit>[0-9.,]+)h/
  const FREE_DOLLARS_RE = /Amp Free: \$(?<left>[0-9.,]+)\s*\/\s*\$(?<limit>[0-9.,]+) remaining/
  const FREE_PERCENT_RE = /Amp Free: (?<left>[0-9.]+)% remaining/
  const CREDITS_RE = /Individual credits: \$(?<left>[0-9.,]+) remaining/
  const PERIOD_RE = /period (?<start>\d{4}-\d{2}-\d{2}) to (?<end>\d{4}-\d{2}-\d{2})/
  const EMAIL_RE = /Signed in as (?<email>[^\s(]+)/

  function parseAmount(text) {
    const n = Number(String(text).replace(/,/g, ""))
    return Number.isFinite(n) ? n : null
  }

  function clampPercent(value) {
    return Math.min(100, Math.max(0, value))
  }

  // The access token's own exp (seconds), in ms. Null when the token has none.
  function jwtExpiryMs(ctx, token) {
    const claims = token ? ctx.jwt.decodePayload(token) : null
    return claims && typeof claims.exp === "number" ? claims.exp * 1000 : null
  }

  function errorCode(json) {
    if (!json) return null
    if (typeof json.error === "string") return json.error
    if (json.error && typeof json.error.code === "string") return json.error.code
    if (typeof json.code === "string") return json.code
    return null
  }

  // Refresh: WorkOS rotates the refresh token on every renewal; the new one is saved.
  function refreshGrant(ctx, creds) {
    const resp = ctx.host.http.request({
      method: "POST",
      url: AUTHENTICATE_URL,
      headers: { "Content-Type": "application/json" },
      bodyText: JSON.stringify({
        client_id: CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: creds.refresh_token,
      }),
      timeoutMs: 15000,
    })
    const json = ctx.util.tryParseJson(resp.bodyText)
    if (
      [400, 401, 403].indexOf(resp.status) !== -1 &&
      REFUSED_CODES.indexOf(errorCode(json)) !== -1
    ) {
      ctx.host.log.warn("Amp sign-in renewal refused: " + errorCode(json))
      throw SIGN_IN_AGAIN
    }
    if (resp.status < 200 || resp.status >= 300) {
      throw "Amp sign-in renewal failed (HTTP " + resp.status + "). Try again later."
    }
    if (!json || typeof json.access_token !== "string" || !json.access_token) {
      throw "Amp sign-in renewal returned an invalid response."
    }
    return json
  }

  function renew(ctx, creds) {
    const nowMs = Date.now()
    const json = refreshGrant(ctx, creds)
    const next = Object.assign({}, creds, json)
    // Amp sends no expires_in: the expiry is the access token's own exp, as the app reads it.
    if (typeof json.expires_in === "number") {
      next.expiresAt = nowMs + json.expires_in * 1000
    } else {
      const exp = jwtExpiryMs(ctx, json.access_token)
      if (exp !== null) next.expiresAt = exp
      else delete next.expiresAt
    }
    next.obtainedAt = nowMs
    if (!ctx.account.saveCredentials(JSON.stringify(next))) {
      ctx.host.log.error("Amp renewed sign-in could not be saved; it may need sign in again")
    }
    return next
  }

  function currentExpiryMs(ctx, creds) {
    if (typeof creds.expiresAt === "number") return creds.expiresAt
    return jwtExpiryMs(ctx, creds.access_token)
  }

  function needsRenewal(ctx, creds, nowMs) {
    if (!creds.refresh_token) return false
    const expiresAt = currentExpiryMs(ctx, creds)
    if (expiresAt === null) return false
    return nowMs + REFRESH_MARGIN_MS >= expiresAt
  }

  // Renews ahead of expiry. A failed early renewal keeps the still-valid token, as the app does.
  function freshCreds(ctx, creds) {
    if (!needsRenewal(ctx, creds, Date.now())) return creds
    try {
      return renew(ctx, creds)
    } catch (e) {
      const expiresAt = currentExpiryMs(ctx, creds)
      if (expiresAt !== null && expiresAt > Date.now()) {
        ctx.host.log.warn("early token renewal failed; keeping the current token: " + String(e))
        return creds
      }
      throw e
    }
  }

  function fetchBalance(ctx, token) {
    return ctx.host.http.request({
      method: "POST",
      url: BALANCE_URL,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      bodyText: JSON.stringify({ method: "userDisplayBalanceInfo", params: {} }),
      timeoutMs: 15000,
    })
  }

  // Amp answers with the text `amp usage` prints. The text is in result.displayText.
  function displayText(ctx, bodyText) {
    const body = ctx.util.tryParseJson(bodyText)
    const text = body && body.result && body.result.displayText
    return typeof text === "string" ? text.replace(/\*\*/g, "") : null
  }

  // Billing dates are whole days, read as UTC midnights.
  function billingPeriod(text) {
    const match = PERIOD_RE.exec(text)
    if (!match) return null
    const start = Date.parse(match.groups.start + "T00:00:00Z")
    const end = Date.parse(match.groups.end + "T00:00:00Z")
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
    return { start: start, end: end }
  }

  function mapBalance(ctx, text) {
    const lines = []
    let plan

    const tier = TIER_RE.exec(text)
    const left = tier ? parseAmount(tier.groups.left) : null
    const limit = tier ? parseAmount(tier.groups.limit) : null
    if (tier && left !== null && limit !== null && limit > 0) {
      plan = tier.groups.plan
      const period = billingPeriod(tier.groups.rest)
      const periodFields = period
        ? { resetsAt: new Date(period.end).toISOString(), periodDurationMs: period.end - period.start }
        : {}
      lines.push(
        ctx.line.progress(Object.assign({
          label: "Agent Usage",
          used: Math.round((limit - left) * 100) / 100,
          limit: limit,
          format: { kind: "dollars" },
        }, periodFields))
      )

      const orb = ORB_RE.exec(tier.groups.rest)
      const orbLeft = orb ? parseAmount(orb.groups.left) : null
      const orbLimit = orb ? parseAmount(orb.groups.limit) : null
      if (orb && orbLeft !== null && orbLimit !== null && orbLimit > 0) {
        lines.push(
          ctx.line.progress(Object.assign({
            label: "Orb Hours",
            used: Math.round((orbLimit - orbLeft) * 10) / 10,
            limit: orbLimit,
            format: { kind: "count", suffix: "hours" },
          }, periodFields))
        )
      }
    }

    let hasFree = false
    const free = FREE_DOLLARS_RE.exec(text)
    const freeLeft = free ? parseAmount(free.groups.left) : null
    const freeLimit = free ? parseAmount(free.groups.limit) : null
    if (free && freeLeft !== null && freeLimit !== null && freeLimit > 0) {
      hasFree = true
      lines.push(ctx.line.progress({
        label: "Amp Free",
        used: clampPercent(((freeLimit - freeLeft) / freeLimit) * 100),
        limit: 100,
        format: { kind: "percent" },
        periodDurationMs: DAY_MS,
      }))
    } else {
      const freePercent = FREE_PERCENT_RE.exec(text)
      const remaining = freePercent ? parseAmount(freePercent.groups.left) : null
      if (remaining !== null) {
        hasFree = true
        lines.push(ctx.line.progress({
          label: "Amp Free",
          used: clampPercent(100 - remaining),
          limit: 100,
          format: { kind: "percent" },
          periodDurationMs: DAY_MS,
        }))
      }
    }
    if (plan === undefined && hasFree) plan = "Free"

    const credits = CREDITS_RE.exec(text)
    const creditsLeft = credits ? parseAmount(credits.groups.left) : null
    if (creditsLeft !== null) {
      lines.push(ctx.line.text({ label: "Credits", value: "$" + creditsLeft.toFixed(2) + " left" }))
    }

    if (lines.length === 0) throw UNREADABLE
    return { plan: plan, lines: lines }
  }

  function emailFrom(text) {
    const match = EMAIL_RE.exec(text)
    return match ? match.groups.email : null
  }

  globalThis.__openusage_plugin = {
    id: "amp",
    probe: function (ctx) {
      const stored = ctx.account && ctx.account.credentials
      if (!stored || typeof stored.access_token !== "string" || !stored.access_token) {
        throw SIGN_IN_AGAIN
      }

      let creds = freshCreds(ctx, stored)
      let token = creds.access_token
      const resp = ctx.util.retryOnceOnAuth({
        request: (next) => fetchBalance(ctx, next || token),
        refresh: () => {
          if (!creds.refresh_token) return null
          creds = renew(ctx, creds)
          token = creds.access_token
          return token
        },
      })

      if (resp.status === 401 || resp.status === 403) throw SIGN_IN_AGAIN
      if (resp.status < 200 || resp.status >= 300) {
        throw "Amp usage request failed (HTTP " + resp.status + "). Try again later."
      }

      const text = displayText(ctx, resp.bodyText)
      if (text === null) throw UNREADABLE
      const mapped = mapBalance(ctx, text)

      const email = emailFrom(text) || (creds.user && creds.user.email)
      if (typeof email === "string" && email) ctx.account.setLabel(email)

      return { lines: mapped.lines, plan: mapped.plan }
    },
  }
})()
