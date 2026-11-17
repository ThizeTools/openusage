(function () {
  const PROVIDER_ID = "muse"
  const KEY_URL = "https://api.meta.ai/muse-code/key"
  const SIGN_IN_AGAIN = "Sign in again in Settings → Accounts."
  const SESSION_MS = 5 * 60 * 60 * 1000
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000

  function numberOf(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value)
      return Number.isFinite(n) ? n : null
    }
    return null
  }

  // The sign-in has no renewal. Expired or refused means sign in again.
  function readCredentials(ctx) {
    const creds = ctx.account && ctx.account.credentials
    if (!creds || typeof creds.access_token !== "string" || !creds.access_token) {
      throw SIGN_IN_AGAIN
    }
    if (Number.isFinite(creds.expiresAt) && creds.expiresAt <= Date.now()) {
      throw SIGN_IN_AGAIN
    }
    return creds
  }

  // The response also carries the account's Model API key. Only the fields
  // read below are used, and the body is never logged or echoed in errors.
  function fetchAccount(ctx, token) {
    let resp
    try {
      resp = ctx.util.request({
        method: "POST",
        url: KEY_URL,
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-api-version": "1.0.0",
        },
        bodyText: '{"onboard":false}',
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

  // A window Muse has not reported reads 0% with no reset.
  function windowLine(ctx, label, win, periodMs) {
    if (win === null || win === undefined) {
      return ctx.line.progress({
        label: label,
        used: 0,
        limit: 100,
        format: { kind: "percent" },
        periodDurationMs: periodMs,
      })
    }
    if (typeof win !== "object") throw "Usage response invalid. Try again later."
    const used = numberOf(win.used_percent)
    if (used === null) throw "Usage response invalid. Try again later."

    let resetsAt = null
    if (win.resets_at !== undefined && win.resets_at !== null) {
      const seconds = numberOf(win.resets_at)
      const d = seconds === null ? new Date(NaN) : new Date(seconds * 1000)
      if (!Number.isFinite(d.getTime())) throw "Usage response invalid. Try again later."
      resetsAt = d.toISOString()
    }
    return ctx.line.progress({
      label: label,
      used: used,
      limit: 100,
      format: { kind: "percent" },
      resetsAt: resetsAt,
      periodDurationMs: periodMs,
    })
  }

  function probe(ctx) {
    const creds = readCredentials(ctx)
    const account = fetchAccount(ctx, creds.access_token)

    if (account.is_subs_active !== true) {
      throw "No Muse Code subscription on this account."
    }

    const email = typeof account.user_email === "string" ? account.user_email.trim() : ""
    if (email) ctx.account.setLabel(email)

    const usage =
      account.subs_usage && typeof account.subs_usage === "object" ? account.subs_usage : null
    const lines = [
      windowLine(ctx, "Session", usage ? usage.window : null, SESSION_MS),
      windowLine(ctx, "Weekly", usage ? usage.weekly : null, WEEK_MS),
    ]

    const plan =
      typeof account.subs_tier_name === "string" && account.subs_tier_name.trim()
        ? account.subs_tier_name.trim()
        : null
    return plan ? { plan: plan, lines: lines } : { lines: lines }
  }

  globalThis.__openusage_plugin = { id: PROVIDER_ID, probe: probe }
})()
