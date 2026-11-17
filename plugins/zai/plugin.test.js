import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeAccount, makeCtx } from "../test-helpers.js"

const SIGN_IN = "Sign in again in Settings → Accounts."
const HOUR_MS = 60 * 60 * 1000
const MONTH_MS = 30 * 24 * HOUR_MS

const loadPlugin = async () => {
  await import("./plugin.js")
  return globalThis.__openusage_plugin
}

const json = (status, body) => ({ status, headers: {}, bodyText: JSON.stringify(body) })

const thrown = (fn) => {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error("expected probe to throw")
}

const routeHttp = (ctx, routes) => {
  ctx.host.http.request.mockImplementation((opts) => {
    const key = opts.method + " " + opts.url
    if (!(key in routes)) throw new Error("unexpected request " + key)
    return routes[key]
  })
}

const QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit"
const SUB_URL = "https://api.z.ai/api/biz/subscription/list"

const QUOTA_BODY = {
  code: 200,
  success: true,
  data: {
    limits: [
      { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 10, nextResetTime: Date.now() + HOUR_MS },
      { type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 30, nextResetTime: Date.now() + 2 * 24 * HOUR_MS },
      { type: "TIME_LIMIT", unit: 5, number: 1, usage: 100, currentValue: 7, nextResetTime: Date.now() + 10 * 24 * HOUR_MS },
    ],
  },
}

describe("zai plugin", () => {
  let ctx
  let probe

  beforeEach(async () => {
    ctx = makeCtx()
    probe = (await loadPlugin()).probe
  })

  it("throws the sign-in message without an API key", () => {
    ctx.account = makeAccount({})
    expect(thrown(() => probe(ctx))).toBe(SIGN_IN)
    expect(ctx.host.http.request).not.toHaveBeenCalled()
  })

  it("returns session, weekly and web search lines with the plan", () => {
    ctx.account = makeAccount({ apiKey: "zai-key" })
    routeHttp(ctx, {
      [`GET ${QUOTA_URL}`]: json(200, QUOTA_BODY),
      [`GET ${SUB_URL}`]: json(200, { data: [{ productName: "GLM Coding Plan Pro" }] }),
    })

    const result = probe(ctx)

    expect(result.plan).toBe("GLM Coding Plan Pro")
    expect(result.lines.map((l) => l.label)).toEqual(["Session", "Weekly", "Web Searches"])
    expect(result.lines[0]).toMatchObject({ used: 10, limit: 100, periodDurationMs: 5 * HOUR_MS })
    expect(result.lines[1]).toMatchObject({ used: 30, periodDurationMs: 7 * 24 * HOUR_MS })
    expect(result.lines[2]).toMatchObject({
      used: 7,
      limit: 100,
      format: { kind: "count", suffix: "searches" },
      periodDurationMs: MONTH_MS,
    })

    const quotaCall = ctx.host.http.request.mock.calls.find(([o]) => o.url === QUOTA_URL)[0]
    expect(quotaCall.headers.Authorization).toBe("Bearer zai-key")
  })

  it("throws the sign-in message when the key is rejected", () => {
    ctx.account = makeAccount({ apiKey: "bad" })
    routeHttp(ctx, { [`GET ${QUOTA_URL}`]: json(401, {}) })
    expect(thrown(() => probe(ctx))).toBe(SIGN_IN)
  })

  it("throws the sign-in message on a 200 body with code 401", () => {
    ctx.account = makeAccount({ apiKey: "bad" })
    routeHttp(ctx, { [`GET ${QUOTA_URL}`]: json(200, { success: false, code: 401 }) })
    expect(thrown(() => probe(ctx))).toBe(SIGN_IN)
  })

  it("explains a key without a GLM Coding Plan", () => {
    ctx.account = makeAccount({ apiKey: "k" })
    routeHttp(ctx, {
      [`GET ${QUOTA_URL}`]: json(200, { success: false, msg: "No Coding Plan for this account" }),
    })
    expect(thrown(() => probe(ctx))).toBe(
      "No active GLM Coding Plan. Subscribe at z.ai/subscribe to see usage.",
    )
  })

  it("keeps the usage lines when the plan lookup fails", () => {
    ctx.account = makeAccount({ apiKey: "k" })
    routeHttp(ctx, {
      [`GET ${QUOTA_URL}`]: json(200, QUOTA_BODY),
      [`GET ${SUB_URL}`]: json(500, {}),
    })

    const result = probe(ctx)

    expect(result.plan).toBeUndefined()
    expect(result.lines).toHaveLength(3)
    expect(ctx.host.log.warn).toHaveBeenCalled()
  })

  it("skips the web search line when its limit is zero", () => {
    ctx.account = makeAccount({ apiKey: "k" })
    routeHttp(ctx, {
      [`GET ${QUOTA_URL}`]: json(200, {
        data: {
          limits: [
            { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 1 },
            { type: "TIME_LIMIT", usage: 0, currentValue: 0 },
          ],
        },
      }),
      [`GET ${SUB_URL}`]: json(200, { data: [] }),
    })

    const result = probe(ctx)

    expect(result.lines.map((l) => l.label)).toEqual(["Session"])
    expect(ctx.host.log.warn).toHaveBeenCalled()
  })
})
