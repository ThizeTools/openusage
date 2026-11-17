import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeAccount, makeCtx } from "../test-helpers.js"

const SIGN_IN = "Sign in again in Settings → Accounts."
const KEY_URL = "https://api.meta.ai/muse-code/key"
const HOUR_MS = 60 * 60 * 1000

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

const FUTURE = () => Date.now() + HOUR_MS

const KEY_BODY = {
  is_subs_active: true,
  subs_tier_name: "Max",
  user_email: "dev@example.com",
  model_api_key: "SECRET-MODEL-KEY",
  subs_usage: {
    window: { used_percent: 35, resets_at: 1800000000 },
    weekly: { used_percent: 12, resets_at: 1800600000 },
  },
}

describe("muse plugin", () => {
  let ctx
  let probe

  beforeEach(async () => {
    ctx = makeCtx()
    probe = (await loadPlugin()).probe
  })

  it("throws the sign-in message without credentials", () => {
    ctx.account = makeAccount({})
    expect(thrown(() => probe(ctx))).toBe(SIGN_IN)
    expect(ctx.host.http.request).not.toHaveBeenCalled()
  })

  it("throws the sign-in message without a request when the sign-in has expired", () => {
    ctx.account = makeAccount({ access_token: "tok", expiresAt: Date.now() - 1000 })
    expect(thrown(() => probe(ctx))).toBe(SIGN_IN)
    expect(ctx.host.http.request).not.toHaveBeenCalled()
  })

  it("posts the key request and returns session and weekly lines", () => {
    ctx.account = makeAccount({ access_token: "tok", expiresAt: FUTURE() })
    ctx.host.http.request.mockReturnValue(json(200, KEY_BODY))

    const result = probe(ctx)

    const call = ctx.host.http.request.mock.calls[0][0]
    expect(call.method).toBe("POST")
    expect(call.url).toBe(KEY_URL)
    expect(call.headers.Authorization).toBe("Bearer tok")
    expect(call.headers["x-api-version"]).toBe("1.0.0")
    expect(call.bodyText).toBe('{"onboard":false}')

    expect(result.plan).toBe("Max")
    expect(result.lines.map((l) => l.label)).toEqual(["Session", "Weekly"])
    expect(result.lines[0]).toMatchObject({
      used: 35,
      limit: 100,
      periodDurationMs: 5 * HOUR_MS,
      resetsAt: new Date(1800000000 * 1000).toISOString(),
    })
    expect(result.lines[1]).toMatchObject({ used: 12, resetsAt: new Date(1800600000 * 1000).toISOString() })
    expect(ctx.account.setLabel).toHaveBeenCalledWith("dev@example.com")
  })

  it("never puts the Model API key in the output", () => {
    ctx.account = makeAccount({ access_token: "tok", expiresAt: FUTURE() })
    ctx.host.http.request.mockReturnValue(json(200, KEY_BODY))

    const result = probe(ctx)

    expect(JSON.stringify(result)).not.toContain("SECRET-MODEL-KEY")
    expect(JSON.stringify(ctx.host.log.info.mock.calls)).not.toContain("SECRET-MODEL-KEY")
  })

  it("reads 0% for both windows when Muse reports no usage", () => {
    ctx.account = makeAccount({ access_token: "tok", expiresAt: FUTURE() })
    ctx.host.http.request.mockReturnValue(json(200, { is_subs_active: true }))

    const result = probe(ctx)

    expect(result.plan).toBeUndefined()
    expect(result.lines.map((l) => [l.label, l.used, l.resetsAt])).toEqual([
      ["Session", 0, undefined],
      ["Weekly", 0, undefined],
    ])
  })

  it("throws when the account has no Muse Code subscription", () => {
    ctx.account = makeAccount({ access_token: "tok", expiresAt: FUTURE() })
    ctx.host.http.request.mockReturnValue(json(200, { is_subs_active: false }))
    expect(thrown(() => probe(ctx))).toBe("No Muse Code subscription on this account.")
  })

  it("throws the sign-in message when Meta refuses the token", () => {
    ctx.account = makeAccount({ access_token: "tok", expiresAt: FUTURE() })
    ctx.host.http.request.mockReturnValue(json(401, {}))
    expect(thrown(() => probe(ctx))).toBe(SIGN_IN)
  })
})
