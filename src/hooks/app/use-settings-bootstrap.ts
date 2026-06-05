import { useCallback, useEffect } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart"
import type { PluginMeta } from "@/lib/plugin-types"
import {
  arePluginSettingsEqual,
  DEFAULT_AUTO_UPDATE_INTERVAL,
  DEFAULT_GLOBAL_SHORTCUT,
  DEFAULT_MENUBAR_ICON_STYLE,
  DEFAULT_RESET_TIMER_DISPLAY_MODE,
  DEFAULT_START_ON_LOGIN,
  DEFAULT_THEME_MODE,
  DEFAULT_WIDGET_LAYOUT,
  DEFAULT_WIDGET_PROVIDER_IDS,
  DEFAULT_WIDGET_VISIBLE,
  getEnabledPluginIds,
  loadAutoUpdateInterval,
  loadGlobalShortcut,
  loadMenubarIconStyle,
  migrateLegacyTraySettings,
  migrateWindsurfToDevin,
  loadPluginSettings,
  loadResetTimerDisplayMode,
  loadStartOnLogin,
  loadThemeMode,
  loadWidgetLayout,
  loadWidgetProviderIds,
  loadWidgetVisible,
  normalizePluginSettings,
  savePluginSettings,
  type AutoUpdateIntervalMinutes,
  type GlobalShortcut,
  type MenubarIconStyle,
  type PluginSettings,
  type ResetTimerDisplayMode,
  type ThemeMode,
  type WidgetLayout,
  type WidgetProviderIds,
} from "@/lib/settings"

type UseSettingsBootstrapArgs = {
  setPluginSettings: (value: PluginSettings | null) => void
  setPluginsMeta: (value: PluginMeta[]) => void
  setAutoUpdateInterval: (value: AutoUpdateIntervalMinutes) => void
  setThemeMode: (value: ThemeMode) => void
  setResetTimerDisplayMode: (value: ResetTimerDisplayMode) => void
  setGlobalShortcut: (value: GlobalShortcut) => void
  setStartOnLogin: (value: boolean) => void
  setMenubarIconStyle: (value: MenubarIconStyle) => void
  setWidgetLayout: (value: WidgetLayout) => void
  setWidgetVisible: (value: boolean) => void
  setWidgetProviderIds: (value: WidgetProviderIds) => void
  setLoadingForPlugins: (ids: string[]) => void
  setErrorForPlugins: (ids: string[], error: string) => void
  startBatch: (pluginIds?: string[]) => Promise<string[] | undefined>
}

export function useSettingsBootstrap({
  setPluginSettings,
  setPluginsMeta,
  setAutoUpdateInterval,
  setThemeMode,
  setResetTimerDisplayMode,
  setGlobalShortcut,
  setStartOnLogin,
  setMenubarIconStyle,
  setWidgetLayout,
  setWidgetVisible,
  setWidgetProviderIds,
  setLoadingForPlugins,
  setErrorForPlugins,
  startBatch,
}: UseSettingsBootstrapArgs) {
  const applyStartOnLogin = useCallback(async (value: boolean) => {
    if (!isTauri()) return
    const currentlyEnabled = await isAutostartEnabled()
    if (currentlyEnabled === value) return

    if (value) {
      await enableAutostart()
      return
    }

    await disableAutostart()
  }, [])

  useEffect(() => {
    let isMounted = true

    const loadSettings = async () => {
      try {
        const availablePlugins = await invoke<PluginMeta[]>("list_plugins")
        if (!isMounted) return
        setPluginsMeta(availablePlugins)

        const storedSettings = await loadPluginSettings()
        const migratedSettings = migrateWindsurfToDevin(storedSettings)
        const normalized = normalizePluginSettings(migratedSettings, availablePlugins)
        if (!arePluginSettingsEqual(storedSettings, normalized)) {
          await savePluginSettings(normalized)
        }

        let storedInterval = DEFAULT_AUTO_UPDATE_INTERVAL
        try {
          storedInterval = await loadAutoUpdateInterval()
        } catch (error) {
          console.error("Failed to load auto-update interval:", error)
        }

        let storedThemeMode = DEFAULT_THEME_MODE
        try {
          storedThemeMode = await loadThemeMode()
        } catch (error) {
          console.error("Failed to load theme mode:", error)
        }

        let storedResetTimerDisplayMode = DEFAULT_RESET_TIMER_DISPLAY_MODE
        try {
          storedResetTimerDisplayMode = await loadResetTimerDisplayMode()
        } catch (error) {
          console.error("Failed to load reset timer display mode:", error)
        }

        let storedGlobalShortcut = DEFAULT_GLOBAL_SHORTCUT
        try {
          storedGlobalShortcut = await loadGlobalShortcut()
        } catch (error) {
          console.error("Failed to load global shortcut:", error)
        }

        let storedStartOnLogin = DEFAULT_START_ON_LOGIN
        try {
          storedStartOnLogin = await loadStartOnLogin()
        } catch (error) {
          console.error("Failed to load start on login:", error)
        }

        try {
          await applyStartOnLogin(storedStartOnLogin)
        } catch (error) {
          console.error("Failed to apply start on login setting:", error)
        }
        try {
          await migrateLegacyTraySettings()
        } catch (error) {
          console.error("Failed to migrate legacy tray settings:", error)
        }

        let storedMenubarIconStyle = DEFAULT_MENUBAR_ICON_STYLE
        try {
          storedMenubarIconStyle = await loadMenubarIconStyle()
        } catch (error) {
          console.error("Failed to load menubar icon style:", error)
        }

        let storedWidgetLayout = DEFAULT_WIDGET_LAYOUT
        try {
          storedWidgetLayout = await loadWidgetLayout()
        } catch (error) {
          console.error("Failed to load widget layout:", error)
        }

        let storedWidgetVisible = DEFAULT_WIDGET_VISIBLE
        try {
          storedWidgetVisible = await loadWidgetVisible()
        } catch (error) {
          console.error("Failed to load widget visibility:", error)
        }

        let storedWidgetProviderIds = DEFAULT_WIDGET_PROVIDER_IDS
        try {
          storedWidgetProviderIds = await loadWidgetProviderIds()
        } catch (error) {
          console.error("Failed to load widget providers:", error)
        }

        if (isMounted) {
          setPluginSettings(normalized)
          setAutoUpdateInterval(storedInterval)
          setThemeMode(storedThemeMode)
          setResetTimerDisplayMode(storedResetTimerDisplayMode)
          setGlobalShortcut(storedGlobalShortcut)
          setStartOnLogin(storedStartOnLogin)
          setMenubarIconStyle(storedMenubarIconStyle)
          setWidgetLayout(storedWidgetLayout)
          setWidgetVisible(storedWidgetVisible)
          setWidgetProviderIds(storedWidgetProviderIds)

          const enabledIds = getEnabledPluginIds(normalized)
          setLoadingForPlugins(enabledIds)
          try {
            await startBatch(enabledIds)
          } catch (error) {
            console.error("Failed to start probe batch:", error)
            if (isMounted) {
              setErrorForPlugins(enabledIds, "Failed to start probe")
            }
          }
        }
      } catch (e) {
        console.error("Failed to load plugin settings:", e)
      }
    }

    loadSettings()

    return () => {
      isMounted = false
    }
  }, [
    applyStartOnLogin,
    setAutoUpdateInterval,
    setErrorForPlugins,
    setGlobalShortcut,
    setLoadingForPlugins,
    setMenubarIconStyle,
    migrateWindsurfToDevin,
    migrateLegacyTraySettings,
    setPluginSettings,
    setPluginsMeta,
    setResetTimerDisplayMode,
    setStartOnLogin,
    setThemeMode,
    setWidgetLayout,
    setWidgetVisible,
    setWidgetProviderIds,
    startBatch,
  ])

  return {
    applyStartOnLogin,
  }
}
