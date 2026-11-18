import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import {
  buildModelDemoPayload,
  selectDemoProviders,
  useModelDemoPayload,
  useTileDemoPayload,
} from "@/components/widget-tab/demo-payload"
import { getIconMask } from "@/lib/icon-mask"
import { makeWidgetTabModel } from "@/test/widget-tab-model"

vi.mock("@/lib/icon-mask", () => ({
  getIconMask: vi.fn(async (url: string) => `mask:${url}`),
}))

const noMask = () => null
const ids = (payload: ReturnType<typeof buildModelDemoPayload>) => payload.providers.map((provider) => provider.id)
const labels = (payload: ReturnType<typeof buildModelDemoPayload>) =>
  payload.providers.map((provider) => provider.items.map((item) => item.label))

describe("buildModelDemoPayload", () => {
  it("shows every enabled provider when none is selected explicitly, in plugin order, skipping disabled ones", () => {
    const payload = buildModelDemoPayload(makeWidgetTabModel(), noMask)
    expect(ids(payload)).toEqual(["claude", "codex"])
  })

  it("follows a provider subset, and a disabled plugin never shows even when listed", () => {
    expect(ids(buildModelDemoPayload(makeWidgetTabModel({ providerIds: ["codex"] }), noMask))).toEqual(["codex"])
    expect(ids(buildModelDemoPayload(makeWidgetTabModel({ providerIds: ["cursor", "claude"] }), noMask))).toEqual(["claude"])
  })

  it("uses the default metrics, or the selected ones in the provider's metric order", () => {
    expect(labels(buildModelDemoPayload(makeWidgetTabModel(), noMask))).toEqual([
      ["Session", "Weekly"],
      ["Session", "Weekly"],
    ])
    const model = makeWidgetTabModel({ providerIds: ["claude"], providerMetrics: { claude: ["Sonnet", "Session"] } })
    expect(labels(buildModelDemoPayload(model, noMask))).toEqual([["Session", "Sonnet"]])
  })

  it("leaves out a provider without selected metrics", () => {
    const model = makeWidgetTabModel({ providerMetrics: { claude: [] } })
    expect(ids(buildModelDemoPayload(model, noMask))).toEqual(["codex"])
  })

  it("cycles the tones over the items, with matching demo values", () => {
    const model = makeWidgetTabModel({ providerMetrics: { claude: ["Session", "Weekly", "Sonnet"] } })
    const items = buildModelDemoPayload(model, noMask).providers.flatMap((provider) => provider.items)
    expect(items.map((item) => item.tone)).toEqual(["ahead", "behind", "ahead", "behind", "ahead"])
    expect(items.slice(0, 2).map((item) => item.value)).toEqual(["13%/91%", "94%/61%"])

    const close = buildModelDemoPayload(makeWidgetTabModel({ providerIds: ["claude"] }), noMask, ["on-track", "behind"])
    expect(close.providers[0].items.map((item) => [item.tone, item.value])).toEqual([
      ["on-track", "78%/70%"],
      ["behind", "94%/61%"],
    ])
  })

  it("resolves each provider's icon mask from its icon url", () => {
    const payload = buildModelDemoPayload(makeWidgetTabModel(), (url) => `mask:${url}`)
    expect(payload.providers.map((provider) => provider.iconMask)).toEqual(["mask:claude.svg", "mask:codex.svg"])
  })

  it("falls back to a Session/Weekly placeholder so the preview is never empty", () => {
    const model = makeWidgetTabModel({ providerIds: [] })
    const payload = buildModelDemoPayload(model, noMask)
    expect(ids(payload)).toEqual(["demo"])
    expect(labels(payload)).toEqual([["Session", "Weekly"]])
    expect(selectDemoProviders(model)[0].iconUrl).toBe("claude.svg")
  })
})

describe("useModelDemoPayload", () => {
  it("returns the icon masks once they have resolved", async () => {
    const { result } = renderHook(() => useModelDemoPayload(makeWidgetTabModel()))
    expect(result.current.providers.map((provider) => provider.iconMask)).toEqual([null, null])
    await waitFor(() =>
      expect(result.current.providers.map((provider) => provider.iconMask)).toEqual(["mask:claude.svg", "mask:codex.svg"])
    )
    expect(getIconMask).toHaveBeenCalledWith("claude.svg")
  })

  it("is stable while the selection does not change, and follows it when it does", async () => {
    const { result, rerender } = renderHook(({ model }) => useModelDemoPayload(model), {
      initialProps: { model: makeWidgetTabModel() },
    })
    await waitFor(() => expect(result.current.providers[0].iconMask).toBe("mask:claude.svg"))
    const settled = result.current
    // A fresh model object with the same content.
    rerender({ model: makeWidgetTabModel() })
    expect(result.current).toBe(settled)

    rerender({ model: makeWidgetTabModel({ providerIds: ["codex"], providerMetrics: { codex: ["Weekly"] } }) })
    expect(result.current.providers.map((provider) => provider.id)).toEqual(["codex"])
    expect(result.current.providers[0].items.map((item) => item.label)).toEqual(["Weekly"])
    await waitFor(() => expect(result.current.providers[0].iconMask).toBe("mask:codex.svg"))
  })
})

describe("useTileDemoPayload", () => {
  it("limits the payload to the first provider and its first two metrics", () => {
    const model = makeWidgetTabModel({ providerMetrics: { claude: ["Session", "Weekly", "Sonnet"] } })
    const { result } = renderHook(() => useTileDemoPayload(model))
    expect(result.current.providers.map((provider) => provider.id)).toEqual(["claude"])
    expect(result.current.providers[0].items.map((item) => item.label)).toEqual(["Session", "Weekly"])
  })
})
