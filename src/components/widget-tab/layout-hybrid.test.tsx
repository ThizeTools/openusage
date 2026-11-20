import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LayoutHybrid } from "@/components/widget-tab/layout-hybrid"
import type { WidgetTabModel } from "@/components/widget-tab/types"
import { makeWidgetTabModel } from "@/test/widget-tab-model"

vi.mock("@/lib/menubar-widget-image", async () => ({
  ...(await vi.importActual<typeof import("@/lib/menubar-widget-image")>("@/lib/menubar-widget-image")),
  renderMenuBarWidgetPng: vi.fn(async () => "AAAA"),
}))

vi.mock("@/lib/icon-mask", () => ({
  getIconMask: vi.fn(async () => null),
}))

afterEach(() => cleanup())

/** Keeps the model's values in state so edits are reflected back, like the Settings page does. */
function Stateful({ initial }: { initial?: Partial<WidgetTabModel> }) {
  const base = makeWidgetTabModel(initial)
  const [style, setStyle] = useState(base.style)
  const [backdrop, setBackdrop] = useState(base.backdrop)
  const [textColors, setTextColors] = useState(base.textColors)
  const [toneModes, setToneModes] = useState(base.toneModes)
  return (
    <LayoutHybrid
      model={{
        ...base,
        style,
        onStyleChange: setStyle,
        backdrop,
        onBackdropChange: setBackdrop,
        textColors,
        onTextColorsChange: setTextColors,
        toneModes,
        onToneModesChange: setToneModes,
      }}
    />
  )
}

const tab = (name: string) => screen.getByRole("tab", { name })
const openTab = (name: string) => userEvent.click(tab(name))
const header = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title}`) })
const summaryOf = (title: string) => within(header(title)).getByTestId("section-summary")

describe("LayoutHybrid", () => {
  it("has the visibility switch", async () => {
    const model = makeWidgetTabModel({ visible: false })
    render(<LayoutHybrid model={model} />)
    await openTab("Menu Bar")
    expect(screen.getByTestId("menu-bar-preview-strip")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("switch", { name: "Show widget in menu bar" }))
    expect(model.onVisibleChange).toHaveBeenCalledWith(true)
  })

  it("lists the nav items in order: Providers, Menu Bar, Colors (no Dock off macOS)", () => {
    render(<LayoutHybrid model={makeWidgetTabModel()} />)
    expect(screen.getByRole("tablist")).toHaveAttribute("aria-orientation", "vertical")
    expect(screen.getAllByRole("tab").map((item) => item.textContent)).toEqual(["Providers", "Menu Bar", "Colors"])
    expect(tab("Providers")).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tabpanel")).toBeInTheDocument()
    expect(screen.queryByTestId("widget-dock")).toBeNull()
  })

  it("switching tabs swaps the pane", async () => {
    render(<LayoutHybrid model={makeWidgetTabModel()} />)
    expect(screen.getByTestId("widget-providers")).toBeInTheDocument()
    expect(screen.queryByTestId("menu-bar-preview-strip")).toBeNull()
    await openTab("Menu Bar")
    expect(tab("Menu Bar")).toHaveAttribute("aria-selected", "true")
    expect(tab("Providers")).toHaveAttribute("aria-selected", "false")
    expect(screen.queryByTestId("widget-providers")).toBeNull()
    expect(screen.getByTestId("menu-bar-preview-strip")).toBeInTheDocument()
    await openTab("Colors")
    expect(screen.queryByTestId("menu-bar-preview-strip")).toBeNull()
    expect(screen.getByTestId("pace-thresholds")).toBeInTheDocument()
    expect(screen.getByTestId("menu-bar-widget-tone-colors")).toBeInTheDocument()
    expect(screen.getByTestId("menu-bar-widget-text-colors")).toBeInTheDocument()
  })

  it("shows no presets, only the collapsed Layout / Background accordion with summaries", async () => {
    render(<LayoutHybrid model={makeWidgetTabModel()} />)
    expect(within(screen.getByTestId("widget-providers")).getByTestId("widget-providers-list")).toBeInTheDocument()
    await openTab("Menu Bar")
    expect(screen.queryByRole("radiogroup", { name: "Widget preset" })).toBeNull()
    expect(screen.queryByTestId("preset-summary")).toBeNull()
    for (const title of ["Layout", "Background"]) {
      expect(header(title)).toHaveAttribute("aria-expanded", "false")
    }
    expect(summaryOf("Layout")).toHaveTextContent("Compact")
    expect(summaryOf("Background")).toHaveTextContent("Auto · blur 50%")
    expect(screen.queryByRole("button", { name: /^Colors/ })).toBeNull()
  })
  it("accordion sections expand and collapse independently", async () => {
    render(<LayoutHybrid model={makeWidgetTabModel()} />)
    await openTab("Menu Bar")
    await userEvent.click(header("Layout"))
    expect(screen.getByRole("radiogroup", { name: "Menu bar style" })).toBeInTheDocument()
    await userEvent.click(header("Background"))
    expect(screen.getByTestId("menu-bar-widget-backdrop")).toBeInTheDocument()
    expect(screen.getByRole("radiogroup", { name: "Menu bar style" })).toBeInTheDocument()
    await userEvent.click(header("Layout"))
    expect(screen.queryByRole("radiogroup", { name: "Menu bar style" })).toBeNull()
  })

  it("section controls call the model", async () => {
    const model = makeWidgetTabModel()
    render(<LayoutHybrid model={model} />)
    await openTab("Menu Bar")
    await userEvent.click(header("Background"))
    await userEvent.click(screen.getByRole("switch", { name: "Show background" }))
    expect(model.onBackdropChange).toHaveBeenLastCalledWith({ ...model.backdrop, enabled: false })
    await openTab("Providers")
    await userEvent.click(screen.getByLabelText("ChatGPT"))
    expect(model.onProviderIdsChange).toHaveBeenLastCalledWith(["claude"])
  })
})
