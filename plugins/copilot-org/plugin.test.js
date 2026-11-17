import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeAccount, makeCtx } from "../test-helpers.js"

const loadPlugin = async () => {
  delete globalThis.__openusage_plugin
  vi.resetModules()
  await import("./plugin.js")
  return globalThis.__openusage_plugin
}

const BILLING_URL =
  "https://api.github.com/organizations/acme/settings/billing/ai_credit/usage"

const billingBody = {
  usageItems: [
    { product: "Copilot", grossQuantity: 120.5, netAmount: 3.25 },
    { product: "Copilot", grossQuantity: 79.5, netAmount: 1.75 },
    { product: "Actions", grossQuantity: 999, netAmount: 50 },
  ],
}

describe("copilot-org plugin", () => {
  beforeEach(() => {
    delete globalThis.__openusage_plugin
  })

  it("throws sign-in message when organization or token is missing", async () => {
    const plugin = await loadPlugin()
    const ctx = makeCtx()
    ctx.account = makeAccount({ org: "acme" })

    expect(() => plugin.probe(ctx)).toThrow("Sign in again in Settings → Accounts.")
    expect(ctx.host.http.request).not.toHaveBeenCalled()
  })

  it("sums Copilot items into org credits and org spend", async () => {
    const plugin = await loadPlugin()
    const ctx = makeCtx()
    ctx.account = makeAccount({ org: "acme", token: "ghp_org" })
    ctx.host.http.request.mockReturnValue({
      status: 200,
      headers: {},
      bodyText: JSON.stringify(billingBody),
    })

    const result = plugin.probe(ctx)

    expect(result.lines).toEqual([
      { type: "text", label: "Org Credits", value: "200 credits" },
      { type: "text", label: "Org Spend", value: "$5.00" },
    ])
    const call = ctx.host.http.request.mock.calls[0][0]
    expect(call.url).toBe(BILLING_URL)
    expect(call.headers.Authorization).toBe("Bearer ghp_org")
    expect(call.headers["X-GitHub-Api-Version"]).toBe("2022-11-28")
    expect(ctx.account.setLabel).toHaveBeenCalledWith("acme")
  })

  it("asks to sign in again when GitHub returns 401", async () => {
    const plugin = await loadPlugin()
    const ctx = makeCtx()
    ctx.account = makeAccount({ org: "acme", token: "ghp_bad" })
    ctx.host.http.request.mockReturnValue({ status: 401, headers: {}, bodyText: "{}" })

    expect(() => plugin.probe(ctx)).toThrow("Sign in again in Settings → Accounts.")
  })

  it("names the organization when GitHub has no such organization", async () => {
    const plugin = await loadPlugin()
    const ctx = makeCtx()
    ctx.account = makeAccount({ org: "acme", token: "ghp_org" })
    ctx.host.http.request.mockReturnValue({ status: 404, headers: {}, bodyText: "{}" })

    expect(() => plugin.probe(ctx)).toThrow("GitHub has no organization “acme” this token can read.")
  })

  it("fails on a billing report without usage items", async () => {
    const plugin = await loadPlugin()
    const ctx = makeCtx()
    ctx.account = makeAccount({ org: "acme", token: "ghp_org" })
    ctx.host.http.request.mockReturnValue({ status: 200, headers: {}, bodyText: "{}" })

    expect(() => plugin.probe(ctx)).toThrow("Unexpected GitHub billing response. Try again later.")
  })
})
