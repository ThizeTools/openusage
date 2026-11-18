import { describe, expect, it, vi } from "vitest"
import {
  applyPreset,
  getWidgetPreset,
  matchPreset,
  presetBackdrop,
  resolvePreset,
  WIDGET_PRESET_IDS,
  WIDGET_PRESETS,
  type WidgetPresetModel,
} from "@/lib/widget-presets"
import {
  DEFAULT_MENU_BAR_WIDGET_BACKDROP,
  DEFAULT_MENU_BAR_WIDGET_STYLE,
  DEFAULT_MENU_BAR_WIDGET_TEXT_COLORS,
  DEFAULT_MENU_BAR_WIDGET_TONE_MODES,
} from "@/lib/settings"

function makeModel(overrides: Partial<WidgetPresetModel> = {}): WidgetPresetModel {
  return {
    style: "stacked",
    backdrop: { enabled: true, color: "#336699", opacity: 33, glass: 22, blur: 11 },
    textColors: { label: "color", used: "color", expected: "color" },
    toneModes: { ahead: "color", onTrack: "color", behind: "color" },
    onStyleChange: vi.fn(),
    onBackdropChange: vi.fn(),
    onTextColorsChange: vi.fn(),
    onToneModesChange: vi.fn(),
    ...overrides,
  }
}

describe("widget presets", () => {
  it("lists the six presets with names and descriptions", () => {
    expect(WIDGET_PRESETS.map((preset) => preset.id)).toEqual([...WIDGET_PRESET_IDS])
    expect(WIDGET_PRESETS.map((preset) => preset.name)).toEqual([
      "Default",
      "Minimal",
      "Traffic light",
      "Glass",
      "Solid pill",
      "Mono",
    ])
    for (const preset of WIDGET_PRESETS) expect(preset.description.length).toBeGreaterThan(0)
  })

  it("'default' equals the product defaults", () => {
    const target = {
      style: DEFAULT_MENU_BAR_WIDGET_STYLE,
      backdrop: DEFAULT_MENU_BAR_WIDGET_BACKDROP,
      textColors: DEFAULT_MENU_BAR_WIDGET_TEXT_COLORS,
      toneModes: DEFAULT_MENU_BAR_WIDGET_TONE_MODES,
    }
    expect(matchPreset(target)).toBe("default")
    expect(resolvePreset("default", target)).toEqual(target)
  })

  it("defines each preset as specified", () => {
    const s = (id: (typeof WIDGET_PRESET_IDS)[number]) => getWidgetPreset(id).settings
    expect(s("minimal")).toMatchObject({ style: "inline-compact", backdrop: { enabled: false } })
    expect(s("minimal").textColors).toEqual({ label: "mono", used: "mono", expected: "mono" })
    expect(s("minimal").toneModes).toEqual({ ahead: "mono", onTrack: "mono", behind: "mono" })
    expect(s("traffic-light")).toMatchObject({
      style: "compact",
      backdrop: { enabled: false },
      textColors: { label: "mono", used: "color", expected: "color" },
      toneModes: { ahead: "color", onTrack: "color", behind: "color" },
    })
    expect(s("glass")).toMatchObject({
      style: "compact",
      backdrop: { enabled: true, color: "auto", opacity: 15, glass: 60, blur: 80 },
      textColors: { label: "mono", used: "color", expected: "mono" },
      toneModes: { ahead: "mono" },
    })
    expect(s("solid-pill")).toMatchObject({
      style: "inline-compact",
      backdrop: { enabled: true, color: "auto", opacity: 92, glass: 0, blur: 0 },
      textColors: { used: "color" },
    })
    expect(s("mono")).toMatchObject({
      style: "stacked",
      backdrop: { enabled: true, color: "auto", opacity: 0, glass: 0, blur: 50 },
      textColors: { label: "mono", used: "mono", expected: "mono" },
      toneModes: { ahead: "mono", onTrack: "mono", behind: "mono" },
    })
  })

  it("applyPreset -> matchPreset round-trips for every preset", () => {
    for (const id of WIDGET_PRESET_IDS) {
      let current = makeModel()
      const model = makeModel({
        onStyleChange: (style) => (current = { ...current, style }),
        onBackdropChange: (backdrop) => (current = { ...current, backdrop }),
        onTextColorsChange: (textColors) => (current = { ...current, textColors }),
        onToneModesChange: (toneModes) => (current = { ...current, toneModes }),
      })
      applyPreset(model, id)
      expect(matchPreset(current)).toBe(id)
    }
  })

  it("detects custom settings", () => {
    const base = resolvePreset("glass", makeModel())
    expect(matchPreset(base)).toBe("glass")
    expect(matchPreset({ ...base, style: "inline" })).toBe("custom")
    expect(matchPreset({ ...base, backdrop: { ...base.backdrop, blur: 79 } })).toBe("custom")
    expect(matchPreset({ ...base, backdrop: { ...base.backdrop, color: "#ff0000" } })).toBe("custom")
    expect(matchPreset({ ...base, textColors: { ...base.textColors, label: "color" } })).toBe("custom")
    expect(matchPreset({ ...base, toneModes: { ...base.toneModes, behind: "mono" } })).toBe("custom")
  })

  it("background-less presets ignore the slider values but not the switch", () => {
    const minimal = resolvePreset("minimal", makeModel())
    expect(
      matchPreset({ ...minimal, backdrop: { enabled: false, color: "#abcdef", opacity: 50, glass: 50, blur: 50 } })
    ).toBe("minimal")
    expect(matchPreset({ ...minimal, backdrop: { ...minimal.backdrop, enabled: true } })).toBe("custom")
  })

  it("applying a background-less preset keeps the user's background values", () => {
    const model = makeModel()
    applyPreset(model, "minimal")
    expect(model.onBackdropChange).toHaveBeenCalledWith({
      enabled: false,
      color: "#336699",
      opacity: 33,
      glass: 22,
      blur: 11,
    })
    expect(presetBackdrop("minimal", model.backdrop).color).toBe("#336699")
    expect(presetBackdrop("glass", model.backdrop)).toEqual({
      enabled: true,
      color: "auto",
      opacity: 15,
      glass: 60,
      blur: 80,
    })
  })

  it("applyPreset only calls the handlers whose value changes", () => {
    const model = makeModel({
      ...resolvePreset("traffic-light", makeModel()),
      backdrop: { enabled: false, color: "auto", opacity: 0, glass: 0, blur: 50 },
    })
    applyPreset(model, "traffic-light")
    expect(model.onStyleChange).not.toHaveBeenCalled()
    expect(model.onBackdropChange).not.toHaveBeenCalled()
    expect(model.onTextColorsChange).not.toHaveBeenCalled()
    expect(model.onToneModesChange).not.toHaveBeenCalled()

    applyPreset(model, "mono")
    expect(model.onStyleChange).toHaveBeenCalledWith("stacked")
    expect(model.onTextColorsChange).toHaveBeenCalledWith({ label: "mono", used: "mono", expected: "mono" })
    expect(model.onToneModesChange).toHaveBeenCalledWith({ ahead: "mono", onTrack: "mono", behind: "mono" })
  })

  it("throws for an unknown preset id", () => {
    expect(() => getWidgetPreset("nope" as never)).toThrow('Unknown widget preset "nope"')
  })
})
