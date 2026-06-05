import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_AUTO_UPDATE_INTERVAL,
  DEFAULT_GLOBAL_SHORTCUT,
  DEFAULT_MENUBAR_ICON_STYLE,
  DEFAULT_PLUGIN_SETTINGS,
  DEFAULT_RESET_TIMER_DISPLAY_MODE,
  DEFAULT_START_ON_LOGIN,
  DEFAULT_THEME_MODE,
  DEFAULT_WIDGET_LAYOUT,
  DEFAULT_WIDGET_PROVIDER_IDS,
  DEFAULT_WIDGET_VISIBLE,
  DEFAULT_WIDGET_ZOOM,
  arePluginSettingsEqual,
  getEnabledPluginIds,
  loadAutoUpdateInterval,
  loadGlobalShortcut,
  loadMenubarIconStyle,
  loadPluginSettings,
  loadResetTimerDisplayMode,
  loadStartOnLogin,
  loadWidgetLayout,
  loadWidgetPosition,
  loadWidgetProviderIds,
  loadWidgetVisible,
  migrateLegacyTraySettings,
  migrateWindsurfToDevin,
  loadThemeMode,
  normalizePluginSettings,
  saveAutoUpdateInterval,
  saveGlobalShortcut,
  saveMenubarIconStyle,
  savePluginSettings,
  saveResetTimerDisplayMode,
  saveStartOnLogin,
  saveThemeMode,
  saveWidgetLayout,
  loadWidgetZoom,
  saveWidgetZoom,
  saveWidgetPosition,
  saveWidgetProviderIds,
  saveWidgetVisible,
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

  it("loads default auto-update interval when missing", async () => {
    await expect(loadAutoUpdateInterval()).resolves.toBe(DEFAULT_AUTO_UPDATE_INTERVAL)
  })

  it("loads stored auto-update interval", async () => {
    storeState.set("autoUpdateInterval", 30)
    await expect(loadAutoUpdateInterval()).resolves.toBe(30)
  })

  it("saves auto-update interval", async () => {
    await saveAutoUpdateInterval(5)
    await expect(loadAutoUpdateInterval()).resolves.toBe(5)
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

  it("loads default global shortcut when missing", async () => {
    await expect(loadGlobalShortcut()).resolves.toBe(DEFAULT_GLOBAL_SHORTCUT)
  })

  it("loads stored global shortcut values", async () => {
    storeState.set("globalShortcut", "CommandOrControl+Shift+O")
    await expect(loadGlobalShortcut()).resolves.toBe("CommandOrControl+Shift+O")

    storeState.set("globalShortcut", null)
    await expect(loadGlobalShortcut()).resolves.toBe(null)
  })

  it("falls back to default for invalid global shortcut values", async () => {
    storeState.set("globalShortcut", 1234)
    await expect(loadGlobalShortcut()).resolves.toBe(DEFAULT_GLOBAL_SHORTCUT)
  })

  it("saves global shortcut values", async () => {
    await saveGlobalShortcut("CommandOrControl+Shift+O")
    await expect(loadGlobalShortcut()).resolves.toBe("CommandOrControl+Shift+O")
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

  it("loads default widget layout when missing", async () => {
    await expect(loadWidgetLayout()).resolves.toBe(DEFAULT_WIDGET_LAYOUT)
  })

  it("loads and saves widget layout", async () => {
    await saveWidgetLayout("horizontal")
    await expect(loadWidgetLayout()).resolves.toBe("horizontal")
  })

  it("falls back to default for invalid widget layout", async () => {
    storeState.set("widgetLayout", "diagonal")
    await expect(loadWidgetLayout()).resolves.toBe(DEFAULT_WIDGET_LAYOUT)
  })

  it("loads default widget visibility when missing", async () => {
    await expect(loadWidgetVisible()).resolves.toBe(DEFAULT_WIDGET_VISIBLE)
  })

  it("loads and saves widget visibility", async () => {
    await saveWidgetVisible(true)
    await expect(loadWidgetVisible()).resolves.toBe(true)
  })

  it("falls back to default for invalid widget visibility", async () => {
    storeState.set("widgetVisible", "yes")
    await expect(loadWidgetVisible()).resolves.toBe(DEFAULT_WIDGET_VISIBLE)
  })

  it("returns null widget position when missing or invalid", async () => {
    await expect(loadWidgetPosition()).resolves.toBeNull()
    storeState.set("widgetPosition", { x: "a", y: 1 })
    await expect(loadWidgetPosition()).resolves.toBeNull()
  })

  it("loads and saves widget position", async () => {
    await saveWidgetPosition({ x: 12, y: 34 })
    await expect(loadWidgetPosition()).resolves.toEqual({ x: 12, y: 34 })
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

  it("loads default widget zoom when missing", async () => {
    await expect(loadWidgetZoom()).resolves.toBe(DEFAULT_WIDGET_ZOOM)
  })

  it("loads and saves widget zoom", async () => {
    await saveWidgetZoom(1.25)
    await expect(loadWidgetZoom()).resolves.toBe(1.25)
  })

  it("falls back to default for invalid widget zoom", async () => {
    storeState.set("widgetZoom", 9)
    await expect(loadWidgetZoom()).resolves.toBe(DEFAULT_WIDGET_ZOOM)
  })
})
