import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeAccount, makeCtx } from "../test-helpers.js"

const loadPlugin = async () => {
  delete globalThis.__openusage_plugin
  vi.resetModules()
  await import("./plugin.js")
  return globalThis.__openusage_plugin
}

const USAGE_URL = "https://api.github.com/copilot_internal/user"
const USER_URL = "https://api.github.com/user"

function makeUsageBody(overrides = {}) {
  return {
    copilot_plan: "pro_plus",
    quota_reset_date: "2099-01-15T00:00:00Z",
    quota_snapshots: {
      premium_interactions: {
        percent_remaining: 80,
        entitlement: 300,
        remaining: 240,
        overage_permitted: true,
        overage_count: 3,
      },
      chat: { percent_remaining: 95, entitlement: 1000, remaining: 950 },
      completions: { unlimited: true, percent_remaining: 100 },
    },
    ...overrides,
  }
}

function mockGitHub(ctx, { usage, user = { login: "octocat" } } = {}) {
  ctx.host.http.request.mockImplementation((opts) => {
    if (opts.url === USAGE_URL) return usage
    if (opts.url === USER_URL) {
      return { status: 200, headers: {}, bodyText: JSON.stringify(user) }
    }
    throw new Error("unexpected url " + opts.url)
  })
}

const okUsage = (body = makeUsageBody()) => ({
  status: 200,
  headers: {},
  bodyText: JSON.stringify(body),
})

describe("copilot plugin", () => {
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

  it("returns credits, extra usage, chat and completions lines with plan and login label", async () => {
    const plugin = await loadPlugin()
    const ctx = makeCtx()
    ctx.account = makeAccount({ access_token: "gho_abc", token_type: "bearer", scope: "read:user" })
    mockGitHub(ctx, { usage: okUsage() })

    const result = plugin.probe(ctx)

    expect(result.plan).toBe("Pro Plus")
    expect(result.lines).toEqual([
      {
        type: "progress",
        label: "Credits",
        used: 20,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: "2099-01-15T00:00:00.000Z",
        periodDurationMs: 30 * 24 * 60 * 60 * 1000,
      },
      { type: "text", label: "Extra Usage", value: "3" },
      expect.objectContaining({ type: "progress", label: "Chat", used: 5, limit: 100 }),
    ])
    expect(result.lines.find((l) => l.label === "Completions")).toBeUndefined()

    const usageCall = ctx.host.http.request.mock.calls.find((c) => c[0].url === USAGE_URL)[0]
    expect(usageCall.headers.Authorization).toBe("token gho_abc")
    expect(usageCall.headers["Editor-Version"]).toBe("vscode/1.96.2")
    expect(usageCall.headers["User-Agent"]).toBe("GitHubCopilotChat/0.26.7")

    expect(ctx.account.setLabel).toHaveBeenCalledWith("octocat")
    expect(ctx.account.saveCredentials).not.toHaveBeenCalled()
  })

  it("keeps usage when the login read fails", async () => {
    const plugin = await loadPlugin()
    const ctx = makeCtx()
    ctx.account = makeAccount({ access_token: "gho_abc" })
    mockGitHub(ctx, { usage: okUsage() })
    ctx.host.http.request.mockImplementation((opts) => {
      if (opts.url === USAGE_URL) return okUsage()
      return { status: 500, headers: {}, bodyText: "" }
    })

    const result = plugin.probe(ctx)

    expect(result.lines.length).toBeGreaterThan(0)
    expect(ctx.account.setLabel).not.toHaveBeenCalled()
  })

  it("asks to sign in again when GitHub returns 401", async () => {
    const plugin = await loadPlugin()
    const ctx = makeCtx()
    ctx.account = makeAccount({ access_token: "gho_revoked" })
    mockGitHub(ctx, { usage: { status: 401, headers: {}, bodyText: "{}" } })

    expect(() => plugin.probe(ctx)).toThrow("Sign in again in Settings → Accounts.")
  })
})
