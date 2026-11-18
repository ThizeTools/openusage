import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
  DEFAULT_MENU_BAR_WIDGET_BACKDROP,
  DEFAULT_MENU_BAR_WIDGET_COLORS,
  DEFAULT_MENU_BAR_WIDGET_STYLE,
  DEFAULT_MENU_BAR_WIDGET_TEXT_COLORS,
  DEFAULT_MENU_BAR_WIDGET_TONE_MODES,
  DEFAULT_RESET_TIMER_DISPLAY_MODE,
  DEFAULT_START_ON_LOGIN,
  DEFAULT_STATS_SHORTCUT,
  DEFAULT_THEME_MODE,
  DEFAULT_WIDGET_PROVIDER_IDS,
  DEFAULT_WIDGET_PROVIDER_METRICS,
  DEFAULT_WIDGET_VISIBLE,
  loadMenuBarWidgetBackdrop,
  loadMenuBarWidgetColors,
  loadMenuBarWidgetStyle,
  loadMenuBarWidgetTextColors,
  loadMenuBarWidgetToneModes,
  loadPluginSettings,
  loadResetTimerDisplayMode,
  loadStartOnLogin,
  loadStatsShortcut,
  loadThemeMode,
  loadWidgetProviderIds,
  loadWidgetProviderMetrics,
  loadWidgetVisible,
  normalizePluginSettings,
  parseMenuBarWidgetBackdrop,
  parseMenuBarWidgetColors,
  parseMenuBarWidgetStyle,
  parseMenuBarWidgetTextColors,
  parseMenuBarWidgetToneModes,
  parseWidgetProviderMetrics,
  savePluginSettings,
  saveMenuBarWidgetBackdrop,
  saveMenuBarWidgetColors,
  saveMenuBarWidgetStyle,
  saveMenuBarWidgetTextColors,
  saveMenuBarWidgetToneModes,
  saveResetTimerDisplayMode,
  saveStartOnLogin,
  saveStatsShortcut,
  saveThemeMode,
  saveWidgetProviderIds,
  saveWidgetProviderMetrics,
  SETTINGS_PLUGINS_CHANGED_EVENT,
  type GlobalShortcut,
  type PluginSettings,
  type ResetTimerDisplayMode,
  type ThemeMode,
  type MenuBarWidgetBackdrop,
  type MenuBarWidgetColors,
  type MenuBarWidgetStyle,
  type MenuBarWidgetTextColors,
  type MenuBarWidgetToneModes,
  type WidgetProviderIds,
  type WidgetProviderMetrics,
} from "@/lib/settings"

/** Delay before a changed background (slider drags) is written to the store. */
const BACKDROP_SAVE_DEBOUNCE_MS = 150

/**
 * Self-contained settings state for the dedicated Settings window. It reads from
 * and writes to the shared settings store; the main window observes the same
 * store keys to keep the tray and probes in sync.
 */
export function useSettingsWindow() {
  const [pluginsMeta, setPluginsMeta] = useState<PluginMeta[]>([])
  const [pluginSettings, setPluginSettings] = useState<PluginSettings | null>(null)
  const [themeMode, setThemeMode] = useState<ThemeMode>(DEFAULT_THEME_MODE)
  const [resetTimerDisplayMode, setResetTimerDisplayMode] = useState<ResetTimerDisplayMode>(DEFAULT_RESET_TIMER_DISPLAY_MODE)
  const [statsShortcut, setStatsShortcut] = useState<GlobalShortcut>(DEFAULT_STATS_SHORTCUT)
  const [startOnLogin, setStartOnLogin] = useState<boolean>(DEFAULT_START_ON_LOGIN)
  const [widgetVisible, setWidgetVisible] = useState<boolean>(DEFAULT_WIDGET_VISIBLE)
  const [widgetProviderIds, setWidgetProviderIds] = useState<WidgetProviderIds>(DEFAULT_WIDGET_PROVIDER_IDS)
  const [widgetProviderMetrics, setWidgetProviderMetrics] =
    useState<WidgetProviderMetrics>(DEFAULT_WIDGET_PROVIDER_METRICS)
  const [menuBarWidgetBackdrop, setMenuBarWidgetBackdrop] =
    useState<MenuBarWidgetBackdrop>(DEFAULT_MENU_BAR_WIDGET_BACKDROP)
  const [menuBarWidgetStyle, setMenuBarWidgetStyle] =
    useState<MenuBarWidgetStyle>(DEFAULT_MENU_BAR_WIDGET_STYLE)
  const [menuBarWidgetColors, setMenuBarWidgetColors] =
    useState<MenuBarWidgetColors>(DEFAULT_MENU_BAR_WIDGET_COLORS)
  const [menuBarWidgetTextColors, setMenuBarWidgetTextColors] =
    useState<MenuBarWidgetTextColors>(DEFAULT_MENU_BAR_WIDGET_TEXT_COLORS)
  const [menuBarWidgetToneModes, setMenuBarWidgetToneModes] =
    useState<MenuBarWidgetToneModes>(DEFAULT_MENU_BAR_WIDGET_TONE_MODES)

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    void (async () => {
      try {
        const meta = await invoke<PluginMeta[]>("list_plugins")
        if (cancelled) return
        setPluginsMeta(meta)
        const [
          stored, theme, resetTimer, stats,
          login, visible, providers, providerMetrics, backdrop, widgetStyle, widgetColors, widgetTextColors,
          widgetToneModes,
        ] = await Promise.all([
          loadPluginSettings(),
          loadThemeMode(),
          loadResetTimerDisplayMode(),
          loadStatsShortcut(),
          loadStartOnLogin(),
          loadWidgetVisible(),
          loadWidgetProviderIds(),
          loadWidgetProviderMetrics(),
          loadMenuBarWidgetBackdrop(),
          loadMenuBarWidgetStyle(),
          loadMenuBarWidgetColors(),
          loadMenuBarWidgetTextColors(),
          loadMenuBarWidgetToneModes(),
        ])
        if (cancelled) return
        setPluginSettings(normalizePluginSettings(stored, meta))
        setThemeMode(theme)
        setResetTimerDisplayMode(resetTimer)
        setStatsShortcut(stats)
        setStartOnLogin(login)
        setWidgetVisible(visible)
        setWidgetProviderIds(providers)
        setWidgetProviderMetrics(providerMetrics)
        setMenuBarWidgetBackdrop(backdrop)
        setMenuBarWidgetStyle(widgetStyle)
        setMenuBarWidgetColors(widgetColors)
        setMenuBarWidgetTextColors(widgetTextColors)
        setMenuBarWidgetToneModes(widgetToneModes)
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
      await subscribe<unknown>("menuBarWidgetBackdrop", (value) => {
        const parsed = parseMenuBarWidgetBackdrop(value)
        if (parsed) setMenuBarWidgetBackdrop(parsed)
      })
      await subscribe<unknown>("menuBarWidgetStyle", (value) => {
        const parsed = parseMenuBarWidgetStyle(value)
        if (parsed) setMenuBarWidgetStyle(parsed)
      })
      await subscribe<unknown>("menuBarWidgetColors", (value) => {
        setMenuBarWidgetColors(parseMenuBarWidgetColors(value))
      })
      await subscribe<unknown>("menuBarWidgetTextColors", (value) => {
        setMenuBarWidgetTextColors(parseMenuBarWidgetTextColors(value))
      })
      await subscribe<unknown>("menuBarWidgetToneModes", (value) => {
        setMenuBarWidgetToneModes(parseMenuBarWidgetToneModes(value))
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

  const handleThemeModeChange = useCallback((value: ThemeMode) => {
    setThemeMode(value)
    void saveThemeMode(value).catch((error) => console.error("Failed to save theme:", error))
  }, [])

  const handleResetTimerDisplayModeChange = useCallback((value: ResetTimerDisplayMode) => {
    setResetTimerDisplayMode(value)
    void saveResetTimerDisplayMode(value).catch((error) => console.error("Failed to save reset timer:", error))
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

  // Sliders fire on every step: the UI state is immediate, the store write waits for the last change.
  const backdropSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingBackdropRef = useRef<MenuBarWidgetBackdrop | null>(null)
  const flushBackdropSave = useCallback(() => {
    if (backdropSaveTimerRef.current !== null) {
      clearTimeout(backdropSaveTimerRef.current)
      backdropSaveTimerRef.current = null
    }
    const pending = pendingBackdropRef.current
    pendingBackdropRef.current = null
    if (pending) {
      void saveMenuBarWidgetBackdrop(pending).catch((error) =>
        console.error("Failed to save menu bar widget background:", error)
      )
    }
  }, [])
  useEffect(() => flushBackdropSave, [flushBackdropSave])

  const handleMenuBarWidgetBackdropChange = useCallback(
    (value: MenuBarWidgetBackdrop) => {
      setMenuBarWidgetBackdrop(value)
      pendingBackdropRef.current = value
      if (backdropSaveTimerRef.current !== null) clearTimeout(backdropSaveTimerRef.current)
      backdropSaveTimerRef.current = setTimeout(flushBackdropSave, BACKDROP_SAVE_DEBOUNCE_MS)
    },
    [flushBackdropSave]
  )

  const handleMenuBarWidgetStyleChange = useCallback((value: MenuBarWidgetStyle) => {
    setMenuBarWidgetStyle(value)
    void saveMenuBarWidgetStyle(value).catch((error) =>
      console.error("Failed to save menu bar widget style:", error)
    )
  }, [])

  const handleMenuBarWidgetColorsChange = useCallback((value: MenuBarWidgetColors) => {
    setMenuBarWidgetColors(value)
    void saveMenuBarWidgetColors(value).catch((error) =>
      console.error("Failed to save menu bar widget colors:", error)
    )
  }, [])

  const handleMenuBarWidgetTextColorsChange = useCallback((value: MenuBarWidgetTextColors) => {
    setMenuBarWidgetTextColors(value)
    void saveMenuBarWidgetTextColors(value).catch((error) =>
      console.error("Failed to save menu bar widget text colors:", error)
    )
  }, [])

  const handleMenuBarWidgetToneModesChange = useCallback((value: MenuBarWidgetToneModes) => {
    setMenuBarWidgetToneModes(value)
    void saveMenuBarWidgetToneModes(value).catch((error) =>
      console.error("Failed to save menu bar widget tone modes:", error)
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
    themeMode,
    resetTimerDisplayMode,
    statsShortcut,
    startOnLogin,
    widgetVisible,
    widgetProviderIds,
    widgetProviderMetrics,
    menuBarWidgetBackdrop,
    menuBarWidgetStyle,
    menuBarWidgetColors,
    menuBarWidgetTextColors,
    menuBarWidgetToneModes,
    handleToggle,
    handleReorder,
    handleThemeModeChange,
    handleResetTimerDisplayModeChange,
    handleStatsShortcutChange,
    handleStartOnLoginChange,
    handleWidgetVisibleChange,
    handleWidgetProviderIdsChange,
    handleWidgetProviderMetricsChange,
    handleMenuBarWidgetBackdropChange,
    handleMenuBarWidgetStyleChange,
    handleMenuBarWidgetColorsChange,
    handleMenuBarWidgetTextColorsChange,
    handleMenuBarWidgetToneModesChange,
  }
}
