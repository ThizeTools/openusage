import { useCallback, useEffect, useMemo, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart"
import type { PluginMeta } from "@/lib/plugin-types"
import { getAvailableWidgetMetrics } from "@/lib/widget-rows"
import {
  DEFAULT_AUTO_UPDATE_INTERVAL,
  DEFAULT_GLOBAL_SHORTCUT,
  DEFAULT_RESET_TIMER_DISPLAY_MODE,
  DEFAULT_START_ON_LOGIN,
  DEFAULT_STATS_SHORTCUT,
  DEFAULT_THEME_MODE,
  DEFAULT_WIDGET_LAYOUT,
  DEFAULT_WIDGET_METRIC,
  DEFAULT_WIDGET_PROVIDER_IDS,
  DEFAULT_WIDGET_VISIBLE,
  getEnabledPluginIds,
  loadAutoUpdateInterval,
  loadGlobalShortcut,
  loadPluginSettings,
  loadResetTimerDisplayMode,
  loadStartOnLogin,
  loadStatsShortcut,
  loadThemeMode,
  loadWidgetLayout,
  loadWidgetMetric,
  loadWidgetProviderIds,
  loadWidgetVisible,
  normalizePluginSettings,
  savePluginSettings,
  saveAutoUpdateInterval,
  saveGlobalShortcut,
  saveResetTimerDisplayMode,
  saveStartOnLogin,
  saveStatsShortcut,
  saveThemeMode,
  saveWidgetLayout,
  saveWidgetMetric,
  saveWidgetProviderIds,
  type AutoUpdateIntervalMinutes,
  type GlobalShortcut,
  type PluginSettings,
  type ResetTimerDisplayMode,
  type ThemeMode,
  type WidgetLayout,
  type WidgetMetric,
  type WidgetProviderIds,
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
  const [widgetLayout, setWidgetLayout] = useState<WidgetLayout>(DEFAULT_WIDGET_LAYOUT)
  const [widgetVisible, setWidgetVisible] = useState<boolean>(DEFAULT_WIDGET_VISIBLE)
  const [widgetProviderIds, setWidgetProviderIds] = useState<WidgetProviderIds>(DEFAULT_WIDGET_PROVIDER_IDS)
  const [widgetMetric, setWidgetMetric] = useState<WidgetMetric>(DEFAULT_WIDGET_METRIC)

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
          login, layout, visible, providers, metric,
        ] = await Promise.all([
          loadPluginSettings(),
          loadAutoUpdateInterval(),
          loadThemeMode(),
          loadResetTimerDisplayMode(),
          loadGlobalShortcut(),
          loadStatsShortcut(),
          loadStartOnLogin(),
          loadWidgetLayout(),
          loadWidgetVisible(),
          loadWidgetProviderIds(),
          loadWidgetMetric(),
        ])
        if (cancelled) return
        setPluginSettings(normalizePluginSettings(stored, meta))
        setAutoUpdateInterval(interval)
        setThemeMode(theme)
        setResetTimerDisplayMode(resetTimer)
        setGlobalShortcut(shortcut)
        setStatsShortcut(stats)
        setStartOnLogin(login)
        setWidgetLayout(layout)
        setWidgetVisible(visible)
        setWidgetProviderIds(providers)
        setWidgetMetric(metric)
      } catch (error) {
        console.error("Failed to bootstrap settings window:", error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const persistPluginSettings = useCallback((next: PluginSettings) => {
    setPluginSettings(next)
    void savePluginSettings(next).catch((error) => console.error("Failed to save plugins:", error))
    // Re-probe enabled providers so the popup/tray reflect the change promptly.
    if (isTauri()) {
      void invoke("start_probe_batch", { pluginIds: getEnabledPluginIds(next) }).catch((error) =>
        console.error("Failed to start probe batch:", error)
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
        void invoke("start_probe_batch", { pluginIds: getEnabledPluginIds(next) }).catch((error) =>
          console.error("Failed to start probe batch:", error)
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

  const handleWidgetLayoutChange = useCallback((value: WidgetLayout) => {
    setWidgetLayout(value)
    void saveWidgetLayout(value).catch((error) => console.error("Failed to save widget layout:", error))
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

  const handleWidgetMetricChange = useCallback((value: WidgetMetric) => {
    setWidgetMetric(value)
    void saveWidgetMetric(value).catch((error) => console.error("Failed to save widget metric:", error))
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

  const availableMetrics = useMemo(() => {
    if (!pluginSettings) return []
    return getAvailableWidgetMetrics(pluginsMeta, getEnabledPluginIds(pluginSettings))
  }, [pluginsMeta, pluginSettings])

  return {
    plugins,
    availableMetrics,
    ready: pluginSettings !== null,
    autoUpdateInterval,
    themeMode,
    resetTimerDisplayMode,
    globalShortcut,
    statsShortcut,
    startOnLogin,
    widgetLayout,
    widgetVisible,
    widgetProviderIds,
    widgetMetric,
    handleToggle,
    handleReorder,
    handleAutoUpdateIntervalChange,
    handleThemeModeChange,
    handleResetTimerDisplayModeChange,
    handleGlobalShortcutChange,
    handleStatsShortcutChange,
    handleStartOnLoginChange,
    handleWidgetLayoutChange,
    handleWidgetVisibleChange,
    handleWidgetProviderIdsChange,
    handleWidgetMetricChange,
  }
}
