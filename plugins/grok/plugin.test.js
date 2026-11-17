import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeAccount, makeCtx } from "../test-helpers.js"

const loadPlugin = async () => {
  delete globalThis.__openusage_plugin
  vi.resetModules()
  await import("./plugin.js")
  return globalThis.__openusage_plugin
}

const CREDITS_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits"
const SETTINGS_URL = "https://cli-chat-proxy.grok.com/v1/settings"
const TOKEN_URL = "https://auth.x.ai/oauth2/token"

const jwt = (payload) =>
  "eyJhbGciOiJSUzI1NiJ9." +
  Buffer.from(JSON.stringify(payload)).toString("base64url") +
  ".signature"

const creditsBody = (overrides = {}) => ({
  config: {
    currentPeriod: {
      type: "USAGE_PERIOD_TYPE_WEEKLY",
      start: "2026-11-10T00:00:00Z",
      end: "2026-11-17T00:00:00Z",
    },
    creditUsagePercent: 25,
    onDemandCap: { val: 2000 },
    ...overrides,
  },
})

const json = (status, body) => ({ status, headers: {}, bodyText: JSON.stringify(body) })

function mockGrok(ctx, { credits, token, settings = json(200, { subscription_tier_display: "SuperGrok" }) }) {
  ctx.host.http.request.mockImplementation((opts) => {
    if (opts.url === CREDITS_URL) return typeof credits === "function" ? credits(opts) : credits
    if (opts.url === SETTINGS_URL) return settings
    if (opts.url === TOKEN_URL) return token
    throw new Error("unexpected url " + opts.url)
  })
}

describe("grok plugin", () => {
  beforeEach(() => {
    delete globalThis.__openusage_plugin
  })

  it("throws sign-in message when credentials are missing", async () => {
    const plugin = await loadPlugin()
    const ctx = makeCtx()
    ctx.account = makeAccount({})

    expect(() => plugin.probe(ctx)).toThrow("Sign in again in Settings → Accounts.")
    expect(ctx.host.http.request).not.toHaveBeenCalled()
  })

  it("returns weekly usage, the pay-as-you-go cap, plan and the id_token email", async () => {
    const plugin = await loadPlugin()
    const ctx = makeCtx()
    ctx.account = makeAccount({
      access_token: "at-1",
      refresh_token: "rt-1",
      id_token: jwt({ sub: "u1", email: "dev@example.com" }),
      expiresAt: Date.now() + 60 * 60 * 1000,
    })
    mockGrok(ctx, { credits: json(200, creditsBody()) })

    const result = plugin.probe(ctx)

    expect(result.plan).toBe("SuperGrok")
    expect(result.lines).toEqual([
      {
        type: "progress",
        label: "Weekly",
        used: 25,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: "2026-11-17T00:00:00.000Z",
        periodDurationMs: 7 * 24 * 60 * 60 * 1000,
      },
      {
        type: "badge",
        label: "Extra Usage",
        text: "Pay as you go",
        subtitle: "$20.00 cap",
      },
    ])
    const creditsCall = ctx.host.http.request.mock.calls.find((c) => c[0].url === CREDITS_URL)[0]
    expect(creditsCall.headers.Authorization).toBe("Bearer at-1")
    expect(creditsCall.headers["X-XAI-Token-Auth"]).toBe("xai-grok-cli")
    expect(ctx.account.setLabel).toHaveBeenCalledWith("dev@example.com")
    expect(ctx.account.saveCredentials).not.toHaveBeenCalled()
  })

  it("renews an expiring token and saves the rotated refresh token", async () => {
    const plugin = await loadPlugin()
    const ctx = makeCtx()
    ctx.account = makeAccount({
      access_token: "at-old",
      refresh_token: "rt-old",
      expiresAt: Date.now() + 60 * 1000,
      id_token: "x",
    })
    mockGrok(ctx, {
      token: json(200, { access_token: "at-new", refresh_token: "rt-new", expires_in: 3600 }),
      credits: (opts) =>
        opts.headers.Authorization === "Bearer at-new" ? json(200, creditsBody()) : json(401, {}),
    })

    const before = Date.now()
    plugin.probe(ctx)

    const tokenCall = ctx.host.http.request.mock.calls.find((c) => c[0].url === TOKEN_URL)[0]
    expect(tokenCall.bodyText).toContain("grant_type=refresh_token")
    expect(tokenCall.bodyText).toContain("refresh_token=rt-old")
    expect(ctx.account.saved.access_token).toBe("at-new")
    expect(ctx.account.saved.refresh_token).toBe("rt-new")
    expect(ctx.account.saved.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000)
    expect(ctx.account.saved.expiresAt).toBeLessThanOrEqual(Date.now() + 3600 * 1000)
  })

  it("renews once on 401 and retries the usage read", async () => {
    const plugin = await loadPlugin()
    const ctx = makeCtx()
    ctx.account = makeAccount({ access_token: "at-old", refresh_token: "rt-old" })
    mockGrok(ctx, {
      token: json(200, { access_token: "at-new", refresh_token: "rt-new", expires_in: 3600 }),
      credits: (opts) =>
        opts.headers.Authorization === "Bearer at-new" ? json(200, creditsBody()) : json(401, {}),
    })

    const result = plugin.probe(ctx)

    expect(result.lines[0].used).toBe(25)
    expect(ctx.account.saved.access_token).toBe("at-new")
  })

  it("asks to sign in again when a refused refresh token gets 401", async () => {
    const plugin = await loadPlugin()
    const ctx = makeCtx()
    ctx.account = makeAccount({ access_token: "at-old", refresh_token: "rt-old" })
    mockGrok(ctx, {
      token: json(400, { error: "invalid_grant" }),
      credits: json(401, {}),
    })

    expect(() => plugin.probe(ctx)).toThrow("Sign in again in Settings → Accounts.")
    expect(ctx.account.saveCredentials).not.toHaveBeenCalled()
  })

  it("asks to sign in again when the usage read is 401 without a refresh token", async () => {
    const plugin = await loadPlugin()
    const ctx = makeCtx()
    ctx.account = makeAccount({ access_token: "at-old" })
    mockGrok(ctx, { credits: json(401, {}) })

    expect(() => plugin.probe(ctx)).toThrow("Sign in again in Settings → Accounts.")
  })
})
