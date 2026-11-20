import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_MENU_BAR_WIDGET_BACKDROP,
  DEFAULT_MENU_BAR_WIDGET_COLORS,
  DEFAULT_MENU_BAR_WIDGET_TEXT_COLORS,
  DEFAULT_MENU_BAR_WIDGET_TONE_MODES,
  DEFAULT_MENU_BAR_WIDGET_STYLE,
  DEFAULT_MENUBAR_ICON_STYLE,
  DEFAULT_PLUGIN_SETTINGS,
  DEFAULT_RESET_TIMER_DISPLAY_MODE,
  DEFAULT_START_ON_LOGIN,
  DEFAULT_THEME_MODE,
  DEFAULT_PACE_THRESHOLDS,
  DEFAULT_WIDGET_PROVIDER_IDS,
  DEFAULT_WIDGET_PROVIDER_METRICS,
  DEFAULT_WIDGET_VISIBLE,
  arePluginSettingsEqual,
  getEnabledPluginIds,
  loadMenuBarWidgetBackdrop,
  loadDockOverlayStyle,
  loadPaceThresholds,
  parsePaceThresholds,
  savePaceThresholds,
  saveDockOverlayStyle,
  parseDockOverlayStyle,
  DEFAULT_DOCK_OVERLAY_STYLE,
  loadMenuBarWidgetColors,
  loadMenuBarWidgetTextColors,
  loadMenuBarWidgetToneModes,
  loadMenuBarWidgetStyle,
  loadMenubarIconStyle,
  loadPluginSettings,
  loadResetTimerDisplayMode,
  loadStartOnLogin,
  loadWidgetProviderIds,
  loadWidgetProviderMetrics,
  loadWidgetVisible,
  migrateLegacyTraySettings,
  migrateWindsurfToDevin,
  loadThemeMode,
  normalizePluginSettings,
    parseMenuBarWidgetBackdrop,
  parseMenuBarWidgetColors,
  parseMenuBarWidgetTextColors,
  parseMenuBarWidgetToneModes,
  saveMenuBarWidgetBackdrop,
  saveMenuBarWidgetColors,
  saveMenuBarWidgetTextColors,
  saveMenuBarWidgetToneModes,
  saveMenuBarWidgetStyle,
  saveMenubarIconStyle,
  savePluginSettings,
  saveResetTimerDisplayMode,
  saveStartOnLogin,
  saveThemeMode,
  saveWidgetProviderIds,
  saveWidgetProviderMetrics,
  saveWidgetVisible,
  DEFAULT_SURFACE_OVERRIDES,
  effectiveColors,
  effectiveProviders,
  loadSurfaceOverrides,
  parseSurfaceOverrides,
  saveSurfaceOverrides,
  surfaceOverridesKey,
} from "@/lib/settings"
import type { PluginMeta } from "@/lib/plugin-types"

const storeState = new Map<string, unknown>()
const storeDeleteMock = vi.fn()
const storeSaveMock = vi.fn()

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    async get<T>(key: string): Promise<T | null> {
      if (!storeState.has(key)) return undefined as T | null
      return storeState.get(key) as T | null
    }
    async set<T>(key: string, value: T): Promise<void> {
      storeState.set(key, value)
    }
    async delete(key: string): Promise<void> {
      storeDeleteMock(key)
      storeState.delete(key)
    }
    async save(): Promise<void> {
      storeSaveMock()
    }
  },
}))

describe("settings", () => {
  beforeEach(() => {
    storeState.clear()
    storeDeleteMock.mockReset()
    storeSaveMock.mockReset()
  })

  it("loads defaults when no settings stored", async () => {
    await expect(loadPluginSettings()).resolves.toEqual(DEFAULT_PLUGIN_SETTINGS)
  })

  it("sanitizes stored settings", async () => {
    storeState.set("plugins", { order: ["a"], disabled: "nope" })
    await expect(loadPluginSettings()).resolves.toEqual({
      order: ["a"],
      disabled: [],
    })
  })

  it("saves settings", async () => {
    const settings = { order: ["a"], disabled: ["b"] }
    await savePluginSettings(settings)
    await expect(loadPluginSettings()).resolves.toEqual(settings)
  })

  it("normalizes order + disabled against known plugins", () => {
    const plugins: PluginMeta[] = [
      { id: "a", name: "A", iconUrl: "", lines: [] },
      { id: "b", name: "B", iconUrl: "", lines: [] },
    ]
    const normalized = normalizePluginSettings(
      { order: ["b", "b", "c"], disabled: ["c", "a"] },
      plugins
    )
    expect(normalized).toEqual({ order: ["b", "a"], disabled: ["a"] })
  })

  it("auto-disables new non-default plugins", () => {
    const plugins: PluginMeta[] = [
      { id: "claude", name: "Claude", iconUrl: "", lines: [], primaryCandidates: [] },
      { id: "copilot", name: "Copilot", iconUrl: "", lines: [], primaryCandidates: [] },
      { id: "devin", name: "Devin", iconUrl: "", lines: [], primaryCandidates: [] },
    ]
    const result = normalizePluginSettings({ order: [], disabled: [] }, plugins)
    expect(result.order).toEqual(["claude", "copilot", "devin"])
    expect(result.disabled).toEqual(["copilot", "devin"])
  })

  it("enables newly seen account instances even when the plugin is not default", () => {
    const plugins: PluginMeta[] = [
      { id: "copilot", name: "Copilot", iconUrl: "", lines: [], primaryCandidates: [] },
      { id: "claude@1a2b3c4d", name: "Claude", iconUrl: "", lines: [], primaryCandidates: [] },
      { id: "copilot@9f8e7d6c", name: "Copilot · work", iconUrl: "", lines: [], primaryCandidates: [] },
    ]
    const result = normalizePluginSettings({ order: [], disabled: [] }, plugins)
    expect(result.order).toEqual(["copilot", "claude@1a2b3c4d", "copilot@9f8e7d6c"])
    expect(result.disabled).toEqual(["copilot"])
  })

  it("keeps a user-disabled account instance disabled and drops removed accounts", () => {
    const plugins: PluginMeta[] = [
      { id: "claude@1a2b3c4d", name: "Claude", iconUrl: "", lines: [], primaryCandidates: [] },
    ]
    const result = normalizePluginSettings(
      { order: ["claude@gone", "claude@1a2b3c4d"], disabled: ["claude@1a2b3c4d", "claude@gone"] },
      plugins
    )
    expect(result).toEqual({ order: ["claude@1a2b3c4d"], disabled: ["claude@1a2b3c4d"] })
  })

  it("migrates enabled windsurf settings to enabled devin settings", () => {
    const result = migrateWindsurfToDevin({
      order: ["claude", "windsurf", "codex"],
      disabled: [],
    })

    expect(result).toEqual({
      order: ["claude", "devin", "codex"],
      disabled: [],
    })
  })

  it("keeps devin enabled when enabled windsurf conflicts with a stale disabled devin entry", () => {
    const result = migrateWindsurfToDevin({
      order: ["claude", "windsurf", "codex"],
      disabled: ["devin"],
    })

    expect(result).toEqual({
      order: ["claude", "devin", "codex"],
      disabled: [],
    })
  })

  it("migrates disabled windsurf settings to disabled devin settings", () => {
    const result = migrateWindsurfToDevin({
      order: ["windsurf", "claude"],
      disabled: ["windsurf"],
    })

    expect(result).toEqual({
      order: ["devin", "claude"],
      disabled: ["devin"],
    })
  })

  it("does not disable an existing devin entry when removing old windsurf settings", () => {
    const result = migrateWindsurfToDevin({
      order: ["windsurf", "devin", "claude"],
      disabled: ["windsurf"],
    })

    expect(result).toEqual({
      order: ["devin", "claude"],
      disabled: [],
    })
  })

  it("compares settings equality", () => {
    const a = { order: ["a"], disabled: [] }
    const b = { order: ["a"], disabled: [] }
    const c = { order: ["b"], disabled: [] }
    expect(arePluginSettingsEqual(a, b)).toBe(true)
    expect(arePluginSettingsEqual(a, c)).toBe(false)
  })

  it("returns enabled plugin ids", () => {
    expect(getEnabledPluginIds({ order: ["a", "b"], disabled: ["b"] })).toEqual(["a"])
  })

  it("loads default theme mode when missing", async () => {
    await expect(loadThemeMode()).resolves.toBe(DEFAULT_THEME_MODE)
  })

  it("loads stored theme mode", async () => {
    storeState.set("themeMode", "dark")
    await expect(loadThemeMode()).resolves.toBe("dark")
  })

  it("saves theme mode", async () => {
    await saveThemeMode("light")
    await expect(loadThemeMode()).resolves.toBe("light")
  })

  it("falls back to default for invalid theme mode", async () => {
    storeState.set("themeMode", "invalid")
    await expect(loadThemeMode()).resolves.toBe(DEFAULT_THEME_MODE)
  })

  it("loads default reset timer display mode when missing", async () => {
    await expect(loadResetTimerDisplayMode()).resolves.toBe(DEFAULT_RESET_TIMER_DISPLAY_MODE)
  })

  it("loads stored reset timer display mode", async () => {
    storeState.set("resetTimerDisplayMode", "absolute")
    await expect(loadResetTimerDisplayMode()).resolves.toBe("absolute")
  })

  it("saves reset timer display mode", async () => {
    await saveResetTimerDisplayMode("relative")
    await expect(loadResetTimerDisplayMode()).resolves.toBe("relative")
  })

  it("falls back to default for invalid reset timer display mode", async () => {
    storeState.set("resetTimerDisplayMode", "invalid")
    await expect(loadResetTimerDisplayMode()).resolves.toBe(DEFAULT_RESET_TIMER_DISPLAY_MODE)
  })

  it("migrates and removes legacy tray settings keys", async () => {
    storeState.set("trayIconStyle", "provider")
    storeState.set("trayShowPercentage", false)

    await migrateLegacyTraySettings()

    expect(storeState.has("trayIconStyle")).toBe(false)
    expect(storeState.has("trayShowPercentage")).toBe(false)
  })

  it("migrates legacy trayIconStyle=bars to menubarIconStyle=bars when new key not set", async () => {
    storeState.set("trayIconStyle", "bars")

    await migrateLegacyTraySettings()

    expect(storeState.get("menubarIconStyle")).toBe("bars")
    expect(storeState.has("trayIconStyle")).toBe(false)
  })

  it("does not overwrite menubarIconStyle when already set during legacy migration", async () => {
    storeState.set("trayIconStyle", "bars")
    storeState.set("menubarIconStyle", "provider")

    await migrateLegacyTraySettings()

    expect(storeState.get("menubarIconStyle")).toBe("provider")
    expect(storeState.has("trayIconStyle")).toBe(false)
  })

  it("migrates legacy trayIconStyle=circle to menubarIconStyle=donut when new key not set", async () => {
    storeState.set("trayIconStyle", "circle")

    await migrateLegacyTraySettings()

    expect(storeState.get("menubarIconStyle")).toBe("donut")
    expect(storeState.has("trayIconStyle")).toBe(false)
  })

  it("does not set menubarIconStyle when legacy trayIconStyle is non-bars", async () => {
    storeState.set("trayIconStyle", "provider")

    await migrateLegacyTraySettings()

    expect(storeState.has("menubarIconStyle")).toBe(false)
    expect(storeState.has("trayIconStyle")).toBe(false)
  })

  it("loads default menubar icon style when missing", async () => {
    await expect(loadMenubarIconStyle()).resolves.toBe(DEFAULT_MENUBAR_ICON_STYLE)
  })

  it("loads stored menubar icon style", async () => {
    storeState.set("menubarIconStyle", "bars")
    await expect(loadMenubarIconStyle()).resolves.toBe("bars")
  })

  it("saves menubar icon style", async () => {
    await saveMenubarIconStyle("bars")
    await expect(loadMenubarIconStyle()).resolves.toBe("bars")
  })

  it("loads stored menubar donut icon style", async () => {
    storeState.set("menubarIconStyle", "donut")
    await expect(loadMenubarIconStyle()).resolves.toBe("donut")
  })

  it("saves menubar donut icon style", async () => {
    await saveMenubarIconStyle("donut")
    await expect(loadMenubarIconStyle()).resolves.toBe("donut")
  })

  it("falls back to default for invalid menubar icon style", async () => {
    storeState.set("menubarIconStyle", "invalid")
    await expect(loadMenubarIconStyle()).resolves.toBe(DEFAULT_MENUBAR_ICON_STYLE)
  })

  it("skips legacy tray migration when keys are absent", async () => {
    await expect(migrateLegacyTraySettings()).resolves.toBeUndefined()
    expect(storeState.has("trayIconStyle")).toBe(false)
    expect(storeState.has("trayShowPercentage")).toBe(false)
    expect(storeDeleteMock).not.toHaveBeenCalled()
    expect(storeSaveMock).not.toHaveBeenCalled()
  })

  it("migrates when only one legacy tray key is present", async () => {
    storeState.set("trayShowPercentage", true)

    await migrateLegacyTraySettings()

    expect(storeState.has("trayShowPercentage")).toBe(false)
    expect(storeDeleteMock).toHaveBeenCalledWith("trayShowPercentage")
    expect(storeSaveMock).toHaveBeenCalledTimes(1)
  })

  it("falls back to nulling legacy keys if delete is unavailable", async () => {
    const { LazyStore } = await import("@tauri-apps/plugin-store")
    const prototype = LazyStore.prototype as { delete?: (key: string) => Promise<void> }
    const originalDelete = prototype.delete

    // Simulate older store implementation with no delete() method.
    prototype.delete = undefined
    storeState.set("trayIconStyle", "provider")

    try {
      await migrateLegacyTraySettings()
    } finally {
      prototype.delete = originalDelete
    }

    expect(storeDeleteMock).not.toHaveBeenCalled()
    expect(storeState.get("trayIconStyle")).toBeNull()
    expect(storeSaveMock).toHaveBeenCalledTimes(1)
  })

  it("loads default start on login when missing", async () => {
    await expect(loadStartOnLogin()).resolves.toBe(DEFAULT_START_ON_LOGIN)
  })

  it("loads stored start on login value", async () => {
    storeState.set("startOnLogin", true)
    await expect(loadStartOnLogin()).resolves.toBe(true)
  })

  it("saves start on login value", async () => {
    await saveStartOnLogin(true)
    await expect(loadStartOnLogin()).resolves.toBe(true)
  })

  it("falls back to default for invalid start on login value", async () => {
    storeState.set("startOnLogin", "invalid")
    await expect(loadStartOnLogin()).resolves.toBe(DEFAULT_START_ON_LOGIN)
  })

  it("loads default widget visibility when missing", async () => {
    await expect(loadWidgetVisible()).resolves.toBe(DEFAULT_WIDGET_VISIBLE)
  })

  it("loads and saves widget visibility", async () => {
    await saveWidgetVisible(true)
    await expect(loadWidgetVisible()).resolves.toBe(true)
  })

  it("falls back to default for invalid widget visibility", async () => {
    storeState.set("taskbarWidgetVisible", "yes")
    await expect(loadWidgetVisible()).resolves.toBe(DEFAULT_WIDGET_VISIBLE)
  })

  it("defaults the menu bar widget to a transparent auto background and the compact style", async () => {
    expect(DEFAULT_MENU_BAR_WIDGET_BACKDROP).toEqual({ enabled: true, color: "auto", opacity: 0, glass: 0, blur: 50 })
    expect(DEFAULT_MENU_BAR_WIDGET_STYLE).toBe("compact")
    await expect(loadMenuBarWidgetBackdrop()).resolves.toEqual(DEFAULT_MENU_BAR_WIDGET_BACKDROP)
    await expect(loadMenuBarWidgetStyle()).resolves.toBe("compact")
  })

  it("loads and saves the menu bar widget backdrop", async () => {
    const backdrop = { enabled: false, color: "#12ab34", opacity: 20, glass: 0, blur: 100 }
    await saveMenuBarWidgetBackdrop(backdrop)
    expect(storeState.get("menuBarWidgetBackdrop")).toEqual(backdrop)
    await expect(loadMenuBarWidgetBackdrop()).resolves.toEqual(backdrop)
  })

  it("validates and clamps the stored backdrop field by field", () => {
    expect(parseMenuBarWidgetBackdrop(null)).toBeNull()
    expect(parseMenuBarWidgetBackdrop("solid")).toBeNull()
    expect(parseMenuBarWidgetBackdrop([])).toBeNull()
    expect(parseMenuBarWidgetBackdrop({})).toEqual(DEFAULT_MENU_BAR_WIDGET_BACKDROP)
    expect(parseMenuBarWidgetBackdrop({ opacity: 150, glass: -20, blur: 33.6 })).toMatchObject({
      opacity: 100,
      glass: 0,
      blur: 34,
    })
    expect(parseMenuBarWidgetBackdrop({ opacity: "9", glass: NaN, blur: Infinity })).toMatchObject({
      opacity: 0,
      glass: 0,
      blur: 50,
    })
    expect(parseMenuBarWidgetBackdrop({ color: "#ABCDEF" })?.color).toBe("#abcdef")
    expect(parseMenuBarWidgetBackdrop({ color: "auto" })?.color).toBe("auto")
    expect(parseMenuBarWidgetBackdrop({ color: "red" })?.color).toBe("auto")
    expect(parseMenuBarWidgetBackdrop({ color: "#fff" })?.color).toBe("auto")
    expect(parseMenuBarWidgetBackdrop({ enabled: false })?.enabled).toBe(false)
    expect(parseMenuBarWidgetBackdrop({ enabled: "no" })?.enabled).toBe(true)
  })

  it("clamps an out-of-range stored backdrop on load", async () => {
    storeState.set("menuBarWidgetBackdrop", { enabled: true, color: "#00ff00", opacity: 400, glass: -5, blur: 7.4 })
    await expect(loadMenuBarWidgetBackdrop()).resolves.toEqual({
      enabled: true,
      color: "#00ff00",
      opacity: 100,
      glass: 0,
      blur: 7,
    })
  })

  it("migrates the removed background presets when the new key is absent", async () => {
    const cases: [string, unknown][] = [
      ["none", { ...DEFAULT_MENU_BAR_WIDGET_BACKDROP, enabled: false }],
      ["solid", { enabled: true, color: "auto", opacity: 92, glass: 0, blur: 0 }],
      ["inverted", { enabled: true, color: "#ffffff", opacity: 95, glass: 0, blur: 0 }],
      ["dock", { enabled: true, color: "auto", opacity: 55, glass: 60, blur: 60 }],
      ["glass-dock", { enabled: true, color: "auto", opacity: 55, glass: 60, blur: 60 }],
      ["glass-liquid", { enabled: true, color: "auto", opacity: 55, glass: 60, blur: 60 }],
      ["glass-edge", { enabled: true, color: "auto", opacity: 55, glass: 60, blur: 60 }],
    ]
    for (const [legacy, expected] of cases) {
      storeState.set("menuBarWidgetBackground", legacy)
      await expect(loadMenuBarWidgetBackdrop()).resolves.toEqual(expected)
    }
  })

  it("falls back to the default for an unknown legacy background", async () => {
    for (const removed of ["subtle", "outline", "glow", 3]) {
      storeState.set("menuBarWidgetBackground", removed)
      await expect(loadMenuBarWidgetBackdrop()).resolves.toEqual(DEFAULT_MENU_BAR_WIDGET_BACKDROP)
    }
  })

  it("migrates the legacy menu bar widget card boolean when the new key is absent", async () => {
    storeState.set("menuBarWidgetCard", false)
    await expect(loadMenuBarWidgetBackdrop()).resolves.toEqual({ ...DEFAULT_MENU_BAR_WIDGET_BACKDROP, enabled: false })
    storeState.set("menuBarWidgetCard", true)
    await expect(loadMenuBarWidgetBackdrop()).resolves.toEqual({
      enabled: true,
      color: "auto",
      opacity: 92,
      glass: 0,
      blur: 0,
    })
    storeState.set("menuBarWidgetCard", "no")
    await expect(loadMenuBarWidgetBackdrop()).resolves.toEqual(DEFAULT_MENU_BAR_WIDGET_BACKDROP)
  })

  it("prefers the new backdrop key over the legacy keys", async () => {
    storeState.set("menuBarWidgetCard", false)
    storeState.set("menuBarWidgetBackground", "none")
    storeState.set("menuBarWidgetBackdrop", { enabled: true, color: "auto", opacity: 70, glass: 10, blur: 20 })
    await expect(loadMenuBarWidgetBackdrop()).resolves.toEqual({
      enabled: true,
      color: "auto",
      opacity: 70,
      glass: 10,
      blur: 20,
    })
  })

  it("prefers a legacy background over the legacy card boolean", async () => {
    storeState.set("menuBarWidgetCard", false)
    storeState.set("menuBarWidgetBackground", "inverted")
    await expect(loadMenuBarWidgetBackdrop()).resolves.toMatchObject({ enabled: true, color: "#ffffff" })
  })

  it("loads and saves the menu bar widget style", async () => {
    for (const style of ["stacked", "compact", "inline", "inline-compact"] as const) {
      await saveMenuBarWidgetStyle(style)
      expect(storeState.get("menuBarWidgetStyle")).toBe(style)
      await expect(loadMenuBarWidgetStyle()).resolves.toBe(style)
    }
  })

  it("migrates removed menu bar widget styles to the default", async () => {
    for (const removed of ["bars", "rings"]) {
      storeState.set("menuBarWidgetStyle", removed)
      await expect(loadMenuBarWidgetStyle()).resolves.toBe(DEFAULT_MENU_BAR_WIDGET_STYLE)
    }
  })

  it("falls back to default for an invalid menu bar widget style", async () => {
    storeState.set("menuBarWidgetStyle", 3)
    await expect(loadMenuBarWidgetStyle()).resolves.toBe(DEFAULT_MENU_BAR_WIDGET_STYLE)
  })

  it("loads the default dock overlay style when missing", async () => {
    await expect(loadDockOverlayStyle()).resolves.toBe("pill")
    expect(DEFAULT_DOCK_OVERLAY_STYLE).toBe("pill")
  })

  it("loads and saves the dock overlay style", async () => {
    for (const style of ["off", "pill"] as const) {
      await saveDockOverlayStyle(style)
      expect(storeState.get("dockOverlayStyle")).toBe(style)
      await expect(loadDockOverlayStyle()).resolves.toBe(style)
    }
  })

  it("falls back to default for an invalid dock overlay style", async () => {
    storeState.set("dockOverlayStyle", "glow")
    await expect(loadDockOverlayStyle()).resolves.toBe("pill")
    expect(parseDockOverlayStyle(3)).toBeNull()
    expect(parseDockOverlayStyle("glow")).toBeNull()
    expect(parseDockOverlayStyle("off")).toBe("off")
    expect(parseDockOverlayStyle("pill")).toBe("pill")
  })

  it("migrates the removed ring, bars and badge dock overlay styles to pill", async () => {
    for (const old of ["ring", "bars", "badge"]) {
      storeState.set("dockOverlayStyle", old)
      await expect(loadDockOverlayStyle()).resolves.toBe("pill")
      expect(parseDockOverlayStyle(old)).toBe("pill")
    }
  })

  it("loads the default pace thresholds when missing or invalid", async () => {
    expect(DEFAULT_PACE_THRESHOLDS).toEqual({ healthy: 80, closeToLimit: 100 })
    await expect(loadPaceThresholds()).resolves.toEqual(DEFAULT_PACE_THRESHOLDS)
    storeState.set("paceThresholds", { healthy: 90, closeToLimit: 80 })
    await expect(loadPaceThresholds()).resolves.toEqual(DEFAULT_PACE_THRESHOLDS)
  })

  it("loads and saves pace thresholds", async () => {
    await savePaceThresholds({ healthy: 60, closeToLimit: 120 })
    expect(storeState.get("paceThresholds")).toEqual({ healthy: 60, closeToLimit: 120 })
    expect(storeSaveMock).toHaveBeenCalled()
    await expect(loadPaceThresholds()).resolves.toEqual({ healthy: 60, closeToLimit: 120 })
  })

  it("parses pace thresholds: rounds, enforces 5 <= healthy < closeToLimit <= 150", () => {
    expect(parsePaceThresholds({ healthy: 79.6, closeToLimit: 100.2 })).toEqual({ healthy: 80, closeToLimit: 100 })
    expect(parsePaceThresholds({ healthy: 5, closeToLimit: 150 })).toEqual({ healthy: 5, closeToLimit: 150 })
    for (const bad of [
      null,
      "x",
      {},
      { healthy: 4, closeToLimit: 100 },
      { healthy: 80, closeToLimit: 151 },
      { healthy: 100, closeToLimit: 100 },
      { healthy: "80", closeToLimit: 100 },
      { healthy: Number.NaN, closeToLimit: 100 },
    ]) {
      expect(parsePaceThresholds(bad)).toBeNull()
    }
  })

  it("loads the default menu bar widget colors when missing", async () => {
    await expect(loadMenuBarWidgetColors()).resolves.toEqual(DEFAULT_MENU_BAR_WIDGET_COLORS)
    expect(DEFAULT_MENU_BAR_WIDGET_COLORS).toEqual({})
  })

  it("loads and saves the menu bar widget colors", async () => {
    const colors = { ahead: "#00ff00", onTrack: "#ffaa00", behind: "#ff0000" }
    await saveMenuBarWidgetColors(colors)
    expect(storeState.get("menuBarWidgetColors")).toEqual(colors)
    await expect(loadMenuBarWidgetColors()).resolves.toEqual(colors)

    await saveMenuBarWidgetColors({ behind: "#123456" })
    await expect(loadMenuBarWidgetColors()).resolves.toEqual({ behind: "#123456" })
  })

  it("drops invalid menu bar widget color entries and normalizes the valid ones", async () => {
    storeState.set("menuBarWidgetColors", {
      ahead: "#ABCDEF",
      onTrack: "red",
      behind: "#12345",
      extra: "#000000",
    })
    await expect(loadMenuBarWidgetColors()).resolves.toEqual({ ahead: "#abcdef" })

    expect(parseMenuBarWidgetColors({ ahead: 5, behind: "#12345g" })).toEqual({})
    expect(parseMenuBarWidgetColors(null)).toEqual({})
    expect(parseMenuBarWidgetColors("#ffffff")).toEqual({})
    expect(parseMenuBarWidgetColors(["#ffffff"])).toEqual({})
  })

  it("loads the default menu bar widget text colors when missing", async () => {
    await expect(loadMenuBarWidgetTextColors()).resolves.toEqual({ label: "mono", used: "color", expected: "mono" })
    expect(DEFAULT_MENU_BAR_WIDGET_TEXT_COLORS).toEqual({ label: "mono", used: "color", expected: "mono" })
  })

  it("loads and saves the menu bar widget text colors", async () => {
    const value = { label: "color", used: "mono", expected: "mono" } as const
    await saveMenuBarWidgetTextColors(value)
    expect(storeState.get("menuBarWidgetTextColors")).toEqual(value)
    await expect(loadMenuBarWidgetTextColors()).resolves.toEqual(value)
  })

  it("falls back to the default per field for invalid text color entries", () => {
    expect(parseMenuBarWidgetTextColors({ label: "color", used: "rainbow", expected: 3 })).toEqual({
      label: "color",
      used: "color",
      expected: "mono",
    })
    expect(parseMenuBarWidgetTextColors({ used: "mono" })).toEqual({ label: "mono", used: "mono", expected: "mono" })
    for (const bad of [null, undefined, "mono", 5, ["color"]]) {
      expect(parseMenuBarWidgetTextColors(bad)).toEqual(DEFAULT_MENU_BAR_WIDGET_TEXT_COLORS)
    }
  })

  it("loads the default menu bar widget tone modes when missing", async () => {
    await expect(loadMenuBarWidgetToneModes()).resolves.toEqual({ ahead: "mono", onTrack: "color", behind: "color" })
    expect(DEFAULT_MENU_BAR_WIDGET_TONE_MODES).toEqual({ ahead: "mono", onTrack: "color", behind: "color" })
  })

  it("loads and saves the menu bar widget tone modes", async () => {
    const value = { ahead: "mono", onTrack: "color", behind: "mono" } as const
    await saveMenuBarWidgetToneModes(value)
    expect(storeState.get("menuBarWidgetToneModes")).toEqual(value)
    await expect(loadMenuBarWidgetToneModes()).resolves.toEqual(value)
  })

  it("falls back to color per field for invalid tone mode entries", () => {
    expect(parseMenuBarWidgetToneModes({ ahead: "mono", onTrack: "rainbow", behind: 3 })).toEqual({
      ahead: "mono",
      onTrack: "color",
      behind: "color",
    })
    for (const bad of [null, undefined, "mono", 5, ["mono"]]) {
      expect(parseMenuBarWidgetToneModes(bad)).toEqual(DEFAULT_MENU_BAR_WIDGET_TONE_MODES)
    }
  })

  it("loads default widget provider ids when missing", async () => {
    await expect(loadWidgetProviderIds()).resolves.toBe(DEFAULT_WIDGET_PROVIDER_IDS)
  })

  it("loads and saves widget provider ids", async () => {
    await saveWidgetProviderIds(["claude", "codex"])
    await expect(loadWidgetProviderIds()).resolves.toEqual(["claude", "codex"])
  })

  it("allows an empty widget provider list", async () => {
    await saveWidgetProviderIds([])
    await expect(loadWidgetProviderIds()).resolves.toEqual([])
  })

  it("falls back to default for invalid widget provider ids", async () => {
    storeState.set("widgetProviderIds", [1, "codex"])
    await expect(loadWidgetProviderIds()).resolves.toBe(DEFAULT_WIDGET_PROVIDER_IDS)
  })

  it("loads default widget provider metrics when missing", async () => {
    await expect(loadWidgetProviderMetrics()).resolves.toEqual(DEFAULT_WIDGET_PROVIDER_METRICS)
  })

  it("loads and saves widget provider metrics per plugin id", async () => {
    await saveWidgetProviderMetrics({ "claude@1a2b3c4d": ["Session", "Weekly"], codex: [] })
    await expect(loadWidgetProviderMetrics()).resolves.toEqual({
      "claude@1a2b3c4d": ["Session", "Weekly"],
      codex: [],
    })
    expect(storeSaveMock).toHaveBeenCalled()
  })

  it("drops widget provider metric entries that are not string arrays", async () => {
    storeState.set("widgetProviderMetrics", {
      claude: ["Session"],
      codex: "Weekly",
      cursor: [1, "Total Usage"],
      devin: null,
      grok: ["Weekly", "Requests"],
    })
    await expect(loadWidgetProviderMetrics()).resolves.toEqual({
      claude: ["Session"],
      grok: ["Weekly", "Requests"],
    })
  })

  it("falls back to default when the stored widget provider metrics are not an object", async () => {
    storeState.set("widgetProviderMetrics", ["Session"])
    await expect(loadWidgetProviderMetrics()).resolves.toEqual(DEFAULT_WIDGET_PROVIDER_METRICS)
  })
})

describe("surface overrides", () => {
  beforeEach(() => storeState.clear())
  const global = {
    colors: { ahead: "#111111" },
    textColors: { label: "mono", used: "color", expected: "mono" },
    toneModes: { ahead: "mono", onTrack: "color", behind: "color" },
  } as const
  const globalProviders = { providerIds: ["claude"], providerMetrics: { claude: ["Session"] } }

  it("uses separate store keys per surface", () => {
    expect(surfaceOverridesKey("menuBar")).toBe("menuBarOverrides")
    expect(surfaceOverridesKey("dock")).toBe("dockOverrides")
  })

  it("parses missing or invalid values to no overrides", () => {
    expect(parseSurfaceOverrides(undefined)).toEqual(DEFAULT_SURFACE_OVERRIDES)
    expect(parseSurfaceOverrides("x")).toEqual(DEFAULT_SURFACE_OVERRIDES)
    expect(parseSurfaceOverrides({ colors: "x", providers: { providerIds: [1] } })).toEqual(DEFAULT_SURFACE_OVERRIDES)
  })

  it("parses each part with the existing parsers", () => {
    const parsed = parseSurfaceOverrides({
      colors: { colors: { ahead: "#ABCDEF", behind: "red" }, textColors: { label: "color", used: "x" }, toneModes: {} },
      providers: { providerIds: null, providerMetrics: { claude: ["Session"], codex: "Weekly" } },
    })
    expect(parsed.colors).toEqual({
      colors: { ahead: "#abcdef" },
      textColors: { ...DEFAULT_MENU_BAR_WIDGET_TEXT_COLORS, label: "color" },
      toneModes: DEFAULT_MENU_BAR_WIDGET_TONE_MODES,
    })
    expect(parsed.providers).toEqual({ providerIds: null, providerMetrics: { claude: ["Session"] } })
  })

  it("keeps one part when the other is invalid", () => {
    const parsed = parseSurfaceOverrides({ colors: null, providers: { providerIds: ["a"], providerMetrics: {} } })
    expect(parsed.colors).toBeNull()
    expect(parsed.providers).toEqual({ providerIds: ["a"], providerMetrics: {} })
  })

  it("saves and loads per surface", async () => {
    const value = { colors: { ...global }, providers: null }
    await saveSurfaceOverrides("dock", value)
    expect(storeState.get("dockOverrides")).toEqual(value)
    await expect(loadSurfaceOverrides("dock")).resolves.toEqual(value)
    await expect(loadSurfaceOverrides("menuBar")).resolves.toEqual(DEFAULT_SURFACE_OVERRIDES)
  })

  it("effectiveColors / effectiveProviders prefer the override and fall back to the global value", () => {
    const own = { ...global, colors: { behind: "#222222" } }
    expect(effectiveColors(global, DEFAULT_SURFACE_OVERRIDES)).toBe(global)
    expect(effectiveColors(global, { colors: own, providers: null })).toBe(own)
    const ownProviders = { providerIds: ["codex"], providerMetrics: {} }
    expect(effectiveProviders(globalProviders, DEFAULT_SURFACE_OVERRIDES)).toBe(globalProviders)
    expect(effectiveProviders(globalProviders, { colors: null, providers: ownProviders })).toBe(ownProviders)
  })
})
