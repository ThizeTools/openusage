import { beforeAll, describe, expect, it, vi } from "vitest"
import { makeAccount, makeCtx } from "../test-helpers.js"

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
const PROFILE_URL = "https://api.anthropic.com/api/oauth/profile"
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const SIGN_IN = "Sign in again in Settings → Accounts."
const HOUR_MS = 60 * 60 * 1000

let plugin = null

beforeAll(async () => {
  await import("./plugin.js")
  plugin = globalThis.__openusage_plugin
})

const json = (status, body, headers = {}) => ({ status, headers, bodyText: JSON.stringify(body) })

const usageBody = {
  five_hour: { utilization: 37, resets_at: "2026-02-02T05:00:00Z" },
  seven_day: { utilization: 12, resets_at: "2026-02-08T00:00:00Z" },
  seven_day_sonnet: { utilization: 4, resets_at: null },
  limits: [
    {
      kind: "weekly_scoped",
      scope: { model: { display_name: "Fable" } },
      percent: 9,
      resets_at: "2026-02-08T00:00:00Z",
    },
  ],
  extra_usage: { is_enabled: true, currency: "USD", decimal_places: 2, used_credits: 1250, monthly_limit: 10000 },
}

const profileBody = {
  account: { uuid: "acc-1", email: "ana@example.com" },
  organization: { uuid: "org-1", organization_type: "claude_max", rate_limit_tier: "default_claude_max_5x" },
}

// Queues one response per call to each URL; profile always answers 200.
function mockHttp(ctx, { usage = [], token = [] }) {
  const usageQueue = [...usage]
  const tokenQueue = [...token]
  const calls = []
  ctx.host.http.request = vi.fn((opts) => {
    calls.push(opts)
    if (opts.url === USAGE_URL) return usageQueue.shift()
    if (opts.url === PROFILE_URL) return json(200, profileBody)
    if (opts.url === TOKEN_URL) return tokenQueue.shift()
    throw new Error("unexpected url " + opts.url)
  })
  return calls
}

describe("claude plugin", () => {
  it("throws when the account has no credentials", () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({})
    expect(() => plugin.probe(ctx)).toThrow(SIGN_IN)
    expect(ctx.host.http.request).not.toHaveBeenCalled()
  })

  it("throws when there is no account at all", () => {
    const ctx = makeCtx()
    expect(() => plugin.probe(ctx)).toThrow(SIGN_IN)
  })

  it("maps usage and profile into lines, plan and label", () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({ access_token: "tok-1", refresh_token: "ref-1", expiresAt: Date.now() + HOUR_MS })
    const calls = mockHttp(ctx, { usage: [json(200, usageBody)] })

    const out = plugin.probe(ctx)

    expect(out.plan).toBe("Max")
    expect(ctx.account.setLabel).toHaveBeenCalledWith("ana@example.com")
    const byLabel = Object.fromEntries(out.lines.map((line) => [line.label, line]))
    expect(byLabel.Session).toMatchObject({
      type: "progress",
      used: 37,
      limit: 100,
      format: { kind: "percent" },
      periodDurationMs: 5 * 60 * 60 * 1000,
      resetsAt: "2026-02-02T05:00:00.000Z",
    })
    expect(byLabel.Weekly).toMatchObject({
      used: 12,
      periodDurationMs: 7 * 24 * 60 * 60 * 1000,
      resetsAt: "2026-02-08T00:00:00.000Z",
    })
    expect(byLabel.Sonnet.used).toBe(4)
    expect(byLabel.Sonnet.resetsAt).toBeUndefined()
    expect(byLabel.Fable.used).toBe(9)
    expect(byLabel["Extra Usage"]).toMatchObject({ used: 12.5, limit: 100, format: { kind: "dollars" } })

    const usageCall = calls.find((c) => c.url === USAGE_URL)
    expect(usageCall.method).toBe("GET")
    expect(usageCall.headers).toMatchObject({
      Authorization: "Bearer tok-1",
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": "claude-cli/2.1.294 (external, cli)",
    })
    expect(ctx.account.saveCredentials).not.toHaveBeenCalled()
  })

  it("refreshes about 5 minutes before expiry and saves the merged credentials", () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({
      access_token: "old-tok",
      refresh_token: "ref-1",
      expiresAt: Date.now() + 60 * 1000,
      token_type: "bearer",
    })
    const calls = mockHttp(ctx, {
      usage: [json(200, usageBody)],
      token: [json(200, { access_token: "new-tok", refresh_token: "ref-2", expires_in: 3600 })],
    })

    plugin.probe(ctx)

    const refresh = calls.find((c) => c.url === TOKEN_URL)
    expect(refresh.method).toBe("POST")
    expect(refresh.headers["Content-Type"]).toBe("application/json")
    expect(JSON.parse(refresh.bodyText)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "ref-1",
      client_id: CLIENT_ID,
      scope: "user:profile user:inference",
    })
    expect(calls.find((c) => c.url === USAGE_URL).headers.Authorization).toBe("Bearer new-tok")
    expect(ctx.account.saved).toMatchObject({ access_token: "new-tok", refresh_token: "ref-2", token_type: "bearer" })
    expect(ctx.account.saved.expiresAt).toBeGreaterThan(Date.now() + 3500 * 1000)
  })

  it("retries the refresh with profile scope only when Anthropic refuses the scope", () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({ access_token: "old-tok", refresh_token: "ref-1", expiresAt: Date.now() - 1000 })
    const calls = mockHttp(ctx, {
      usage: [json(200, usageBody)],
      token: [
        json(400, { error: "invalid_scope" }),
        json(200, { access_token: "new-tok", expires_in: 3600 }),
      ],
    })

    plugin.probe(ctx)

    const refreshBodies = calls.filter((c) => c.url === TOKEN_URL).map((c) => JSON.parse(c.bodyText))
    expect(refreshBodies.map((b) => b.scope)).toEqual(["user:profile user:inference", "user:profile"])
    expect(ctx.account.saved.access_token).toBe("new-tok")
  })

  it("renews once on 401 and retries the usage read", () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({ access_token: "old-tok", refresh_token: "ref-1", expiresAt: Date.now() + HOUR_MS })
    const calls = mockHttp(ctx, {
      usage: [json(401, {}), json(200, usageBody)],
      token: [json(200, { access_token: "new-tok", refresh_token: "ref-2", expires_in: 3600 })],
    })

    const out = plugin.probe(ctx)

    const usageAuth = calls.filter((c) => c.url === USAGE_URL).map((c) => c.headers.Authorization)
    expect(usageAuth).toEqual(["Bearer old-tok", "Bearer new-tok"])
    expect(out.lines.find((l) => l.label === "Session").used).toBe(37)
    expect(ctx.account.saved.access_token).toBe("new-tok")
  })

  it("shows a Rate limited status badge on HTTP 429", () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({ access_token: "tok-1", refresh_token: "ref-1", expiresAt: Date.now() + HOUR_MS })
    mockHttp(ctx, { usage: [json(429, {}, { "retry-after": "120" })] })

    const out = plugin.probe(ctx)

    expect(out.lines).toEqual([
      { type: "badge", label: "Status", text: "Rate limited, retry in ~2m", color: "#f59e0b" },
    ])
  })

  it("asks to sign in again when the refresh token is refused", () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({ access_token: "old-tok", refresh_token: "ref-1", expiresAt: Date.now() - 1000 })
    mockHttp(ctx, { token: [json(400, { error: "invalid_grant" })] })

    expect(() => plugin.probe(ctx)).toThrow(SIGN_IN)
    expect(ctx.account.saveCredentials).not.toHaveBeenCalled()
  })

  it("keeps a still-valid token when the early refresh fails", () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({ access_token: "tok-1", refresh_token: "ref-1", expiresAt: Date.now() + 60 * 1000 })
    const calls = mockHttp(ctx, {
      usage: [json(200, usageBody)],
      token: [json(500, {})],
    })

    const out = plugin.probe(ctx)

    expect(calls.find((c) => c.url === USAGE_URL).headers.Authorization).toBe("Bearer tok-1")
    expect(out.lines.length).toBeGreaterThan(0)
    expect(ctx.account.saveCredentials).not.toHaveBeenCalled()
  })
})
