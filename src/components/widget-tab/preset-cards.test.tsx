import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PresetCards } from "@/components/widget-tab/preset-cards"
import { makeWidgetTabModel } from "@/test/widget-tab-model"
import { renderMenuBarWidgetPng } from "@/lib/menubar-widget-image"
import { resolvePreset } from "@/lib/widget-presets"

vi.mock("@/lib/menubar-widget-image", async () => ({
  ...(await vi.importActual<typeof import("@/lib/menubar-widget-image")>("@/lib/menubar-widget-image")),
  renderMenuBarWidgetPng: vi.fn(async () => "AAAA"),
}))

vi.mock("@/lib/icon-mask", () => ({
  getIconMask: vi.fn(async () => null),
}))

afterEach(() => cleanup())

describe("PresetCards", () => {
  it("shows one card per preset and marks the one that matches the model", () => {
    render(<PresetCards model={makeWidgetTabModel()} />)
    const group = screen.getByRole("radiogroup", { name: "Widget preset" })
    const cards = within(group).getAllByRole("radio")
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
      "Default",
      "Minimal",
      "Traffic light",
      "Glass",
      "Solid pill",
      "Mono",
    ])
    expect(cards.map((card) => card.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
      "false",
      "false",
      "false",
    ])
    expect(screen.queryByRole("radio", { name: "Custom" })).toBeNull()
  })

  it("renders a real sample of every preset with its own settings", async () => {
    render(<PresetCards model={makeWidgetTabModel({ colors: { ahead: "#00ff00" } })} />)
    await waitFor(() => {
      const options = vi.mocked(renderMenuBarWidgetPng).mock.calls.map(([, opts]) => opts)
      expect(options).toContainEqual(
        expect.objectContaining({
          style: "compact",
          backdrop: { enabled: true, color: "auto", opacity: 15, glass: 60, blur: 80 },
          colors: { ahead: "#00ff00" },
          scale: 3,
        })
      )
      expect(options).toContainEqual(expect.objectContaining({ style: "inline-compact", backdrop: expect.objectContaining({ enabled: false }) }))
    })
    for (const card of screen.getAllByRole("radio")) {
      await waitFor(() => expect(card.querySelector("img")).toHaveAttribute("src", "data:image/png;base64,AAAA"))
    }
  })

  it("selecting a card applies the preset through the model", async () => {
    const model = makeWidgetTabModel()
    render(<PresetCards model={model} />)
    await userEvent.click(screen.getByRole("radio", { name: "Mono" }))
    expect(model.onStyleChange).toHaveBeenCalledWith("stacked")
    expect(model.onTextColorsChange).toHaveBeenCalledWith({ label: "mono", used: "mono", expected: "mono" })
    expect(model.onToneModesChange).toHaveBeenCalledWith({ ahead: "mono", onTrack: "mono", behind: "mono" })
    expect(model.onColorsChange).not.toHaveBeenCalled()
  })

  it("adds a Custom (current) card while no preset matches", async () => {
    const model = makeWidgetTabModel({ style: "inline" })
    render(<PresetCards model={model} />)
    const custom = screen.getByRole("radio", { name: "Custom" })
    expect(custom).toHaveAttribute("aria-checked", "true")
    expect(within(custom).getByText("Current")).toBeInTheDocument()
    for (const card of screen.getAllByRole("radio")) {
      if (card !== custom) expect(card).toHaveAttribute("aria-checked", "false")
    }
    // Clicking the current look changes nothing.
    await userEvent.click(custom)
    expect(model.onStyleChange).not.toHaveBeenCalled()
  })

  it("never adds a Custom card with showCustom={false}", () => {
    render(<PresetCards model={makeWidgetTabModel({ style: "inline" })} showCustom={false} />)
    const cards = screen.getAllByRole("radio")
    expect(cards).toHaveLength(6)
    expect(screen.queryByRole("radio", { name: "Custom" })).toBeNull()
    for (const card of cards) expect(card).toHaveAttribute("aria-checked", "false")
  })

  it("matches a preset whose background is off whatever the sliders say", () => {
    const base = makeWidgetTabModel()
    const minimal = resolvePreset("minimal", base)
    render(
      <PresetCards
        model={makeWidgetTabModel({ ...minimal, backdrop: { ...minimal.backdrop, color: "#123456", opacity: 77 } })}
      />
    )
    expect(screen.getByRole("radio", { name: "Minimal" })).toHaveAttribute("aria-checked", "true")
  })

  it("supports two columns", () => {
    render(<PresetCards model={makeWidgetTabModel()} columns={2} />)
    expect(screen.getByTestId("widget-preset-cards")).toHaveClass("grid-cols-2")
  })
})
