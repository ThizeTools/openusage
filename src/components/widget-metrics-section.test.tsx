import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WidgetMetricsSection } from "@/components/widget-metrics-section"
import { renderMenuBarWidgetPng } from "@/lib/menubar-widget-image"
import type { MenuBarWidgetBackdrop } from "@/lib/settings"
import type { PluginMeta } from "@/lib/plugin-types"

const platform = vi.hoisted(() => ({ mac: false, windows: false }))

vi.mock("@/lib/platform", () => ({
  isMacPlatform: () => platform.mac,
  isWindowsPlatform: () => platform.windows,
  usesRenderedWidget: () => platform.mac || platform.windows,
  widgetSurfaceName: () => (platform.windows ? "taskbar" : "menu bar"),
}))

vi.mock("@/lib/menubar-widget-image", async () => ({
  ...(await vi.importActual<typeof import("@/lib/menubar-widget-image")>("@/lib/menubar-widget-image")),
  renderMenuBarWidgetPng: vi.fn(async () => "AAAA"),
}))

vi.mock("@/lib/icon-mask", () => ({
  getIconMask: vi.fn(async () => null),
}))

function progressMeta(id: string, name: string, labels: string[]): PluginMeta {
  return {
    id,
    name,
    iconUrl: `${id}.svg`,
    lines: labels.map((label) => ({ type: "progress" as const, label, scope: "overview" as const })),
    primaryCandidates: labels,
  }
}

const pluginsMeta = [
  progressMeta("claude@1a2b3c4d", "Claude · work", ["Session", "Weekly", "Sonnet"]),
  progressMeta("codex", "Codex", ["Session", "Weekly"]),
]

const plugins = [
  { id: "claude@1a2b3c4d", name: "Claude · work", enabled: true },
  { id: "codex", name: "Codex", enabled: true },
]

const BACKDROP: MenuBarWidgetBackdrop = { enabled: true, color: "auto", opacity: 60, glass: 40, blur: 50 }

function renderSection(overrides: Partial<Parameters<typeof WidgetMetricsSection>[0]> = {}) {
  const props = {
    plugins,
    pluginsMeta,
    widgetVisible: true,
    onWidgetVisibleChange: vi.fn(),
    widgetProviderIds: null,
    onWidgetProviderIdsChange: vi.fn(),
    widgetProviderMetrics: {},
    onWidgetProviderMetricsChange: vi.fn(),
    menuBarWidgetBackdrop: BACKDROP,
    onMenuBarWidgetBackdropChange: vi.fn(),
    menuBarWidgetStyle: "stacked" as const,
    onMenuBarWidgetStyleChange: vi.fn(),
    menuBarWidgetColors: {},
    onMenuBarWidgetColorsChange: vi.fn(),
    menuBarWidgetTextColors: { label: "mono" as const, used: "color" as const, expected: "color" as const },
    onMenuBarWidgetTextColorsChange: vi.fn(),
    menuBarWidgetToneModes: { ahead: "color" as const, onTrack: "color" as const, behind: "color" as const },
    onMenuBarWidgetToneModesChange: vi.fn(),
    ...overrides,
  }
  render(<WidgetMetricsSection {...props} />)
  return props
}

afterEach(() => {
  cleanup()
  platform.mac = false
  platform.windows = false
})

/** Opens an accordion section by its title (collapsed by default). */
const openSection = (title: string) => userEvent.click(screen.getByRole("button", { name: new RegExp(`^${title}`) }))

describe("WidgetMetricsSection", () => {
  it("checks the default metrics of an account provider", async () => {
    renderSection()
    await openSection("Providers")
    // "Session" is shown for Claude (first) and Codex; Claude's comes first.
    const claudeSessionLabel = screen.getAllByText("Session")[0].closest("label")!
    expect(within(claudeSessionLabel).getByRole("checkbox")).toHaveAttribute("aria-checked", "true")
    const sonnetLabel = screen.getByText("Sonnet").closest("label")!
    expect(within(sonnetLabel).getByRole("checkbox")).toHaveAttribute("aria-checked", "false")
  })

  it("saves the full metric array in manifest order when a metric is toggled", async () => {
    const { onWidgetProviderMetricsChange } = renderSection({
      widgetProviderMetrics: { "claude@1a2b3c4d": ["Weekly"] },
    })
    await openSection("Providers")

    await userEvent.click(screen.getByLabelText("Sonnet"))
    expect(onWidgetProviderMetricsChange).toHaveBeenLastCalledWith({
      "claude@1a2b3c4d": ["Weekly", "Sonnet"],
    })

    // Props are not re-rendered by the test, so Session is toggled on top of ["Weekly"].
    await userEvent.click(screen.getAllByLabelText("Session")[0])
    expect(onWidgetProviderMetricsChange).toHaveBeenLastCalledWith({
      "claude@1a2b3c4d": ["Session", "Weekly"],
    })
  })

  it("keeps other providers' selections when one provider changes", async () => {
    const { onWidgetProviderMetricsChange } = renderSection({
      widgetProviderMetrics: { codex: ["Weekly"] },
    })
    await openSection("Providers")

    await userEvent.click(screen.getByLabelText("Sonnet"))
    expect(onWidgetProviderMetricsChange).toHaveBeenLastCalledWith({
      codex: ["Weekly"],
      "claude@1a2b3c4d": ["Session", "Weekly", "Sonnet"],
    })
  })

  it("does not save metric changes for a provider hidden from the widget", async () => {
    const { onWidgetProviderMetricsChange } = renderSection({ widgetProviderIds: ["codex"] })
    await openSection("Providers")

    await userEvent.click(screen.getByLabelText("Sonnet"))
    expect(onWidgetProviderMetricsChange).not.toHaveBeenCalled()
  })

  it("toggling a provider saves the shown provider ids in plugin order", async () => {
    const { onWidgetProviderIdsChange } = renderSection({ widgetProviderIds: ["codex"] })
    await openSection("Providers")

    await userEvent.click(screen.getByLabelText("Claude · work"))
    expect(onWidgetProviderIdsChange).toHaveBeenCalledWith(["claude@1a2b3c4d", "codex"])
  })

  it("on Windows shows the same widget tab with taskbar wording", async () => {
    platform.windows = true
    const { onWidgetVisibleChange } = renderSection({ widgetVisible: false })
    expect(screen.getByTestId("widget-layout-hybrid")).toBeInTheDocument()
    expect(screen.queryByLabelText("Widget tab layout")).toBeNull()

    await userEvent.click(screen.getByText("Show widget in taskbar"))
    expect(onWidgetVisibleChange).toHaveBeenCalledWith(true)
  })

  describe("on macOS", () => {
    const state = (name: string) =>
      within(screen.getByRole("radiogroup", { name }))
        .getAllByRole("radio")
        .map((o) => [o.textContent, o.getAttribute("aria-checked")])

    it("renders the hybrid layout without a layout switcher", () => {
      platform.mac = true
      renderSection()
      expect(screen.getByTestId("widget-layout-hybrid")).toBeInTheDocument()
      expect(screen.queryByLabelText("Widget tab layout")).toBeNull()
      expect(screen.queryByText("Layout (testing)")).toBeNull()
    })

    it("shows four style thumbnails in a radiogroup with the current one checked", async () => {
      platform.mac = true
      renderSection({ menuBarWidgetStyle: "inline-compact" })
      await openSection("Layout")

      const group = screen.getByRole("radiogroup", { name: "Menu bar style" })
      const tiles = within(group).getAllByRole("radio")
      expect(tiles.map((tile) => tile.getAttribute("aria-label"))).toEqual([
        "Stacked",
        "Compact",
        "Inline",
        "Inline compact",
      ])
      expect(tiles.map((tile) => tile.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "true"])
      expect(within(group).getByText("Session above Weekly with full labels")).toBeInTheDocument()
      expect(within(group).getByText("One row, one-letter labels")).toBeInTheDocument()
      // Roles are focusable buttons.
      for (const tile of tiles) expect(tile).toHaveProperty("tabIndex", 0)

      await waitFor(() => {
        for (const tile of tiles) expect(tile.querySelector("img")).toHaveAttribute("src", "data:image/png;base64,AAAA")
      })
    })

    it("renders every style sample and the preview with the current backdrop and colors at scale 3", async () => {
      platform.mac = true
      const colors = { ahead: "#00ff00" }
      const backdrop = { ...BACKDROP, opacity: 80, glass: 70 }
      renderSection({ menuBarWidgetBackdrop: backdrop, menuBarWidgetColors: colors })
      await openSection("Layout")

      await waitFor(() => {
        const calls = vi.mocked(renderMenuBarWidgetPng).mock.calls
        for (const style of ["stacked", "compact", "inline", "inline-compact"]) {
          expect(calls.map(([, opts]) => opts)).toContainEqual(
            expect.objectContaining({ style, backdrop, colors, scale: 3 })
          )
        }
      })
      // The pinned preview strip shows the same real render.
      const widget = screen.getByTestId("menu-bar-preview-widget")
      await waitFor(() => expect(widget.querySelector("img")).toHaveAttribute("src", "data:image/png;base64,AAAA"))
    })

    it("selecting a tile reports the style", async () => {
      platform.mac = true
      const { onMenuBarWidgetStyleChange } = renderSection()
      await openSection("Layout")

      await userEvent.click(screen.getByRole("radio", { name: "Compact" }))
      expect(onMenuBarWidgetStyleChange).toHaveBeenCalledWith("compact")
      await userEvent.click(screen.getByRole("radio", { name: "Inline compact" }))
      expect(onMenuBarWidgetStyleChange).toHaveBeenLastCalledWith("inline-compact")
    })

    describe("background controls", () => {
      const controls = () => within(screen.getByTestId("menu-bar-widget-backdrop"))

      it("hides the Blur slider on Windows (no native blur behind the taskbar widget)", async () => {
        platform.windows = true
        renderSection()
        await openSection("Background")
        expect(controls().getByRole("slider", { name: "Opacity" })).toBeInTheDocument()
        expect(controls().getByRole("slider", { name: "Glass" })).toBeInTheDocument()
        expect(controls().queryByRole("slider", { name: "Blur" })).toBeNull()
      })

      it("are collapsed until the Background section is opened", async () => {
        platform.mac = true
        renderSection()
        expect(screen.queryByTestId("menu-bar-widget-backdrop")).toBeNull()
        await openSection("Background")
        expect(controls().getByRole("switch", { name: "Show background" })).toBeChecked()
      })

      it("the switch reports enabled changes and hides the rest when off", async () => {
        platform.mac = true
        const { onMenuBarWidgetBackdropChange } = renderSection()
        await openSection("Background")
        await userEvent.click(controls().getByRole("switch"))
        expect(onMenuBarWidgetBackdropChange).toHaveBeenCalledWith({ ...BACKDROP, enabled: false })
        cleanup()

        renderSection({ menuBarWidgetBackdrop: { ...BACKDROP, enabled: false } })
        await openSection("Background")
        expect(controls().getByRole("switch")).not.toBeChecked()
        expect(controls().queryByRole("slider")).toBeNull()
        expect(controls().queryByRole("radiogroup")).toBeNull()
      })

      it("Auto / Custom switches the color mode and Custom shows the swatch with its hex", async () => {
        platform.mac = true
        const { onMenuBarWidgetBackdropChange } = renderSection()
        await openSection("Background")
        const modes = controls().getByRole("radiogroup", { name: "Background color mode" })
        expect(within(modes).getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true")
        expect(controls().queryByLabelText("Background color")).toBeNull()

        await userEvent.click(within(modes).getByRole("radio", { name: "Custom" }))
        // The test setup's matchMedia reports a light scheme: auto is white.
        expect(onMenuBarWidgetBackdropChange).toHaveBeenCalledWith({ ...BACKDROP, color: "#ffffff" })
        cleanup()

        const { onMenuBarWidgetBackdropChange: onChange } = renderSection({
          menuBarWidgetBackdrop: { ...BACKDROP, color: "#336699" },
        })
        await openSection("Background")
        const customModes = controls().getByRole("radiogroup", { name: "Background color mode" })
        expect(within(customModes).getByRole("radio", { name: "Custom" })).toHaveAttribute("aria-checked", "true")
        expect(controls().getByText("#336699")).toBeInTheDocument()
        expect(controls().getByLabelText("Background color")).toHaveValue("#336699")

        fireEvent.change(controls().getByLabelText("Background color"), { target: { value: "#ABCDEF" } })
        expect(onChange).toHaveBeenCalledWith({ ...BACKDROP, color: "#abcdef" })
        await userEvent.click(within(customModes).getByRole("radio", { name: "Auto" }))
        expect(onChange).toHaveBeenLastCalledWith({ ...BACKDROP, color: "auto" })
      })

      it("shows the Opacity, Glass and Blur sliders with their values and the blur note", async () => {
        platform.mac = true
        renderSection({ menuBarWidgetBackdrop: { ...BACKDROP, opacity: 10, glass: 20, blur: 30 } })
        await openSection("Background")
        const sliders = controls().getAllByRole("slider")
        expect(sliders.map((slider) => slider.getAttribute("aria-label"))).toEqual(["Opacity", "Glass", "Blur"])
        expect(sliders.map((slider) => (slider as HTMLInputElement).value)).toEqual(["10", "20", "30"])
        expect(controls().getByText("10%")).toBeInTheDocument()
        expect(controls().getByText("20%")).toBeInTheDocument()
        expect(controls().getByText("30%")).toBeInTheDocument()
        expect(
          controls().getByText("Real blur of the wallpaper behind the widget; only visible in the menu bar.")
        ).toBeInTheDocument()
      })

      it("each slider reports its own value", async () => {
        platform.mac = true
        const { onMenuBarWidgetBackdropChange } = renderSection()
        await openSection("Background")
        fireEvent.change(controls().getByRole("slider", { name: "Opacity" }), { target: { value: "80" } })
        expect(onMenuBarWidgetBackdropChange).toHaveBeenLastCalledWith({ ...BACKDROP, opacity: 80 })
        fireEvent.change(controls().getByRole("slider", { name: "Glass" }), { target: { value: "0" } })
        expect(onMenuBarWidgetBackdropChange).toHaveBeenLastCalledWith({ ...BACKDROP, glass: 0 })
        fireEvent.change(controls().getByRole("slider", { name: "Blur" }), { target: { value: "100" } })
        expect(onMenuBarWidgetBackdropChange).toHaveBeenLastCalledWith({ ...BACKDROP, blur: 100 })
      })
    })

    it("lists the three tone colors with their defaults and no Reset when nothing is customized", async () => {
      platform.mac = true
      renderSection()
      await openSection("Colors")

      const rows = screen.getByTestId("menu-bar-widget-colors")
      expect(within(rows).getByText("Healthy")).toBeInTheDocument()
      expect(within(rows).getByText("Close to limit")).toBeInTheDocument()
      expect(within(rows).getByText("Over pace")).toBeInTheDocument()
      // The test setup's matchMedia reports a light scheme.
      expect(screen.getByLabelText("Healthy color")).toHaveValue("#107c10")
      expect(screen.getByLabelText("Close to limit color")).toHaveValue("#9d5d00")
      expect(screen.getByLabelText("Over pace color")).toHaveValue("#c42b1c")
      expect(screen.queryByRole("button", { name: /Reset/ })).toBeNull()
    })

    it("changing a color reports the merged colors with a lowercase hex", async () => {
      platform.mac = true
      const { onMenuBarWidgetColorsChange } = renderSection({ menuBarWidgetColors: { behind: "#112233" } })
      await openSection("Colors")

      fireEvent.change(screen.getByLabelText("Healthy color"), { target: { value: "#00FF88" } })
      expect(onMenuBarWidgetColorsChange).toHaveBeenCalledWith({ behind: "#112233", ahead: "#00ff88" })
    })

    it("shows custom colors and resets one tone or all of them", async () => {
      platform.mac = true
      const { onMenuBarWidgetColorsChange } = renderSection({
        menuBarWidgetColors: { ahead: "#00ff00", behind: "#ff0000" },
      })
      await openSection("Colors")

      expect(screen.getByLabelText("Healthy color")).toHaveValue("#00ff00")
      expect(screen.getByLabelText("Over pace color")).toHaveValue("#ff0000")
      // Reset only appears for customized tones.
      expect(screen.getByRole("button", { name: "Reset Healthy color" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Reset Over pace color" })).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: "Reset Close to limit color" })).toBeNull()

      await userEvent.click(screen.getByRole("button", { name: "Reset Healthy color" }))
      expect(onMenuBarWidgetColorsChange).toHaveBeenLastCalledWith({ behind: "#ff0000" })

      await userEvent.click(screen.getByRole("button", { name: "Reset all" }))
      expect(onMenuBarWidgetColorsChange).toHaveBeenLastCalledWith({})
    })

    it("shows a Text table with a Mono / Color control per part and reports changes", async () => {
      platform.mac = true
      const { onMenuBarWidgetTextColorsChange } = renderSection({
        menuBarWidgetTextColors: { label: "mono", used: "color", expected: "mono" },
      })
      await openSection("Colors")

      const table = screen.getByTestId("menu-bar-widget-text-colors")
      for (const label of ["Label", "Used", "Expected pace"]) expect(within(table).getByText(label)).toBeInTheDocument()
      expect(state("Label text color")).toEqual([["Mono", "true"], ["Color", "false"]])
      expect(state("Used text color")).toEqual([["Mono", "false"], ["Color", "true"]])
      expect(state("Expected pace text color")).toEqual([["Mono", "true"], ["Color", "false"]])

      await userEvent.click(within(screen.getByRole("radiogroup", { name: "Label text color" })).getByRole("radio", { name: "Color" }))
      expect(onMenuBarWidgetTextColorsChange).toHaveBeenLastCalledWith({ label: "color", used: "color", expected: "mono" })
      await userEvent.click(within(screen.getByRole("radiogroup", { name: "Used text color" })).getByRole("radio", { name: "Mono" }))
      expect(onMenuBarWidgetTextColorsChange).toHaveBeenLastCalledWith({ label: "mono", used: "mono", expected: "mono" })
      await userEvent.click(
        within(screen.getByRole("radiogroup", { name: "Expected pace text color" })).getByRole("radio", { name: "Color" })
      )
      expect(onMenuBarWidgetTextColorsChange).toHaveBeenLastCalledWith({ label: "mono", used: "color", expected: "color" })
    })

    it("dims the tone colors with a note only when every text is mono", async () => {
      platform.mac = true
      renderSection()
      await openSection("Colors")
      expect(screen.getByTestId("menu-bar-widget-tone-colors")).not.toHaveClass("opacity-50")
      expect(screen.queryByText(/all texts are mono/)).toBeNull()
      cleanup()

      renderSection({ menuBarWidgetTextColors: { label: "mono", used: "mono", expected: "mono" } })
      await openSection("Colors")
      expect(screen.getByTestId("menu-bar-widget-tone-colors")).toHaveClass("opacity-50")
      expect(screen.getByText("Not used — all texts are mono")).toBeInTheDocument()
    })

    it("passes the text colors and tone modes to the preview strip", async () => {
      platform.mac = true
      const textColors = { label: "color", used: "mono", expected: "mono" } as const
      const toneModes = { ahead: "mono", onTrack: "color", behind: "mono" } as const
      renderSection({ menuBarWidgetTextColors: textColors, menuBarWidgetToneModes: toneModes })
      await waitFor(() => {
        const calls = vi.mocked(renderMenuBarWidgetPng).mock.calls
        expect(calls.map(([, opts]) => opts)).toContainEqual(expect.objectContaining({ textColors, toneModes }))
      })
    })

    it("shows a Mono / Color control per tone row and reports changes", async () => {
      platform.mac = true
      const { onMenuBarWidgetToneModesChange } = renderSection({
        menuBarWidgetToneModes: { ahead: "color", onTrack: "mono", behind: "color" },
      })
      await openSection("Colors")
      expect(state("Healthy tone mode")).toEqual([["Mono", "false"], ["Color", "true"]])
      expect(state("Close to limit tone mode")).toEqual([["Mono", "true"], ["Color", "false"]])
      expect(state("Over pace tone mode")).toEqual([["Mono", "false"], ["Color", "true"]])

      await userEvent.click(within(screen.getByRole("radiogroup", { name: "Healthy tone mode" })).getByRole("radio", { name: "Mono" }))
      expect(onMenuBarWidgetToneModesChange).toHaveBeenLastCalledWith({ ahead: "mono", onTrack: "mono", behind: "color" })
      await userEvent.click(
        within(screen.getByRole("radiogroup", { name: "Close to limit tone mode" })).getByRole("radio", { name: "Color" })
      )
      expect(onMenuBarWidgetToneModesChange).toHaveBeenLastCalledWith({ ahead: "color", onTrack: "color", behind: "color" })
    })

    it("dims the swatch of a mono tone and keeps its Reset working", async () => {
      platform.mac = true
      const { onMenuBarWidgetColorsChange } = renderSection({
        menuBarWidgetColors: { ahead: "#00ff00", behind: "#ff0000" },
        menuBarWidgetToneModes: { ahead: "mono", onTrack: "color", behind: "color" },
      })
      await openSection("Colors")
      const swatchLabel = (name: string) => screen.getByLabelText(name).closest("label")!
      expect(swatchLabel("Healthy color")).toHaveClass("opacity-50")
      expect(swatchLabel("Over pace color")).not.toHaveClass("opacity-50")

      await userEvent.click(screen.getByRole("button", { name: "Reset Healthy color" }))
      expect(onMenuBarWidgetColorsChange).toHaveBeenLastCalledWith({ behind: "#ff0000" })
    })

    it("does not show Reset all without custom colors", async () => {
      platform.mac = true
      renderSection()
      await openSection("Colors")
      expect(screen.queryByRole("button", { name: "Reset all" })).toBeNull()
    })

    it("lists providers and metrics compactly in the Providers section", async () => {
      platform.mac = true
      const { onWidgetProviderIdsChange, onWidgetProviderMetricsChange } = renderSection({
        widgetProviderMetrics: { "claude@1a2b3c4d": ["Weekly"] },
      })
      await openSection("Providers")
      expect(screen.getByTestId("widget-providers-list")).toBeInTheDocument()

      await userEvent.click(screen.getByLabelText("Sonnet"))
      expect(onWidgetProviderMetricsChange).toHaveBeenLastCalledWith({ "claude@1a2b3c4d": ["Weekly", "Sonnet"] })
      await userEvent.click(screen.getByLabelText("Codex"))
      expect(onWidgetProviderIdsChange).toHaveBeenLastCalledWith(["claude@1a2b3c4d"])
    })

    it("the visibility switch reports changes", async () => {
      platform.mac = true
      const { onWidgetVisibleChange } = renderSection({ widgetVisible: false })
      await userEvent.click(screen.getByRole("switch", { name: "Show widget in menu bar" }))
      expect(onWidgetVisibleChange).toHaveBeenCalledWith(true)
    })
  })
})
