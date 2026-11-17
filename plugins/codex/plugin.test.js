import { beforeAll, describe, expect, it, vi } from "vitest"
import { makeAccount, makeCtx } from "../test-helpers.js"

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
const TOKEN_URL = "https://auth.openai.com/oauth/token"
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const SIGN_IN = "Sign in again in Settings → Accounts."
const HOUR_MS = 60 * 60 * 1000
const RESET_AT = 1767225600

let plugin = null

beforeAll(async () => {
  await import("./plugin.js")
  plugin = globalThis.__openusage_plugin
})

const json = (status, body, headers = {}) => ({ status, headers, bodyText: JSON.stringify(body) })
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url")
const jwt = (claims) => b64({ alg: "none" }) + "." + b64(claims) + ".sig"

const accessToken = (extra = {}) => jwt({
  exp: Math.floor(Date.now() / 1000) + 3600,
  "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" },
  ...extra,
})
const idToken = jwt({ email: "dev@example.com" })

const usageBody = {
  plan_type: "pro",
  rate_limit: {
    primary_window: { limit_window_seconds: 18000, used_percent: 42, reset_at: RESET_AT },
    secondary_window: { limit_window_seconds: 604800, used_percent: 17, reset_after_seconds: 3600 },
  },
  additional_rate_limits: [
    {
      limit_name: "GPT-5.3-Codex-Spark",
      rate_limit: { primary_window: { limit_window_seconds: 18000, used_percent: 5 } },
    },
  ],
  credits: { has_credits: true, balance: "2.5" },
  spend_control: { individual_limit: { used: "3", limit: "20", reset_at: RESET_AT } },
}

// Queues one response per call to each URL.
function mockHttp(ctx, { usage = [], token = [] }) {
  const usageQueue = [...usage]
  const tokenQueue = [...token]
  const calls = []
  ctx.host.http.request = vi.fn((opts) => {
    calls.push(opts)
    if (opts.url === USAGE_URL) return usageQueue.shift()
    if (opts.url === TOKEN_URL) return tokenQueue.shift()
    throw new Error("unexpected url " + opts.url)
  })
  return calls
}

describe("codex plugin", () => {
  it("throws when the account has no credentials", () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({})
    expect(() => plugin.probe(ctx)).toThrow(SIGN_IN)
    expect(ctx.host.http.request).not.toHaveBeenCalled()
  })

  it("maps usage into lines, plan, label and account header", () => {
    const ctx = makeCtx()
    const token = accessToken()
    ctx.account = makeAccount({
      access_token: token,
      id_token: idToken,
      refresh_token: "rt-1",
      expiresAt: Date.now() + HOUR_MS,
    })
    const calls = mockHttp(ctx, { usage: [json(200, usageBody)] })

    const out = plugin.probe(ctx)

    expect(out.plan).toBe("Pro 200")
    expect(ctx.account.setLabel).toHaveBeenCalledWith("dev@example.com")
    const byLabel = Object.fromEntries(out.lines.map((line) => [line.label, line]))
    expect(byLabel.Session).toMatchObject({
      used: 42,
      periodDurationMs: 5 * 60 * 60 * 1000,
      resetsAt: new Date(RESET_AT * 1000).toISOString(),
    })
    expect(byLabel.Weekly).toMatchObject({ used: 17, periodDurationMs: 7 * 24 * 60 * 60 * 1000 })
    expect(typeof byLabel.Weekly.resetsAt).toBe("string")
    expect(byLabel.Spark.used).toBe(5)
    expect(byLabel["Spark Weekly"]).toBeUndefined()
    expect(byLabel["Extra Usage"]).toMatchObject({ type: "text", value: "$0.08", subtitle: "2 credits" })
    expect(byLabel["Credit Limit"]).toMatchObject({
      used: 3,
      limit: 20,
      format: { kind: "count", suffix: "credits" },
      resetsAt: new Date(RESET_AT * 1000).toISOString(),
    })

    const usageCall = calls.find((c) => c.url === USAGE_URL)
    expect(usageCall.method).toBe("GET")
    expect(usageCall.headers).toMatchObject({
      Authorization: "Bearer " + token,
      "ChatGPT-Account-Id": "acct-1",
      "User-Agent": "OpenUsage",
    })
    expect(ctx.account.saveCredentials).not.toHaveBeenCalled()
  })

  it("refreshes about 5 minutes before expiry with a form body and saves the merged credentials", () => {
    const ctx = makeCtx()
    const oldToken = accessToken()
    const newToken = accessToken({ sub: "renewed" })
    ctx.account = makeAccount({
      access_token: oldToken,
      id_token: idToken,
      refresh_token: "rt-1",
      expiresAt: Date.now() + 60 * 1000,
    })
    const calls = mockHttp(ctx, {
      usage: [json(200, usageBody)],
      token: [json(200, { access_token: newToken, refresh_token: "rt-2", expires_in: 3600 })],
    })

    plugin.probe(ctx)

    const refresh = calls.find((c) => c.url === TOKEN_URL)
    expect(refresh.method).toBe("POST")
    expect(refresh.headers["Content-Type"]).toBe("application/x-www-form-urlencoded")
    const form = new URLSearchParams(refresh.bodyText)
    expect(form.get("grant_type")).toBe("refresh_token")
    expect(form.get("client_id")).toBe(CLIENT_ID)
    expect(form.get("refresh_token")).toBe("rt-1")
    expect(calls.find((c) => c.url === USAGE_URL).headers.Authorization).toBe("Bearer " + newToken)
    expect(ctx.account.saved).toMatchObject({
      access_token: newToken,
      refresh_token: "rt-2",
      id_token: idToken,
    })
    expect(ctx.account.saved.expiresAt).toBeGreaterThan(Date.now() + 3500 * 1000)
  })

  it("renews once on 401 and retries the usage read", () => {
    const ctx = makeCtx()
    const oldToken = accessToken()
    const newToken = accessToken({ sub: "renewed" })
    ctx.account = makeAccount({
      access_token: oldToken,
      id_token: idToken,
      refresh_token: "rt-1",
      expiresAt: Date.now() + HOUR_MS,
    })
    const calls = mockHttp(ctx, {
      usage: [json(401, {}), json(200, usageBody)],
      token: [json(200, { access_token: newToken, refresh_token: "rt-2", expires_in: 3600 })],
    })

    const out = plugin.probe(ctx)

    const usageAuth = calls.filter((c) => c.url === USAGE_URL).map((c) => c.headers.Authorization)
    expect(usageAuth).toEqual(["Bearer " + oldToken, "Bearer " + newToken])
    expect(out.lines.find((l) => l.label === "Session").used).toBe(42)
    expect(ctx.account.saved.access_token).toBe(newToken)
  })

  it("asks to sign in again when the refresh token is refused", () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({
      access_token: accessToken(),
      refresh_token: "rt-1",
      expiresAt: Date.now() - 1000,
    })
    mockHttp(ctx, { token: [json(400, { error: { code: "refresh_token_reused" } })] })

    expect(() => plugin.probe(ctx)).toThrow(SIGN_IN)
    expect(ctx.account.saveCredentials).not.toHaveBeenCalled()
  })
})
