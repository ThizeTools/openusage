import { useCallback, useEffect, useMemo, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { emit } from "@tauri-apps/api/event"
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart"
import { LazyStore } from "@tauri-apps/plugin-store"
import { useAccountsChanged } from "@/hooks/app/use-accounts-changed"
import { useWidgetVisibilitySync } from "@/hooks/app/use-widget-visibility-sync"
import type { PluginMeta } from "@/lib/plugin-types"
import { reloadPluginList } from "@/lib/provider-discovery"
import {
  DEFAULT_AUTO_UPDATE_INTERVAL,
  DEFAULT_GLOBAL_SHORTCUT,
  DEFAULT_RESET_TIMER_DISPLAY_MODE,
  DEFAULT_START_ON_LOGIN,
  DEFAULT_STATS_SHORTCUT,
  DEFAULT_THEME_MODE,
  DEFAULT_WIDGET_PROVIDER_IDS,
  DEFAULT_WIDGET_PROVIDER_METRICS,
  DEFAULT_WIDGET_VISIBLE,
  loadAutoUpdateInterval,
  loadGlobalShortcut,
  loadPluginSettings,
  loadResetTimerDisplayMode,
  loadStartOnLogin,
  loadStatsShortcut,
  loadThemeMode,
  loadWidgetProviderIds,
  loadWidgetProviderMetrics,
  loadWidgetVisible,
  normalizePluginSettings,
  parseWidgetProviderMetrics,
  savePluginSettings,
  saveAutoUpdateInterval,
  saveGlobalShortcut,
  saveResetTimerDisplayMode,
  saveStartOnLogin,
  saveStatsShortcut,
  saveThemeMode,
  saveWidgetProviderIds,
  saveWidgetProviderMetrics,
  SETTINGS_AUTO_UPDATE_INTERVAL_CHANGED_EVENT,
  SETTINGS_PLUGINS_CHANGED_EVENT,
  type AutoUpdateIntervalMinutes,
  type GlobalShortcut,
  type PluginSettings,
  type ResetTimerDisplayMode,
  type ThemeMode,
  type WidgetProviderIds,
  type WidgetProviderMetrics,
} from "@/lib/settings"

/**
 * Self-contained settings state for the dedicated Settings window. It reads from
 * and writes to the shared settings store; the main window observes the same
 * store keys to keep the tray and probes in sync.
 */
export function useSettingsWindow() {
  const [pluginsMeta, setPluginsMeta] = useState<PluginMeta[]>([])
  const [pluginSettings, setPluginSettings] = useState<PluginSettings | null>(null)
  const [autoUpdateInterval, setAutoUpdateInterval] = useState<AutoUpdateIntervalMinutes>(DEFAULT_AUTO_UPDATE_INTERVAL)
  const [themeMode, setThemeMode] = useState<ThemeMode>(DEFAULT_THEME_MODE)
  const [resetTimerDisplayMode, setResetTimerDisplayMode] = useState<ResetTimerDisplayMode>(DEFAULT_RESET_TIMER_DISPLAY_MODE)
  const [globalShortcut, setGlobalShortcut] = useState<GlobalShortcut>(DEFAULT_GLOBAL_SHORTCUT)
  const [statsShortcut, setStatsShortcut] = useState<GlobalShortcut>(DEFAULT_STATS_SHORTCUT)
  const [startOnLogin, setStartOnLogin] = useState<boolean>(DEFAULT_START_ON_LOGIN)
  const [widgetVisible, setWidgetVisible] = useState<boolean>(DEFAULT_WIDGET_VISIBLE)
  const [widgetProviderIds, setWidgetProviderIds] = useState<WidgetProviderIds>(DEFAULT_WIDGET_PROVIDER_IDS)
  const [widgetProviderMetrics, setWidgetProviderMetrics] =
    useState<WidgetProviderMetrics>(DEFAULT_WIDGET_PROVIDER_METRICS)

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    void (async () => {
      try {
        const meta = await invoke<PluginMeta[]>("list_plugins")
        if (cancelled) return
        setPluginsMeta(meta)
        const [
          stored, interval, theme, resetTimer, shortcut, stats,
          login, visible, providers, providerMetrics,
        ] = await Promise.all([
          loadPluginSettings(),
          loadAutoUpdateInterval(),
          loadThemeMode(),
          loadResetTimerDisplayMode(),
          loadGlobalShortcut(),
          loadStatsShortcut(),
          loadStartOnLogin(),
          loadWidgetVisible(),
          loadWidgetProviderIds(),
          loadWidgetProviderMetrics(),
        ])
        if (cancelled) return
        setPluginSettings(normalizePluginSettings(stored, meta))
        setAutoUpdateInterval(interval)
        setThemeMode(theme)
        setResetTimerDisplayMode(resetTimer)
        setGlobalShortcut(shortcut)
        setStatsShortcut(stats)
        setStartOnLogin(login)
        setWidgetVisible(visible)
        setWidgetProviderIds(providers)
        setWidgetProviderMetrics(providerMetrics)
      } catch (error) {
        console.error("Failed to bootstrap settings window:", error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Keep Settings live when another window writes the same shared store (popup
  // reset-timer toggle, plugin nav actions).
  useEffect(() => {
    if (!isTauri()) return
    const store = new LazyStore("settings.json")
    let cancelled = false
    const unlisteners: (() => void)[] = []
    void (async () => {
      const subscribe = async <T,>(key: string, apply: (value: T) => void) => {
        const fn = await store.onKeyChange<T>(key, (value) => {
          if (value !== undefined && value !== null) apply(value)
        })
        if (cancelled) fn()
        else unlisteners.push(fn)
      }
      await subscribe<ResetTimerDisplayMode>("resetTimerDisplayMode", (value) => {
        if (value === "relative" || value === "absolute") setResetTimerDisplayMode(value)
      })
      await subscribe<unknown>("widgetProviderMetrics", (value) => {
        setWidgetProviderMetrics(parseWidgetProviderMetrics(value))
      })
      await subscribe<PluginSettings>("plugins", (value) => {
        setPluginsMeta((meta) => {
          if (meta.length > 0) setPluginSettings(normalizePluginSettings(value, meta))
          return meta
        })
      })
    })()
    return () => {
      cancelled = true
      for (const fn of unlisteners) fn()
    }
  }, [])

  // Widget visibility can change from the tray, shortcut, or Escape — Rust
  // emits widget:visibility on every change.
  useWidgetVisibilitySync(setWidgetVisible)

  // Accounts added/removed/renamed: reload the plugin list shown here.
  useAccountsChanged(() => {
    void reloadPluginList()
      .then(({ meta, settings }) => {
        setPluginsMeta(meta)
        setPluginSettings(settings)
      })
      .catch((error) => console.error("Failed to reload providers after account change:", error))
  })

  const persistPluginSettings = useCallback((next: PluginSettings) => {
    setPluginSettings(next)
    void savePluginSettings(next).catch((error) => console.error("Failed to save plugins:", error))
    if (isTauri()) {
      void emit(SETTINGS_PLUGINS_CHANGED_EVENT, next).catch((error) =>
        console.error("Failed to notify plugin settings change:", error)
      )
    }
  }, [])

  const handleToggle = useCallback((id: string) => {
    setPluginSettings((current) => {
      if (!current) return current
      const disabled = current.disabled.includes(id)
        ? current.disabled.filter((d) => d !== id)
        : [...current.disabled, id]
      const next = { ...current, disabled }
      void savePluginSettings(next).catch((error) => console.error("Failed to save plugins:", error))
      if (isTauri()) {
        void emit(SETTINGS_PLUGINS_CHANGED_EVENT, next).catch((error) =>
          console.error("Failed to notify plugin settings change:", error)
        )
      }
      return next
    })
  }, [])

  const handleReorder = useCallback((orderedIds: string[]) => {
    setPluginSettings((current) => {
      if (!current) return current
      const next = { ...current, order: orderedIds }
      persistPluginSettings(next)
      return next
    })
  }, [persistPluginSettings])

  const handleAutoUpdateIntervalChange = useCallback((value: AutoUpdateIntervalMinutes) => {
    setAutoUpdateInterval(value)
    void saveAutoUpdateInterval(value).catch((error) => console.error("Failed to save interval:", error))
    if (isTauri()) {
      void emit(SETTINGS_AUTO_UPDATE_INTERVAL_CHANGED_EVENT, value).catch((error) =>
        console.error("Failed to notify auto-update interval change:", error)
      )
    }
  }, [])

  const handleThemeModeChange = useCallback((value: ThemeMode) => {
    setThemeMode(value)
    void saveThemeMode(value).catch((error) => console.error("Failed to save theme:", error))
  }, [])

  const handleResetTimerDisplayModeChange = useCallback((value: ResetTimerDisplayMode) => {
    setResetTimerDisplayMode(value)
    void saveResetTimerDisplayMode(value).catch((error) => console.error("Failed to save reset timer:", error))
  }, [])

  const handleGlobalShortcutChange = useCallback((value: GlobalShortcut) => {
    setGlobalShortcut(value)
    void saveGlobalShortcut(value).catch((error) => console.error("Failed to save widget shortcut:", error))
    if (isTauri()) {
      void invoke("update_global_shortcut", { shortcut: value }).catch((error) =>
        console.error("Failed to update widget shortcut:", error)
      )
    }
  }, [])

  const handleStatsShortcutChange = useCallback((value: GlobalShortcut) => {
    setStatsShortcut(value)
    void saveStatsShortcut(value).catch((error) => console.error("Failed to save stats shortcut:", error))
    if (isTauri()) {
      void invoke("update_stats_shortcut", { shortcut: value }).catch((error) =>
        console.error("Failed to update stats shortcut:", error)
      )
    }
  }, [])

  const handleStartOnLoginChange = useCallback((value: boolean) => {
    setStartOnLogin(value)
    void saveStartOnLogin(value).catch((error) => console.error("Failed to save start on login:", error))
    if (!isTauri()) return
    void (async () => {
      try {
        const enabled = await isAutostartEnabled()
        if (value && !enabled) await enableAutostart()
        if (!value && enabled) await disableAutostart()
      } catch (error) {
        console.error("Failed to apply start on login:", error)
      }
    })()
  }, [])

  const handleWidgetVisibleChange = useCallback((value: boolean) => {
    setWidgetVisible(value)
    if (!isTauri()) return
    void invoke("set_widget_visible", { visible: value }).catch((error) =>
      console.error("Failed to set widget visibility:", error)
    )
  }, [])

  const handleWidgetProviderIdsChange = useCallback((value: WidgetProviderIds) => {
    setWidgetProviderIds(value)
    void saveWidgetProviderIds(value).catch((error) => console.error("Failed to save widget providers:", error))
  }, [])

  const handleWidgetProviderMetricsChange = useCallback((value: WidgetProviderMetrics) => {
    setWidgetProviderMetrics(value)
    void saveWidgetProviderMetrics(value).catch((error) =>
      console.error("Failed to save widget provider metrics:", error)
    )
  }, [])

  const plugins = useMemo(() => {
    if (!pluginSettings) return []
    const disabled = new Set(pluginSettings.disabled)
    const nameById = new Map(pluginsMeta.map((m) => [m.id, m.name]))
    return pluginSettings.order.map((id) => ({
      id,
      name: nameById.get(id) ?? id,
      enabled: !disabled.has(id),
    }))
  }, [pluginSettings, pluginsMeta])

  return {
    plugins,
    pluginsMeta,
    ready: pluginSettings !== null,
    autoUpdateInterval,
    themeMode,
    resetTimerDisplayMode,
    globalShortcut,
    statsShortcut,
    startOnLogin,
    widgetVisible,
    widgetProviderIds,
    widgetProviderMetrics,
    handleToggle,
    handleReorder,
    handleAutoUpdateIntervalChange,
    handleThemeModeChange,
    handleResetTimerDisplayModeChange,
    handleGlobalShortcutChange,
    handleStatsShortcutChange,
    handleStartOnLoginChange,
    handleWidgetVisibleChange,
    handleWidgetProviderIdsChange,
    handleWidgetProviderMetricsChange,
  }
}
