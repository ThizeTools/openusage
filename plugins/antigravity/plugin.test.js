import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeAccount, makeCtx } from "../test-helpers.js"

const loadPlugin = async () => {
  await import("./plugin.js")
  return globalThis.__openusage_plugin
}

const NOW_MS = Date.parse("2026-02-02T00:00:00.000Z")
const SIGN_IN = "Sign in again in Settings"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const LOAD_URL = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist"
const DAILY_QUOTA_URL = "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary"
const PROD_QUOTA_URL = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary"
const USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo"

const json = (body, status = 200) => ({ status, headers: {}, bodyText: JSON.stringify(body) })

// Routes by URL without its query string. Unknown URLs answer 404.
function route(ctx, handlers) {
  ctx.host.http.request.mockImplementation((req) => {
    const handler = handlers[req.url.split("?")[0]]
    if (!handler) return json({}, 404)
    return typeof handler === "function" ? handler(req) : handler
  })
}

const resetAt = new Date(NOW_MS + 3 * 3600 * 1000).toISOString()

const completeQuota = {
  response: {
    groups: [
      {
        displayName: "Gemini",
        buckets: [
          { bucketId: "gemini-5h", remainingFraction: 0.75, resetTime: resetAt },
          { bucketId: "gemini-weekly", remainingFraction: 0.5, resetTime: resetAt },
          { bucketId: "3p-5h", remainingFraction: 1, resetTime: resetAt },
          { bucketId: "3p-weekly", remainingFraction: 0.2, resetTime: resetAt },
        ],
      },
      {
        displayName: "Gemini 4 Argon",
        buckets: [{ bucketId: "argon-weekly", window: "weekly", remainingFraction: 0.9, resetTime: resetAt }],
      },
    ],
  },
}

describe("antigravity plugin", () => {
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

  it("refreshes an expiring token and saves the merged credentials", async () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({
      access_token: "old",
      refresh_token: "rt-1",
      expires_in: 3599,
      expiresAt: NOW_MS - 1000,
      obtainedAt: 1,
    })
    route(ctx, {
      [TOKEN_URL]: (req) => {
        expect(req.headers["Content-Type"]).toBe("application/x-www-form-urlencoded")
        expect(req.bodyText).toContain("grant_type=refresh_token")
        expect(req.bodyText).toContain("refresh_token=rt-1")
        expect(req.bodyText).toContain("client_secret=")
        return json({ access_token: "new", expires_in: 3600, token_type: "Bearer" })
      },
      [LOAD_URL]: json({ paidTier: { id: "g1-pro-tier" }, cloudaicompanionProject: "proj-1" }),
      [DAILY_QUOTA_URL]: (req) => (req.headers.Authorization === "Bearer new" ? json(completeQuota) : json({}, 401)),
      [USERINFO_URL]: json({ email: "dev@example.com" }),
    })

    const plugin = await loadPlugin()
    plugin.probe(ctx)

    expect(ctx.account.saved).toEqual(
      expect.objectContaining({
        access_token: "new",
        refresh_token: "rt-1",
        expires_in: 3600,
        token_type: "Bearer",
        expiresAt: NOW_MS + 3600 * 1000,
        obtainedAt: 1,
      })
    )
  })

  it("builds quota lines with the plan, the Argon bucket and the label", async () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({
      access_token: "tok",
      refresh_token: "rt",
      expiresAt: NOW_MS + 3600 * 1000,
    })
    route(ctx, {
      [LOAD_URL]: json({ paidTier: { id: "g1-pro-tier" }, cloudaicompanionProject: "proj-1" }),
      [DAILY_QUOTA_URL]: (req) => (req.headers.Authorization === "Bearer tok" ? json(completeQuota) : json({}, 401)),
      [USERINFO_URL]: json({ email: "dev@example.com" }),
    })

    const plugin = await loadPlugin()
    const out = plugin.probe(ctx)

    const quotaCall = ctx.host.http.request.mock.calls.find(([req]) => req.url.startsWith(DAILY_QUOTA_URL))[0]
    expect(JSON.parse(quotaCall.bodyText)).toEqual({ project: "proj-1" })
    expect(quotaCall.headers["User-Agent"]).toBe("antigravity/hub/2.24.0 (aidev_client; os_type=windows; arch=amd64)")
    expect(ctx.host.http.request.mock.calls.some(([req]) => req.url === PROD_QUOTA_URL)).toBe(false)

    expect(out.plan).toBe("Google AI Pro")
    expect(out.lines.map((line) => [line.label, line.used])).toEqual([
      ["Gemini 5h", 25],
      ["Gemini weekly", 50],
      ["Argon weekly", expect.closeTo(10, 5)],
      ["Claude 5h", 0],
      ["Claude weekly", expect.closeTo(80, 5)],
    ])
    expect(out.lines[0]).toMatchObject({ type: "progress", limit: 100, format: { kind: "percent" }, resetsAt: resetAt })
    expect(ctx.account.setLabel).toHaveBeenCalledWith("dev@example.com")
  })

  it("renews once when the quota read answers 401", async () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({
      access_token: "old",
      refresh_token: "rt",
      expiresAt: NOW_MS + 3600 * 1000,
    })
    route(ctx, {
      [TOKEN_URL]: json({ access_token: "new", expires_in: 3600 }),
      [LOAD_URL]: json({ paidTier: { id: "g1-pro-tier" } }),
      [DAILY_QUOTA_URL]: (req) => (req.headers.Authorization === "Bearer new" ? json(completeQuota) : json({}, 401)),
      [USERINFO_URL]: json({ email: "dev@example.com" }),
    })

    const plugin = await loadPlugin()
    const out = plugin.probe(ctx)

    expect(out.lines).toContainEqual(expect.objectContaining({ label: "Gemini 5h", used: 25 }))
    expect(ctx.account.saved.access_token).toBe("new")
  })

  it("asks for sign-in when the renewed token is refused too", async () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({
      access_token: "old",
      refresh_token: "rt",
      expiresAt: NOW_MS + 3600 * 1000,
    })
    route(ctx, {
      [TOKEN_URL]: json({ error: "invalid_grant" }, 400),
      [LOAD_URL]: json({}, 401),
      [DAILY_QUOTA_URL]: json({}, 401),
      [PROD_QUOTA_URL]: json({}, 401),
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow(SIGN_IN)
    expect(ctx.account.saveCredentials).not.toHaveBeenCalled()
  })
})
