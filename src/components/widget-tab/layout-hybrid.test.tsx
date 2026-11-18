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

const header = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title}`) })
const summaryOf = (title: string) => within(header(title)).getByTestId("section-summary")
const cards = () => screen.getByRole("radiogroup", { name: "Widget preset" })
const card = (name: string) => within(cards()).getByRole("radio", { name })

describe("LayoutHybrid", () => {
  it("pins the preview and has the visibility switch", async () => {
    const model = makeWidgetTabModel({ visible: false })
    render(<LayoutHybrid model={model} />)
    expect(screen.getByTestId("menu-bar-preview-strip").parentElement).toHaveClass("sticky", "top-0")
    await userEvent.click(screen.getByRole("switch", { name: "Show widget in menu bar" }))
    expect(model.onVisibleChange).toHaveBeenCalledWith(true)
  })

  it("shows one card per preset in a 3-column grid with the matching one selected, then the collapsed accordion with summaries", () => {
    render(<LayoutHybrid model={makeWidgetTabModel()} />)
    expect(within(cards()).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "Default",
      "Minimal",
      "Traffic light",
      "Glass",
      "Solid pill",
      "Mono",
    ])
    expect(cards()).toHaveClass("grid-cols-3")
    expect(within(cards()).queryByRole("radio", { name: "Custom" })).toBeNull()
    expect(card("Default")).toHaveAttribute("aria-checked", "true")
    expect(screen.getByTestId("preset-summary")).toHaveTextContent("Default")
    for (const title of ["Layout", "Background", "Colors", "Providers"]) {
      expect(header(title)).toHaveAttribute("aria-expanded", "false")
    }
    expect(summaryOf("Layout")).toHaveTextContent("Compact")
    expect(summaryOf("Background")).toHaveTextContent("Auto · blur 50%")
    expect(summaryOf("Colors")).toHaveTextContent("Used colored")
    expect(summaryOf("Providers")).toHaveTextContent("Claude, ChatGPT")
  })

  it("selecting a card applies the preset through the model's handlers", async () => {
    const model = makeWidgetTabModel()
    render(<LayoutHybrid model={model} />)
    await userEvent.click(card("Minimal"))
    expect(model.onStyleChange).toHaveBeenCalledWith("inline-compact")
    expect(model.onBackdropChange).toHaveBeenCalledWith({ ...model.backdrop, enabled: false })
    expect(model.onTextColorsChange).toHaveBeenCalledWith({ label: "mono", used: "mono", expected: "mono" })
    expect(model.onToneModesChange).toHaveBeenCalledWith({ ahead: "mono", onTrack: "mono", behind: "mono" })
  })

  it("choosing a preset updates the section summaries and the selected card", async () => {
    render(<Stateful />)
    await userEvent.click(card("Minimal"))
    await waitFor(() => expect(card("Minimal")).toHaveAttribute("aria-checked", "true"))
    expect(summaryOf("Layout")).toHaveTextContent("Inline compact")
    expect(summaryOf("Background")).toHaveTextContent("Off")
    expect(summaryOf("Colors")).toHaveTextContent("All mono")
    expect(screen.getByTestId("preset-summary")).toHaveTextContent("Minimal")
  })

  it("shows no Custom card and no selection when no preset matches, only \"Custom\" in the header", () => {
    render(<LayoutHybrid model={makeWidgetTabModel({ style: "stacked", textColors: { label: "color", used: "color", expected: "color" } })} />)
    const radios = within(cards()).getAllByRole("radio")
    expect(radios).toHaveLength(6)
    expect(within(cards()).queryByRole("radio", { name: "Custom" })).toBeNull()
    for (const radio of radios) expect(radio).toHaveAttribute("aria-checked", "false")
    expect(screen.getByTestId("preset-summary")).toHaveTextContent("Custom")
  })

  it("accordion sections expand and collapse independently", async () => {
    render(<LayoutHybrid model={makeWidgetTabModel()} />)
    await userEvent.click(header("Layout"))
    expect(screen.getByRole("radiogroup", { name: "Menu bar style" })).toBeInTheDocument()
    await userEvent.click(header("Background"))
    expect(screen.getByTestId("menu-bar-widget-backdrop")).toBeInTheDocument()
    expect(screen.getByRole("radiogroup", { name: "Menu bar style" })).toBeInTheDocument()
    await userEvent.click(header("Colors"))
    expect(screen.getByTestId("menu-bar-widget-text-colors")).toBeInTheDocument()
    await userEvent.click(header("Providers"))
    expect(screen.getByTestId("widget-providers-list")).toBeInTheDocument()
    await userEvent.click(header("Layout"))
    expect(screen.queryByRole("radiogroup", { name: "Menu bar style" })).toBeNull()
  })

  it("editing a section clears the selection and keeps the grid at six cards", async () => {
    render(<Stateful />)
    expect(card("Default")).toHaveAttribute("aria-checked", "true")
    expect(within(cards()).getAllByRole("radio")).toHaveLength(6)
    await userEvent.click(header("Layout"))
    await userEvent.click(
      within(screen.getByRole("radiogroup", { name: "Menu bar style" })).getByRole("radio", { name: "Inline" })
    )
    await waitFor(() => expect(screen.getByTestId("preset-summary")).toHaveTextContent("Custom"))
    expect(card("Default")).toHaveAttribute("aria-checked", "false")
    expect(within(cards()).getAllByRole("radio")).toHaveLength(6)
    expect(within(cards()).queryByRole("radio", { name: "Custom" })).toBeNull()
    expect(summaryOf("Layout")).toHaveTextContent("Inline")
  })

  it("section controls call the model", async () => {
    const model = makeWidgetTabModel()
    render(<LayoutHybrid model={model} />)
    await userEvent.click(header("Background"))
    await userEvent.click(screen.getByRole("switch", { name: "Show background" }))
    expect(model.onBackdropChange).toHaveBeenLastCalledWith({ ...model.backdrop, enabled: false })
    await userEvent.click(header("Providers"))
    await userEvent.click(screen.getByLabelText("ChatGPT"))
    expect(model.onProviderIdsChange).toHaveBeenLastCalledWith(["claude"])
  })
})
