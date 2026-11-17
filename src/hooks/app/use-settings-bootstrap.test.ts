import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  arePluginSettingsEqualMock,
  disableAutostartMock,
  enableAutostartMock,
  getEnabledPluginIdsMock,
  invokeMock,
  isAutostartEnabledMock,
  isTauriMock,
  loadAutoUpdateIntervalMock,
  loadDisplayModeMock,
  loadGlobalShortcutMock,
  loadMenubarIconStyleMock,
  loadPluginSettingsMock,
  loadResetTimerDisplayModeMock,
  loadStartOnLoginMock,
  loadThemeModeMock,
  loadWidgetProviderIdsMock,
  loadWidgetVisibleMock,
  migrateLegacyTraySettingsMock,
  migrateWindsurfToDevinMock,
  normalizePluginSettingsMock,
  savePluginSettingsMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
  isAutostartEnabledMock: vi.fn(),
  enableAutostartMock: vi.fn(),
  disableAutostartMock: vi.fn(),
  arePluginSettingsEqualMock: vi.fn(),
  getEnabledPluginIdsMock: vi.fn(),
  loadAutoUpdateIntervalMock: vi.fn(),
  loadDisplayModeMock: vi.fn(),
  loadGlobalShortcutMock: vi.fn(),
  loadMenubarIconStyleMock: vi.fn(),
  loadPluginSettingsMock: vi.fn(),
  loadResetTimerDisplayModeMock: vi.fn(),
  loadStartOnLoginMock: vi.fn(),
  loadThemeModeMock: vi.fn(),
  loadWidgetProviderIdsMock: vi.fn(),
  loadWidgetVisibleMock: vi.fn(),
  migrateLegacyTraySettingsMock: vi.fn(),
  migrateWindsurfToDevinMock: vi.fn(),
  normalizePluginSettingsMock: vi.fn(),
  savePluginSettingsMock: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}))

vi.mock("@tauri-apps/plugin-autostart", () => ({
  disable: disableAutostartMock,
  enable: enableAutostartMock,
  isEnabled: isAutostartEnabledMock,
}))

vi.mock("@/lib/settings", () => ({
  arePluginSettingsEqual: arePluginSettingsEqualMock,
  DEFAULT_AUTO_UPDATE_INTERVAL: 15,
  DEFAULT_DISPLAY_MODE: "left",
  DEFAULT_GLOBAL_SHORTCUT: null,
  DEFAULT_MENUBAR_ICON_STYLE: "provider",
  DEFAULT_PLUGIN_SETTINGS: { order: [], disabled: [] },
  DEFAULT_RESET_TIMER_DISPLAY_MODE: "relative",
  DEFAULT_START_ON_LOGIN: false,
  DEFAULT_THEME_MODE: "system",
  DEFAULT_WIDGET_PROVIDER_IDS: null,
  DEFAULT_WIDGET_VISIBLE: false,
  getEnabledPluginIds: getEnabledPluginIdsMock,
  loadAutoUpdateInterval: loadAutoUpdateIntervalMock,
  loadDisplayMode: loadDisplayModeMock,
  loadGlobalShortcut: loadGlobalShortcutMock,
  loadMenubarIconStyle: loadMenubarIconStyleMock,
  loadPluginSettings: loadPluginSettingsMock,
  loadResetTimerDisplayMode: loadResetTimerDisplayModeMock,
  loadStartOnLogin: loadStartOnLoginMock,
  loadThemeMode: loadThemeModeMock,
  loadWidgetProviderIds: loadWidgetProviderIdsMock,
  loadWidgetVisible: loadWidgetVisibleMock,
  migrateLegacyTraySettings: migrateLegacyTraySettingsMock,
  migrateWindsurfToDevin: migrateWindsurfToDevinMock,
  normalizePluginSettings: normalizePluginSettingsMock,
  savePluginSettings: savePluginSettingsMock,
}))

import { useSettingsBootstrap } from "@/hooks/app/use-settings-bootstrap"

function createArgs() {
  return {
    setPluginSettings: vi.fn(),
    setPluginsMeta: vi.fn(),
    setAutoUpdateInterval: vi.fn(),
    setThemeMode: vi.fn(),
    setDisplayMode: vi.fn(),
    setResetTimerDisplayMode: vi.fn(),
    setGlobalShortcut: vi.fn(),
    setStartOnLogin: vi.fn(),
    setMenubarIconStyle: vi.fn(),
    setWidgetVisible: vi.fn(),
    setWidgetProviderIds: vi.fn(),
    setLoadingForPlugins: vi.fn(),
    setErrorForPlugins: vi.fn(),
    startBatch: vi.fn().mockResolvedValue(undefined),
  }
}

describe("useSettingsBootstrap", () => {
  beforeEach(() => {
    invokeMock.mockReset()
    isTauriMock.mockReset()
    isAutostartEnabledMock.mockReset()
    enableAutostartMock.mockReset()
    disableAutostartMock.mockReset()
    arePluginSettingsEqualMock.mockReset()
    getEnabledPluginIdsMock.mockReset()
    loadAutoUpdateIntervalMock.mockReset()
    loadDisplayModeMock.mockReset()
    loadGlobalShortcutMock.mockReset()
    loadMenubarIconStyleMock.mockReset()
    loadPluginSettingsMock.mockReset()
    loadResetTimerDisplayModeMock.mockReset()
    loadStartOnLoginMock.mockReset()
    loadThemeModeMock.mockReset()
    loadWidgetProviderIdsMock.mockReset()
    loadWidgetVisibleMock.mockReset()
    migrateLegacyTraySettingsMock.mockReset()
    migrateWindsurfToDevinMock.mockReset()
    normalizePluginSettingsMock.mockReset()
    savePluginSettingsMock.mockReset()

    isTauriMock.mockReturnValue(true)
    isAutostartEnabledMock.mockResolvedValue(true)
    invokeMock.mockResolvedValue([
      {
        id: "codex",
        name: "Codex",
        iconUrl: "/codex.svg",
        brandColor: "#000000",
        lines: [],
        primaryCandidates: [],
      },
    ])
    loadPluginSettingsMock.mockResolvedValue({ order: ["codex"], disabled: [] })
    normalizePluginSettingsMock.mockImplementation((stored, plugins) =>
      stored.order.length > 0
        ? stored
        : { order: plugins.map((plugin: { id: string }) => plugin.id), disabled: [] }
    )
    arePluginSettingsEqualMock.mockReturnValue(true)
    loadAutoUpdateIntervalMock.mockResolvedValue(15)
    loadThemeModeMock.mockResolvedValue("dark")
    loadDisplayModeMock.mockResolvedValue("used")
    loadResetTimerDisplayModeMock.mockResolvedValue("relative")
    loadGlobalShortcutMock.mockResolvedValue("CommandOrControl+Shift+O")
    loadMenubarIconStyleMock.mockResolvedValue("provider")
    loadStartOnLoginMock.mockResolvedValue(true)
    loadWidgetProviderIdsMock.mockResolvedValue(null)
    loadWidgetVisibleMock.mockResolvedValue(false)
    migrateLegacyTraySettingsMock.mockResolvedValue(undefined)
    migrateWindsurfToDevinMock.mockImplementation((settings) => settings)
    savePluginSettingsMock.mockResolvedValue(undefined)
    getEnabledPluginIdsMock.mockReturnValue(["codex"])
  })

  it("disables autostart when applyStartOnLogin receives false", async () => {
    const args = createArgs()
    const { result } = renderHook(() => useSettingsBootstrap(args))

    await result.current.applyStartOnLogin(false)

    expect(disableAutostartMock).toHaveBeenCalledTimes(1)
    expect(enableAutostartMock).not.toHaveBeenCalled()
  })

  it("falls back to default reset timer mode when loading fails", async () => {
    const resetModeError = new Error("reset timer mode unavailable")
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    loadResetTimerDisplayModeMock.mockRejectedValueOnce(resetModeError)
    const args = createArgs()

    renderHook(() => useSettingsBootstrap(args))

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to load reset timer display mode:",
        resetModeError
      )
      expect(args.setResetTimerDisplayMode).toHaveBeenCalledWith("relative")
    })

    errorSpy.mockRestore()
  })

  it("migrates windsurf settings before normalizing and saves the first-launch result", async () => {
    const args = createArgs()
    const storedSettings = { order: ["windsurf"], disabled: [] }
    const migratedSettings = { order: ["devin"], disabled: [] }
    const availablePlugins = [
      {
        id: "devin",
        name: "Devin",
        iconUrl: "/devin.svg",
        brandColor: "#000000",
        lines: [],
        primaryCandidates: [],
      },
    ]

    invokeMock.mockResolvedValueOnce(availablePlugins)
    loadPluginSettingsMock.mockResolvedValueOnce(storedSettings)
    migrateWindsurfToDevinMock.mockReturnValueOnce(migratedSettings)
    normalizePluginSettingsMock
      .mockReturnValueOnce(migratedSettings)
      .mockReturnValueOnce(migratedSettings)
    arePluginSettingsEqualMock
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
    getEnabledPluginIdsMock.mockReturnValueOnce(["devin"])

    renderHook(() => useSettingsBootstrap(args))

    await waitFor(() => {
      expect(normalizePluginSettingsMock).toHaveBeenCalledWith(
        migratedSettings,
        availablePlugins
      )
      expect(savePluginSettingsMock).toHaveBeenCalledWith(migratedSettings)
      expect(args.setPluginSettings).toHaveBeenCalledWith(migratedSettings)
      expect(args.startBatch).toHaveBeenCalledWith(["devin"])
    })
  })

  it("publishes plugin settings before loading non-critical preferences", async () => {
    const args = createArgs()
    loadAutoUpdateIntervalMock.mockReturnValueOnce(new Promise(() => {}))

    renderHook(() => useSettingsBootstrap(args))

    await waitFor(() => {
      expect(args.setPluginsMeta).toHaveBeenCalled()
      expect(args.setPluginSettings).toHaveBeenCalledWith({
        order: ["codex"],
        disabled: [],
      })
      expect(args.setLoadingForPlugins).toHaveBeenCalledWith(["codex"])
      expect(args.startBatch).toHaveBeenCalledWith(["codex"])
    })
    expect(args.setAutoUpdateInterval).not.toHaveBeenCalled()
  })

  it("publishes default plugin settings before stored settings load", async () => {
    const args = createArgs()
    loadPluginSettingsMock.mockReturnValueOnce(new Promise(() => {}))

    renderHook(() => useSettingsBootstrap(args))

    await waitFor(() => {
      expect(args.setPluginsMeta).toHaveBeenCalled()
      expect(args.setPluginSettings).toHaveBeenCalledWith({
        order: ["codex"],
        disabled: [],
      })
      expect(args.setLoadingForPlugins).toHaveBeenCalledWith(["codex"])
      expect(args.startBatch).toHaveBeenCalledWith(["codex"])
    })
    expect(loadAutoUpdateIntervalMock).not.toHaveBeenCalled()
  })

  it("retries transient provider discovery failures", async () => {
    const args = createArgs()
    const availablePlugins = [
      {
        id: "codex",
        name: "Codex",
        iconUrl: "/codex.svg",
        brandColor: "#000000",
        lines: [],
        primaryCandidates: [],
      },
    ]
    invokeMock
      .mockRejectedValueOnce(new Error("provider list not ready"))
      .mockResolvedValueOnce(availablePlugins)

    renderHook(() => useSettingsBootstrap(args))

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledTimes(2)
      expect(args.setPluginsMeta).toHaveBeenCalledWith(availablePlugins)
    })
  })

  it("exposes a provider load error after discovery retries are exhausted", async () => {
    const args = createArgs()
    const error = new Error("provider list unavailable")
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    invokeMock.mockRejectedValue(error)

    const { result } = renderHook(() => useSettingsBootstrap(args))

    await waitFor(() => {
      expect(result.current.pluginLoadError).toBe("Failed to load providers")
    })
    expect(errorSpy).toHaveBeenCalledWith("Failed to load providers:", error)
    expect(args.setPluginSettings).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
