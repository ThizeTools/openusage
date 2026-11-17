import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeAccount, makeCtx } from "../test-helpers.js"

const loadPlugin = async () => {
  await import("./plugin.js")
  return globalThis.__openusage_plugin
}

const NOW_MS = Date.parse("2026-02-02T00:00:00.000Z")
const NOW_SEC = NOW_MS / 1000
const USER_STATUS_URL = "https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus"
const SIGN_IN = "Sign in again in Settings"

const json = (body, status = 200) => ({ status, headers: {}, bodyText: JSON.stringify(body) })

const userStatusBody = {
  userStatus: {
    email: "dev@example.com",
    planStatus: {
      planInfo: { planName: "Pro", hideDailyQuota: false },
      dailyQuotaRemainingPercent: 80,
      dailyQuotaResetAtUnix: NOW_SEC + 3600,
      weeklyQuotaRemainingPercent: 40,
      weeklyQuotaResetAtUnix: NOW_SEC + 3 * 86400,
      overageBalanceMicros: 2500000,
    },
  },
}

describe("devin plugin", () => {
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

  it("builds quota and balance lines from GetUserStatus and sets the label", async () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({ token: "abc" })
    ctx.host.http.request.mockReturnValue(json(userStatusBody))

    const plugin = await loadPlugin()
    const out = plugin.probe(ctx)

    const call = ctx.host.http.request.mock.calls[0][0]
    expect(call.method).toBe("POST")
    expect(call.url).toBe(USER_STATUS_URL)
    expect(JSON.parse(call.bodyText).metadata.apiKey).toBe("devin-session-token$abc")

    expect(out.plan).toBe("Pro")
    expect(out.lines).toEqual([
      expect.objectContaining({ type: "progress", label: "Daily quota", used: 20, limit: 100, periodDurationMs: 86400000 }),
      expect.objectContaining({ type: "progress", label: "Weekly quota", used: 60, limit: 100, periodDurationMs: 604800000 }),
      { type: "text", label: "Extra usage balance", value: "$2.50 left" },
    ])
    expect(out.lines[0].resetsAt).toBe(new Date((NOW_SEC + 3600) * 1000).toISOString())
    expect(ctx.account.setLabel).toHaveBeenCalledWith("dev@example.com")
  })

  it("does not add the session prefix twice", async () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({ token: "devin-session-token$xyz" })
    ctx.host.http.request.mockReturnValue(json(userStatusBody))

    const plugin = await loadPlugin()
    plugin.probe(ctx)

    const call = ctx.host.http.request.mock.calls[0][0]
    expect(JSON.parse(call.bodyText).metadata.apiKey).toBe("devin-session-token$xyz")
  })

  it("asks for sign-in when the key is refused", async () => {
    const ctx = makeCtx()
    ctx.account = makeAccount({ token: "abc" })
    ctx.host.http.request.mockReturnValue(json({}, 401))

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow(SIGN_IN)
    expect(ctx.account.saveCredentials).not.toHaveBeenCalled()
  })
})
