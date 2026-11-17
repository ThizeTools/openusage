import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeAccount, makeCtx } from "../test-helpers.js"

const loadPlugin = async () => {
  await import("./plugin.js")
  return globalThis.__openusage_plugin
}

const NOW_MS = Date.parse("2026-02-02T00:00:00.000Z")
const NOW_SEC = NOW_MS / 1000
const DAY_SEC = 86400
const SIGN_IN = "Sign in again in Settings"

const API = "https://api2.cursor.sh/aiserver.v1.DashboardService/"
const USAGE_URL = API + "GetCurrentPeriodUsage"
const PLAN_URL = API + "GetPlanInfo"
const CREDITS_URL = API + "GetCreditGrantsBalance"
const GROK_URL = API + "GetSandUsageStatus"
const REFRESH_URL = "https://api2.cursor.sh/oauth/token"
const SUMMARY_URL = "https://cursor.com/api/usage-summary"
const STRIPE_URL = "https://cursor.com/api/auth/stripe"
const PROFILE_URL = "https://cursor.com/api/auth/me"

function makeJwt(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64").replace(/=+$/g, "")
  return `a.${body}.c`
}

const json = (body, status = 200) => ({ status, headers: {}, bodyText: JSON.stringify(body) })

// Routes by URL without its query string. Unknown URLs answer 404 (optional reads skip them).
function route(ctx, handlers) {
  ctx.host.http.request.mockImplementation((req) => {
    const handler = handlers[req.url.split("?")[0]]
    if (!handler) return json({}, 404)
    return typeof handler === "function" ? handler(req) : handler
  })
}

const usageBody = {
  enabled: true,
  planUsage: { limit: 2000, totalSpend: 500, totalPercentUsed: 25, autoPercentUsed: 10, apiPercentUsed: 5 },
  billingCycleStart: NOW_MS - 10 * 86400000,
  billingCycleEnd: NOW_MS + 20 * 86400000,
}

const optionalOk = {
  [PLAN_URL]: json({ planInfo: { planName: "pro" } }),
  [SUMMARY_URL]: json({ membershipType: "pro" }),
  [CREDITS_URL]: json({ hasCreditGrants: true, totalCents: 1000, usedCents: 200 }),
  [STRIPE_URL]: json({ customerBalance: 0 }),
  [GROK_URL]: json({
    usagePercent: 3,
    currentPeriodStart: new Date(NOW_MS - 2 * 86400000).toISOString(),
    nextResetTimestampUtc: new Date(NOW_MS + 5 * 86400000).toISOString(),
  }),
  [PROFILE_URL]: json({ email: "dev@example.com" }),
}

describe("cursor plugin", () => {
  beforeEach(() => {
    delete globalThis.__openusage_plugin
    vi.resetModules()
  })

  it("throws sign-in message when credentials are missing", async () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({})
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow(SIGN_IN)
    expect(ctx.host.http.request).not.toHaveBeenCalled()
  })

  it("builds lines from the usage endpoints and sets the label", async () => {
    const token = makeJwt({ sub: "auth0|user_123", exp: NOW_SEC + 60 * DAY_SEC })
    const ctx = makeCtx()
    ctx.account = makeAccount({ accessToken: token, refreshToken: token })
    route(ctx, { ...optionalOk, [USAGE_URL]: json(usageBody) })

    const plugin = await loadPlugin()
    const out = plugin.probe(ctx)

    const usageCall = ctx.host.http.request.mock.calls.find(([req]) => req.url === USAGE_URL)[0]
    expect(usageCall.headers.Authorization).toBe("Bearer " + token)
    expect(usageCall.headers["Connect-Protocol-Version"]).toBe("1")

    expect(out.plan).toBe("Pro")
    expect(out.lines).toContainEqual({ type: "text", label: "Credits", value: "$8.00 left" })
    expect(out.lines).toContainEqual(
      expect.objectContaining({ type: "progress", label: "Total Usage", used: 25, limit: 100, format: { kind: "percent" } })
    )
    expect(out.lines).toContainEqual(expect.objectContaining({ label: "Cursor Models", used: 10 }))
    expect(out.lines).toContainEqual(expect.objectContaining({ label: "Other Models", used: 5 }))
    expect(out.lines).toContainEqual(expect.objectContaining({ label: "Grok Bot", used: 3, periodDurationMs: 7 * 86400000 }))
    const total = out.lines.find((line) => line.label === "Total Usage")
    expect(total.resetsAt).toBe(new Date(usageBody.billingCycleEnd).toISOString())
    expect(total.periodDurationMs).toBe(30 * 86400000)
    expect(ctx.account.setLabel).toHaveBeenCalledWith("dev@example.com")
    expect(ctx.account.saveCredentials).not.toHaveBeenCalled()
  })

  it("refreshes a JWT inside the 7-day lead and saves the merged credentials", async () => {
    const oldToken = makeJwt({ sub: "auth0|user_123", exp: NOW_SEC + 3 * DAY_SEC })
    const newToken = makeJwt({ sub: "auth0|user_123", exp: NOW_SEC + 60 * DAY_SEC })
    const ctx = makeCtx()
    ctx.account = makeAccount({ accessToken: oldToken, refreshToken: oldToken, obtainedAt: 1 })
    route(ctx, {
      ...optionalOk,
      [REFRESH_URL]: (req) => {
        expect(JSON.parse(req.bodyText)).toEqual({
          grant_type: "refresh_token",
          client_id: "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB",
          refresh_token: oldToken,
        })
        return json({ access_token: newToken })
      },
      [USAGE_URL]: (req) => (req.headers.Authorization === "Bearer " + newToken ? json(usageBody) : json({}, 401)),
    })

    const plugin = await loadPlugin()
    const out = plugin.probe(ctx)

    expect(out.lines.length).toBeGreaterThan(0)
    expect(ctx.account.saved).toEqual({
      accessToken: newToken,
      refreshToken: newToken,
      expiresAt: (NOW_SEC + 60 * DAY_SEC) * 1000,
      obtainedAt: 1,
    })
  })

  it("renews once on 401 and retries the usage read with the new token", async () => {
    const oldToken = makeJwt({ sub: "auth0|user_123", exp: NOW_SEC + 60 * DAY_SEC })
    const newToken = makeJwt({ sub: "auth0|user_123", exp: NOW_SEC + 60 * DAY_SEC + 1 })
    const ctx = makeCtx()
    ctx.account = makeAccount({ accessToken: oldToken, refreshToken: oldToken })
    route(ctx, {
      ...optionalOk,
      [REFRESH_URL]: json({ access_token: newToken }),
      [USAGE_URL]: (req) => (req.headers.Authorization === "Bearer " + newToken ? json(usageBody) : json({}, 401)),
    })

    const plugin = await loadPlugin()
    const out = plugin.probe(ctx)

    expect(out.lines).toContainEqual(expect.objectContaining({ label: "Total Usage", used: 25 }))
    expect(ctx.account.saved.accessToken).toBe(newToken)
  })

  it("asks for sign-in when the refresh token is refused", async () => {
    const token = makeJwt({ sub: "auth0|user_123", exp: NOW_SEC + 60 * DAY_SEC })
    const ctx = makeCtx()
    ctx.account = makeAccount({ accessToken: token, refreshToken: token })
    route(ctx, {
      [USAGE_URL]: json({}, 401),
      [REFRESH_URL]: json({ error: "invalid_grant" }, 400),
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow(SIGN_IN)
    expect(ctx.account.saveCredentials).not.toHaveBeenCalled()
  })

  it("asks for sign-in when Cursor says the session should log out", async () => {
    const token = makeJwt({ sub: "auth0|user_123", exp: NOW_SEC - DAY_SEC })
    const ctx = makeCtx()
    ctx.account = makeAccount({ accessToken: token, refreshToken: token })
    route(ctx, { [REFRESH_URL]: json({ shouldLogout: true }) })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow(SIGN_IN)
  })
})
