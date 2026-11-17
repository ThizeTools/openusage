import { beforeEach, describe, expect, it } from "vitest"
import { makeAccount, makeCtx } from "../test-helpers.js"

const loadPlugin = async () => {
  await import("./plugin.js")
  return globalThis.__openusage_plugin
}

const URL_BALANCE = "https://ollama.com/api/balance"
const URL_ME = "https://ollama.com/api/me"
const URL_USAGE = "https://ollama.com/api/usage?range=30d&group_by=model"

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

const BALANCE_BODY = {
  included: {
    session: { remaining_percent: 70, resets_at: "2026-02-02T05:00:00Z" },
    weekly: { remaining_percent: 40, resets_at: "2026-02-08T00:00:00Z" },
    allowance_usd: 20,
    balance_usd: 15,
    period: { from: "2026-02-01T00:00:00Z", until: "2026-03-01T00:00:00Z" },
  },
  purchased: { balance_usd: 3.5 },
}

const ME_BODY = { Plan: "pro", Email: "user@example.com" }

const USAGE_BODY = {
  granularity: "day",
  buckets: [
    {
      from: "2026-02-02T00:00:00Z",
      until: "2026-02-03T00:00:00Z",
      request_count: 10,
      usage_usd: 1.25,
      input_tokens: 1000,
      cached_input_tokens: 200,
      output_tokens: 500,
    },
    {
      from: "2026-02-01T00:00:00Z",
      until: "2026-02-02T00:00:00Z",
      request_count: 4,
      usage_usd: 0.5,
      input_tokens: 300,
      output_tokens: 100,
    },
  ],
}

describe("ollama plugin", () => {
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

  it("reads balance, plan, email and 30-day history with the bearer key", () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({ apiKey: "key-123" })
    mockHttp(ctx, {
      [URL_BALANCE]: { body: BALANCE_BODY },
      [URL_ME]: { body: ME_BODY },
      [URL_USAGE]: { body: USAGE_BODY },
    })

    const out = plugin.probe(ctx)

    for (const call of ctx.host.http.request.mock.calls) {
      expect(call[0].headers.Authorization).toBe("Bearer key-123")
    }
    expect(ctx.host.http.request.mock.calls.find((c) => c[0].url === URL_ME)[0].method).toBe("POST")
    expect(out.plan).toBe("Pro")
    expect(ctx.account.setLabel).toHaveBeenCalledWith("user@example.com")

    const session = findLine(out.lines, "Session")
    expect(session).toMatchObject({ type: "progress", used: 30, limit: 100, format: { kind: "percent" } })
    expect(session.resetsAt).toBe("2026-02-02T05:00:00.000Z")
    expect(session.periodDurationMs).toBe(5 * 60 * 60 * 1000)

    const weekly = findLine(out.lines, "Weekly")
    expect(weekly).toMatchObject({ used: 60, limit: 100 })
    expect(weekly.periodDurationMs).toBe(7 * 24 * 60 * 60 * 1000)

    expect(findLine(out.lines, "Monthly")).toMatchObject({
      used: 5,
      limit: 20,
      format: { kind: "dollars" },
      resetsAt: "2026-03-01T00:00:00.000Z",
      periodDurationMs: 28 * 24 * 60 * 60 * 1000,
    })

    expect(findLine(out.lines, "Purchased Credits")).toMatchObject({ type: "text", value: "$3.50 left" })
    expect(findLine(out.lines, "Today")).toMatchObject({ type: "text", value: "$1.25", subtitle: "1.5K tokens" })
    expect(findLine(out.lines, "Yesterday")).toMatchObject({ type: "text", value: "$0.50", subtitle: "400 tokens" })
    expect(findLine(out.lines, "Last 30 Days")).toMatchObject({ type: "text", value: "$1.75", subtitle: "1.9K tokens" })
    expect(findLine(out.lines, "Requests")).toMatchObject({ type: "text", value: "14 requests" })
  })

  it("throws the invalid key message on 401", () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({ apiKey: "bad-key" })
    mockHttp(ctx, { [URL_BALANCE]: { status: 401 } })

    const error = captureThrow(() => plugin.probe(ctx))

    expect(error).toBe("Invalid API key. Replace it in Settings → Accounts.")
  })

  it("shows only Requests when the plan reports no dollar figures", () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({ apiKey: "key-123" })
    mockHttp(ctx, {
      [URL_BALANCE]: { body: BALANCE_BODY },
      [URL_ME]: { status: 500 },
      [URL_USAGE]: {
        body: {
          granularity: "day",
          buckets: [{ from: "2026-02-02T00:00:00Z", until: "2026-02-03T00:00:00Z", request_count: 7 }],
        },
      },
    })

    const out = plugin.probe(ctx)

    expect(findLine(out.lines, "Today")).toBeUndefined()
    expect(findLine(out.lines, "Yesterday")).toBeUndefined()
    expect(findLine(out.lines, "Last 30 Days")).toBeUndefined()
    expect(findLine(out.lines, "Requests")).toMatchObject({ value: "7 requests" })
    expect(out.plan).toBeUndefined()
    expect(ctx.account.setLabel).not.toHaveBeenCalled()
  })
})
