import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeAccount, makeCtx } from "../test-helpers.js"

const loadPlugin = async () => {
  delete globalThis.__openusage_plugin
  vi.resetModules()
  await import("./plugin.js")
  return globalThis.__openusage_plugin
}

const BALANCE_URL = "https://ampcode.com/api/internal?userDisplayBalanceInfo"
const AUTHENTICATE_URL = "https://authapi.ampcode.com/user_management/authenticate"

const jwt = (payload) =>
  "eyJhbGciOiJSUzI1NiJ9." +
  Buffer.from(JSON.stringify(payload)).toString("base64url") +
  ".signature"

const displayText = [
  "**Signed in as amp@example.com (example)**",
  "Amp Megawatt Tier: agent usage $19.98 of $20.00 remaining (100%), orb usage 737.6h of 750h a1.small orb hours remaining (98%) - period 2026-11-09 to 2026-12-09, ends in 29 days",
  "Amp Free: 61% remaining today (resets daily)",
  "Individual credits: $57.45 remaining (set up auto-reload to avoid running out) - https://ampcode.com/settings",
].join("\n")

const json = (status, body) => ({ status, headers: {}, bodyText: JSON.stringify(body) })
const balance = (text = displayText) => json(200, { result: { displayText: text } })

function mockAmp(ctx, { usage, authenticate }) {
  ctx.host.http.request.mockImplementation((opts) => {
    if (opts.url === BALANCE_URL) return typeof usage === "function" ? usage(opts) : usage
    if (opts.url === AUTHENTICATE_URL) return authenticate
    throw new Error("unexpected url " + opts.url)
  })
}

describe("amp plugin", () => {
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

  it("returns agent usage, orb hours, free tier and credits from the usage text", async () => {
    const plugin = await loadPlugin()
    const ctx = makeCtx()
    ctx.account = makeAccount({ access_token: "at-1", expiresAt: Date.now() + 60 * 60 * 1000 })
    mockAmp(ctx, { usage: balance() })

    const result = plugin.probe(ctx)

    expect(result.plan).toBe("Megawatt")
    expect(result.lines).toEqual([
      {
        type: "progress",
        label: "Agent Usage",
        used: 0.02,
        limit: 20,
        format: { kind: "dollars" },
        resetsAt: "2026-12-09T00:00:00.000Z",
        periodDurationMs: 30 * 24 * 60 * 60 * 1000,
      },
      {
        type: "progress",
        label: "Orb Hours",
        used: 12.4,
        limit: 750,
        format: { kind: "count", suffix: "hours" },
        resetsAt: "2026-12-09T00:00:00.000Z",
        periodDurationMs: 30 * 24 * 60 * 60 * 1000,
      },
      {
        type: "progress",
        label: "Amp Free",
        used: 39,
        limit: 100,
        format: { kind: "percent" },
        periodDurationMs: 24 * 60 * 60 * 1000,
      },
      { type: "text", label: "Credits", value: "$57.45 left" },
    ])

    const call = ctx.host.http.request.mock.calls[0][0]
    expect(call.method).toBe("POST")
    expect(call.headers.Authorization).toBe("Bearer at-1")
    expect(JSON.parse(call.bodyText)).toEqual({ method: "userDisplayBalanceInfo", params: {} })
    expect(ctx.account.setLabel).toHaveBeenCalledWith("amp@example.com")
  })

  it("renews an expiring token, saves the rotated refresh token and takes expiry from the access token", async () => {
    const plugin = await loadPlugin()
    const ctx = makeCtx()
    const newExp = Math.floor(Date.now() / 1000) + 300
    ctx.account = makeAccount({
      access_token: "at-old",
      refresh_token: "rt-old",
      expiresAt: Date.now() + 60 * 1000,
      user: { email: "old@example.com" },
    })
    mockAmp(ctx, {
      authenticate: json(200, {
        access_token: jwt({ exp: newExp }),
        refresh_token: "rt-new",
        user: { email: "dev@example.com" },
      }),
      usage: (opts) =>
        opts.headers.Authorization.startsWith("Bearer eyJ") ? balance() : json(401, {}),
    })

    plugin.probe(ctx)

    const authCall = ctx.host.http.request.mock.calls.find((c) => c[0].url === AUTHENTICATE_URL)[0]
    expect(JSON.parse(authCall.bodyText)).toEqual({
      client_id: "client_01JNSEYM3V0J5AXK4YXNXRXTGP",
      grant_type: "refresh_token",
      refresh_token: "rt-old",
    })
    expect(ctx.account.saved.refresh_token).toBe("rt-new")
    expect(ctx.account.saved.expiresAt).toBe(newExp * 1000)
    expect(ctx.account.saved.user).toEqual({ email: "dev@example.com" })
  })

  it("renews once on 401 and retries the usage read", async () => {
    const plugin = await loadPlugin()
    const ctx = makeCtx()
    ctx.account = makeAccount({ access_token: "at-old", refresh_token: "rt-old" })
    mockAmp(ctx, {
      authenticate: json(200, { access_token: "at-new", refresh_token: "rt-new" }),
      usage: (opts) => (opts.headers.Authorization === "Bearer at-new" ? balance() : json(401, {})),
    })

    const result = plugin.probe(ctx)

    expect(result.lines.find((l) => l.label === "Credits").value).toBe("$57.45 left")
    expect(ctx.account.saved.access_token).toBe("at-new")
    expect(ctx.account.saved.expiresAt).toBeUndefined()
  })

  it("asks to sign in again when the renewal refuses the refresh token", async () => {
    const plugin = await loadPlugin()
    const ctx = makeCtx()
    ctx.account = makeAccount({ access_token: "at-old", refresh_token: "rt-old" })
    mockAmp(ctx, {
      authenticate: json(400, { error: "invalid_grant" }),
      usage: json(401, {}),
    })

    expect(() => plugin.probe(ctx)).toThrow("Sign in again in Settings → Accounts.")
    expect(ctx.account.saveCredentials).not.toHaveBeenCalled()
  })

  it("asks to sign in again when the usage read is 401 without a refresh token", async () => {
    const plugin = await loadPlugin()
    const ctx = makeCtx()
    ctx.account = makeAccount({ access_token: "at-old" })
    mockAmp(ctx, { usage: json(401, {}) })

    expect(() => plugin.probe(ctx)).toThrow("Sign in again in Settings → Accounts.")
  })
})
