import { beforeEach, describe, expect, it } from "vitest"
import { makeAccount, makeCtx } from "../test-helpers.js"

const loadPlugin = async () => {
  await import("./plugin.js")
  return globalThis.__openusage_plugin
}

const BASE = "https://openrouter.ai/api/v1"
const URL_KEY = BASE + "/key"
const URL_CREDITS = BASE + "/credits"
const URL_KEYS_PAGE0 = BASE + "/keys?include_disabled=true&include_expired=true&offset=0"
const URL_ACTIVITY = BASE + "/activity"

// Routes by URL. A route is { status, body }; status defaults to 200.
const mockHttp = (ctx, routes) => {
  ctx.host.http.request.mockImplementation((opts) => {
    const route = routes[opts.url]
    if (!route) throw new Error("unexpected request: " + opts.url)
    return { status: route.status ?? 200, headers: {}, bodyText: JSON.stringify(route.body ?? {}) }
  })
}

const captureThrow = (fn) => {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error("expected probe to throw")
}

const findLine = (lines, label) => lines.find((line) => line.label === label)

const MANAGEMENT_KEY_BODY = {
  data: {
    is_management_key: true,
    is_free_tier: false,
    limit: null,
    effective_budget: { limit_usd: 50, spend_usd: 12.5, reset_interval: "monthly" },
    free_model_daily_requests: { limit: 50, used: 7 },
  },
}

const CREDITS_BODY = { data: { total_credits: 100, total_usage: 40 } }

const KEYS_BODY = {
  data: [
    { usage_daily: 1, usage_weekly: 3, usage_monthly: 10, byok_usage_monthly: 99 },
    { usage_daily: 0.5, usage_weekly: 2, usage_monthly: 4, disabled: true },
  ],
}

const ACTIVITY_BODY = {
  data: [
    { date: "2026-02-01", model: "a", usage: 2, prompt_tokens: 10, completion_tokens: 5 },
    { date: "2026-01-20", model: "b", usage: 3, prompt_tokens: 10, completion_tokens: 5 },
  ],
}

const managementRoutes = () => ({
  [URL_KEY]: { body: MANAGEMENT_KEY_BODY },
  [URL_CREDITS]: { body: CREDITS_BODY },
  [URL_KEYS_PAGE0]: { body: KEYS_BODY },
  [URL_ACTIVITY]: { body: ACTIVITY_BODY },
})

describe("openrouter plugin", () => {
  let plugin

  beforeEach(async () => {
    plugin = await loadPlugin()
  })

  it("throws the sign-in message when the API key is missing", () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({})

    const error = captureThrow(() => plugin.probe(ctx))

    expect(error).toBe("Sign in again in Settings → Accounts.")
    expect(ctx.host.http.request).not.toHaveBeenCalled()
  })

  it("reads a management key: balance, spend windows, activity and key budgets", () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({ apiKey: "mgmt-key" })
    mockHttp(ctx, managementRoutes())

    const out = plugin.probe(ctx)

    for (const call of ctx.host.http.request.mock.calls) {
      expect(call[0].headers.Authorization).toBe("Bearer mgmt-key")
    }
    expect(out.plan).toBe("Pay-as-you-go")
    expect(out.lines.map((line) => line.label)).toEqual([
      "Balance",
      "Today",
      "Yesterday",
      "This Week",
      "This Month",
      "Prior 30 Days",
      "Budget",
      "Free Requests",
    ])
    expect(findLine(out.lines, "Balance")).toMatchObject({ value: "$60.00 left" })
    expect(findLine(out.lines, "Today")).toMatchObject({ value: "$1.50" })
    expect(findLine(out.lines, "This Week")).toMatchObject({ value: "$5.00" })
    expect(findLine(out.lines, "This Month")).toMatchObject({ value: "$14.00" })
    expect(findLine(out.lines, "Yesterday")).toMatchObject({ value: "$2.00" })
    expect(findLine(out.lines, "Prior 30 Days")).toMatchObject({ value: "$5.00" })

    expect(findLine(out.lines, "Budget")).toMatchObject({
      used: 12.5,
      limit: 50,
      format: { kind: "dollars" },
      resetsAt: "2026-03-01T00:00:00.000Z",
      periodDurationMs: 28 * 24 * 60 * 60 * 1000,
    })
    expect(findLine(out.lines, "Free Requests")).toMatchObject({
      used: 7,
      limit: 50,
      format: { kind: "count", suffix: "requests" },
      resetsAt: "2026-02-03T00:00:00.000Z",
      periodDurationMs: 24 * 60 * 60 * 1000,
    })
    expect(findLine(out.lines, "Key Limit")).toBeUndefined()
  })

  it("throws the invalid key message on 401", () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({ apiKey: "bad-key" })
    mockHttp(ctx, { [URL_KEY]: { status: 401 } })

    const error = captureThrow(() => plugin.probe(ctx))

    expect(error).toBe("Invalid API key. Replace it in Settings → Accounts.")
  })

  it("reads a standard key: its own spend, Free plan and Key Limit, with no balance", () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({ apiKey: "std-key" })
    mockHttp(ctx, {
      [URL_KEY]: {
        body: {
          data: {
            is_management_key: false,
            is_free_tier: true,
            usage_daily: 0.25,
            usage_weekly: 1.5,
            usage_monthly: 4,
            limit: 10,
            limit_remaining: 4,
            limit_reset: "daily",
          },
        },
      },
    })

    const out = plugin.probe(ctx)

    expect(out.plan).toBe("Free")
    expect(findLine(out.lines, "Balance")).toBeUndefined()
    expect(findLine(out.lines, "Today")).toMatchObject({ value: "$0.25" })
    expect(findLine(out.lines, "This Week")).toMatchObject({ value: "$1.50" })
    expect(findLine(out.lines, "This Month")).toMatchObject({ value: "$4.00" })
    expect(findLine(out.lines, "Yesterday")).toMatchObject({ value: "$0.00" })
    expect(findLine(out.lines, "Prior 30 Days")).toMatchObject({ value: "$0.00" })
    expect(findLine(out.lines, "Key Limit")).toMatchObject({
      used: 6,
      limit: 10,
      format: { kind: "dollars" },
      resetsAt: "2026-02-03T00:00:00.000Z",
    })
    expect(ctx.host.http.request.mock.calls.some((c) => c[0].url === URL_CREDITS)).toBe(false)
  })

  it("omits Balance on a workspace-scoped management key whose /credits answers 403", () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({ apiKey: "ws-key" })
    mockHttp(ctx, { ...managementRoutes(), [URL_CREDITS]: { status: 403 } })

    const out = plugin.probe(ctx)

    expect(findLine(out.lines, "Balance")).toBeUndefined()
    expect(findLine(out.lines, "Today")).toMatchObject({ value: "$1.50" })
    expect(findLine(out.lines, "This Month")).toMatchObject({ value: "$14.00" })
    expect(findLine(out.lines, "Prior 30 Days")).toMatchObject({ value: "$5.00" })
  })
})
