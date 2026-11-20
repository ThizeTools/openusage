import { cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ loadMock: vi.fn(), saveMock: vi.fn() }))

vi.mock("@/lib/settings", async () => ({
  ...(await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings")),
  loadSurfaceOverrides: state.loadMock,
  saveSurfaceOverrides: state.saveMock,
}))

import { SurfaceOverrides, withOverrides } from "@/components/widget-tab/surface-overrides"
import { useSurfaceOverrides } from "@/components/widget-tab/use-surface-overrides"
import { DEFAULT_SURFACE_OVERRIDES, type SurfaceOverrides as Overrides } from "@/lib/settings"
import { makeWidgetTabModel } from "@/test/widget-tab-model"

beforeEach(() => {
  state.loadMock.mockReset().mockResolvedValue(DEFAULT_SURFACE_OVERRIDES)
  state.saveMock.mockReset().mockResolvedValue(undefined)
})
afterEach(() => cleanup())

const ownColors = {
  colors: { behind: "#ff0000" },
  textColors: { label: "color", used: "mono", expected: "mono" },
  toneModes: { ahead: "color", onTrack: "color", behind: "color" },
} as const

/** Keeps the overrides in state like a pane does; `onChange` spies on every change. */
function Harness({ initial = DEFAULT_SURFACE_OVERRIDES, model, onChange }: { initial?: Overrides; model: ReturnType<typeof makeWidgetTabModel>; onChange: (value: Overrides) => void }) {
  const [overrides, setOverrides] = useState(initial)
  return (
    <SurfaceOverrides
      model={model}
      surface="dock"
      overrides={overrides}
      onChange={(value) => {
        onChange(value)
        setOverrides(value)
      }}
    />
  )
}

describe("SurfaceOverrides", () => {
  it("shows both rows off with their descriptions and no editors", () => {
    render(<Harness model={makeWidgetTabModel()} onChange={vi.fn()} />)
    expect(screen.getByText("Overrides")).toBeInTheDocument()
    expect(screen.getByText("Off: uses the Providers tab.")).toBeInTheDocument()
    expect(screen.getByText("Off: uses the Colors tab. Pace thresholds always come from Colors.")).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "Own providers" })).toHaveAttribute("aria-checked", "false")
    expect(screen.getByRole("switch", { name: "Own colors" })).toHaveAttribute("aria-checked", "false")
    expect(screen.queryByTestId("widget-providers-list")).toBeNull()
    expect(screen.queryByTestId("menu-bar-widget-tone-colors")).toBeNull()
  })

  it("own providers on copies the global selection, off sets null", async () => {
    const onChange = vi.fn()
    const model = makeWidgetTabModel({ providerIds: ["claude"], providerMetrics: { claude: ["Session"] } })
    render(<Harness model={model} onChange={onChange} />)
    await userEvent.click(screen.getByRole("switch", { name: "Own providers" }))
    expect(onChange).toHaveBeenLastCalledWith({
      colors: null,
      providers: { providerIds: ["claude"], providerMetrics: { claude: ["Session"] } },
    })
    expect(screen.getByTestId("widget-providers-list")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("switch", { name: "Own providers" }))
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_SURFACE_OVERRIDES)
    expect(screen.queryByTestId("widget-providers-list")).toBeNull()
  })

  it("editing providers writes into the override, not the global handlers", async () => {
    const onChange = vi.fn()
    const model = makeWidgetTabModel({ providerIds: ["claude", "codex"] })
    render(<Harness model={model} onChange={onChange} />)
    await userEvent.click(screen.getByRole("switch", { name: "Own providers" }))
    await userEvent.click(screen.getByLabelText("ChatGPT"))
    expect(onChange).toHaveBeenLastCalledWith({
      colors: null,
      providers: { providerIds: ["claude"], providerMetrics: {} },
    })
    await userEvent.click(screen.getByLabelText("Sonnet"))
    expect(onChange).toHaveBeenLastCalledWith({
      colors: null,
      providers: { providerIds: ["claude"], providerMetrics: { claude: ["Session", "Weekly", "Sonnet"] } },
    })
    expect(model.onProviderIdsChange).not.toHaveBeenCalled()
    expect(model.onProviderMetricsChange).not.toHaveBeenCalled()
  })

  it("own colors on copies the global colors, off sets null", async () => {
    const onChange = vi.fn()
    const model = makeWidgetTabModel({ colors: { ahead: "#00ff00" } })
    render(<Harness model={model} onChange={onChange} />)
    await userEvent.click(screen.getByRole("switch", { name: "Own colors" }))
    expect(onChange).toHaveBeenLastCalledWith({
      colors: { colors: { ahead: "#00ff00" }, textColors: model.textColors, toneModes: model.toneModes },
      providers: null,
    })
    expect(screen.getByTestId("menu-bar-widget-tone-colors")).toBeInTheDocument()
    expect(screen.getByTestId("menu-bar-widget-text-colors")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reset all" })).toBeInTheDocument()
    await userEvent.click(screen.getByRole("switch", { name: "Own colors" }))
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_SURFACE_OVERRIDES)
  })

  it("editing colors writes into the override, not the global handlers", async () => {
    const onChange = vi.fn()
    const model = makeWidgetTabModel()
    render(<Harness initial={{ colors: ownColors, providers: null }} model={model} onChange={onChange} />)
    const label = screen.getByRole("radiogroup", { name: "Label text color" })
    await userEvent.click(within(label).getByRole("radio", { name: "Mono" }))
    expect(onChange).toHaveBeenLastCalledWith({
      colors: { ...ownColors, textColors: { ...ownColors.textColors, label: "mono" } },
      providers: null,
    })
    await userEvent.click(screen.getByRole("button", { name: "Reset all" }))
    expect(onChange).toHaveBeenLastCalledWith({
      colors: { ...ownColors, textColors: { ...ownColors.textColors, label: "mono" }, colors: {} },
      providers: null,
    })
    expect(model.onTextColorsChange).not.toHaveBeenCalled()
    expect(model.onColorsChange).not.toHaveBeenCalled()
  })

  it("keeps the other part when one switch changes", async () => {
    const onChange = vi.fn()
    render(<Harness initial={{ colors: ownColors, providers: null }} model={makeWidgetTabModel()} onChange={onChange} />)
    await userEvent.click(screen.getByRole("switch", { name: "Own providers" }))
    expect(onChange.mock.lastCall?.[0].colors).toEqual(ownColors)
    expect(onChange.mock.lastCall?.[0].providers).not.toBeNull()
  })
})

describe("withOverrides", () => {
  it("replaces providers and colors only where overridden", () => {
    const model = makeWidgetTabModel({ providerIds: ["claude"], colors: { ahead: "#00ff00" } })
    expect(withOverrides(model, DEFAULT_SURFACE_OVERRIDES)).toMatchObject({ providerIds: ["claude"], colors: { ahead: "#00ff00" } })
    const view = withOverrides(model, { colors: ownColors, providers: { providerIds: ["codex"], providerMetrics: {} } })
    expect(view.providerIds).toEqual(["codex"])
    expect(view.colors).toEqual(ownColors.colors)
    expect(view.toneModes).toEqual(ownColors.toneModes)
    expect(view.onColorsChange).toBe(model.onColorsChange)
  })
})

describe("useSurfaceOverrides", () => {
  it("loads on mount and saves on set", async () => {
    state.loadMock.mockResolvedValue({ colors: null, providers: { providerIds: ["a"], providerMetrics: {} } })
    const { result } = renderHook(() => useSurfaceOverrides("dock"))
    await waitFor(() => expect(result.current[0].providers?.providerIds).toEqual(["a"]))
    expect(state.loadMock).toHaveBeenCalledWith("dock")
    result.current[1](DEFAULT_SURFACE_OVERRIDES)
    await waitFor(() => expect(result.current[0]).toEqual(DEFAULT_SURFACE_OVERRIDES))
    expect(state.saveMock).toHaveBeenCalledWith("dock", DEFAULT_SURFACE_OVERRIDES)
  })

  it("logs a load failure and keeps the defaults", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    state.loadMock.mockRejectedValue(new Error("store unavailable"))
    const { result } = renderHook(() => useSurfaceOverrides("menuBar"))
    await waitFor(() => expect(consoleError).toHaveBeenCalled())
    expect(result.current[0]).toEqual(DEFAULT_SURFACE_OVERRIDES)
    consoleError.mockRestore()
  })
})
