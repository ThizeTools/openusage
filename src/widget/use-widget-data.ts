import { useCallback, useEffect, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { LazyStore } from "@tauri-apps/plugin-store"
import { useProbeState } from "@/hooks/app/use-probe-state"
import { useNowTicker } from "@/hooks/use-now-ticker"
import { useSettingsTheme } from "@/hooks/app/use-settings-theme"
import type { PluginMeta, PluginOutput } from "@/lib/plugin-types"
import {
  DEFAULT_THEME_MODE,
  DEFAULT_WIDGET_LAYOUT,
  getEnabledPluginIds,
  loadPluginSettings,
  loadThemeMode,
  loadWidgetLayout,
  loadWidgetMetric,
  loadWidgetProviderIds,
  loadWidgetZoom,
  saveWidgetLayout,
  saveWidgetZoom,
  normalizePluginSettings,
  type PluginSettings,
  type ThemeMode,
  type WidgetLayout,
  type WidgetMetric,
  type WidgetProviderIds,
} from "@/lib/settings"
import { buildWidgetRows, type WidgetRow } from "@/lib/widget-rows"
import { clampWidgetZoom, WIDGET_ZOOM_DEFAULT } from "@/lib/widget-zoom"

const SETTINGS_STORE_PATH = "settings.json"
const POSITION_SAVE_DEBOUNCE_MS = 400

type ProbeResultEvent = { batchId: string; output: PluginOutput }

export function useWidgetData(): {
  rows: WidgetRow[]
  layout: WidgetLayout
  zoom: number
  setWidgetZoom: (zoom: number) => void
  ready: boolean
  toggleLayout: () => void
} {
  const { pluginStates, setLoadingForPlugins, handleProbeResult } = useProbeState({})

  const [pluginsMeta, setPluginsMeta] = useState<PluginMeta[]>([])
  const [pluginSettings, setPluginSettings] = useState<PluginSettings | null>(null)
  const [layout, setLayout] = useState<WidgetLayout>(DEFAULT_WIDGET_LAYOUT)
  const [widgetProviderIds, setWidgetProviderIds] = useState<WidgetProviderIds>(null)
  const [widgetMetric, setWidgetMetric] = useState<WidgetMetric>(null)
  const [zoom, setZoom] = useState(WIDGET_ZOOM_DEFAULT)
  const [themeMode, setThemeMode] = useState<ThemeMode>(DEFAULT_THEME_MODE)
  const [ready, setReady] = useState(false)

  // Re-render on a timer so expected-pace fractions advance even without probes.
  const nowMs = useNowTicker({ intervalMs: 30_000 })

  useSettingsTheme(themeMode)

  // Listen for ALL probe results (the main window owns the scheduler and
  // broadcasts to every window); the widget is a passive consumer.
  useEffect(() => {
    if (!isTauri()) {
      setReady(true)
      return
    }
    let cancelled = false
    let unlisten: (() => void) | undefined

    void (async () => {
      const fn = await listen<ProbeResultEvent>("probe:result", (event) => {
        handleProbeResult(event.payload.output)
      })
      if (cancelled) {
        fn()
        return
      }
      unlisten = fn
    })()

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [handleProbeResult])

  // Initial load of settings + plugins, then kick off a single probe batch.
  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false

    void (async () => {
      try {
        const meta = await invoke<PluginMeta[]>("list_plugins")
        if (cancelled) return
        setPluginsMeta(meta)

        const [stored, widgetLayout, providers, metric, widgetZoom, theme] = await Promise.all([
          loadPluginSettings(),
          loadWidgetLayout(),
          loadWidgetProviderIds(),
          loadWidgetMetric(),
          loadWidgetZoom(),
          loadThemeMode(),
        ])
        if (cancelled) return

        const normalized = normalizePluginSettings(stored, meta)
        setPluginSettings(normalized)
        setLayout(widgetLayout)
        setWidgetProviderIds(providers)
        setWidgetMetric(metric)
        setZoom(widgetZoom)
        setThemeMode(theme)
        setReady(true)

        const enabledIds = getEnabledPluginIds(normalized)
        setLoadingForPlugins(enabledIds)
        await invoke("start_probe_batch", { pluginIds: enabledIds })
      } catch (error) {
        console.error("Failed to bootstrap widget:", error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [setLoadingForPlugins])

  // Stay in sync with settings changed from the main window (shared store).
  useEffect(() => {
    if (!isTauri()) return
    const store = new LazyStore(SETTINGS_STORE_PATH)
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
      await subscribe<WidgetLayout>("widgetLayout", setLayout)
      await subscribe<WidgetProviderIds>("widgetProviderIds", setWidgetProviderIds)
      await subscribe<WidgetMetric>("widgetMetric", (value) => setWidgetMetric(value ?? null))
      await subscribe<number>("widgetZoom", (value) => setZoom(clampWidgetZoom(value)))
      await subscribe<ThemeMode>("themeMode", setThemeMode)
      await subscribe<PluginSettings>("plugins", (value) => {
        setPluginsMeta((meta) => {
          setPluginSettings(normalizePluginSettings(value, meta))
          return meta
        })
      })
    })()

    return () => {
      cancelled = true
      for (const fn of unlisteners) fn()
    }
  }, [])

  // Persist widget position when the user drags it, then let Rust pull it
  // back on-screen if it ended up off every monitor.
  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    let unlisten: (() => void) | undefined
    let timer: number | null = null

    void (async () => {
      const widget = getCurrentWindow()
      const fn = await widget.onMoved(({ payload }) => {
        if (timer !== null) window.clearTimeout(timer)
        timer = window.setTimeout(() => {
          void invoke("save_widget_position", { x: payload.x, y: payload.y })
            .then(() => invoke("bring_widget_on_screen"))
            .catch((error) => {
              console.error("Failed to save widget position:", error)
            })
        }, POSITION_SAVE_DEBOUNCE_MS)
      })
      if (cancelled) {
        fn()
        return
      }
      unlisten = fn
    })()

    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
      unlisten?.()
    }
  }, [])

  const setWidgetZoom = useCallback((next: number) => {
    const clamped = clampWidgetZoom(next)
    setZoom(clamped)
    void saveWidgetZoom(clamped).catch((error) => {
      console.error("Failed to save widget zoom:", error)
    })
  }, [])

  const toggleLayout = useCallback(() => {
    setLayout((prev) => {
      const next: WidgetLayout = prev === "horizontal" ? "vertical" : "horizontal"
      // Persist so the main window's Settings stays in sync (via onKeyChange).
      void saveWidgetLayout(next).catch((error) => {
        console.error("Failed to save widget layout:", error)
      })
      return next
    })
  }, [])

  const rows = buildWidgetRows({
    pluginsMeta,
    pluginSettings,
    pluginStates,
    widgetProviderIds,
    widgetMetric,
    nowMs,
  })

  return { rows, layout, zoom, setWidgetZoom, ready, toggleLayout }
}
