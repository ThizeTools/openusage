import { useEffect, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { LazyStore } from "@tauri-apps/plugin-store"
import { useProbeState } from "@/hooks/app/use-probe-state"
import { useAccountsChanged } from "@/hooks/app/use-accounts-changed"
import { useNowTicker } from "@/hooks/use-now-ticker"
import type { PluginMeta, PluginOutput } from "@/lib/plugin-types"
import { loadAvailablePlugins, reloadPluginList } from "@/lib/provider-discovery"
import {
  DEFAULT_PLUGIN_SETTINGS,
  DEFAULT_WIDGET_PROVIDER_METRICS,
  loadPluginSettings,
  loadWidgetProviderIds,
  loadWidgetProviderMetrics,
  normalizePluginSettings,
  parseWidgetProviderMetrics,
  type PluginSettings,
  type WidgetProviderIds,
  type WidgetProviderMetrics,
} from "@/lib/settings"
import { buildWidgetRows, type WidgetRow } from "@/lib/widget-rows"

const SETTINGS_STORE_PATH = "settings.json"

type ProbeResultEvent = { batchId: string; output: PluginOutput }

/**
 * Provider rows for the taskbar widget. Hydrates from the shared probe cache,
 * stays live through `probe:result` events and syncs widget settings.
 */
export function useWidgetRows(): WidgetRow[] {
  const { pluginStates, handleProbeResult } = useProbeState({})

  const [pluginsMeta, setPluginsMeta] = useState<PluginMeta[]>([])
  const [pluginSettings, setPluginSettings] = useState<PluginSettings | null>(null)
  const [widgetProviderIds, setWidgetProviderIds] = useState<WidgetProviderIds>(null)
  const [widgetProviderMetrics, setWidgetProviderMetrics] =
    useState<WidgetProviderMetrics>(DEFAULT_WIDGET_PROVIDER_METRICS)

  // Re-render on a timer so expected-pace fractions advance even without probes.
  const nowMs = useNowTicker({ intervalMs: 30_000 })

  // Listen for ALL probe results (the main window owns the scheduler and
  // broadcasts to every window); this hook is a passive consumer.
  useEffect(() => {
    if (!isTauri()) return
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

  // Hydrate from the shared last-good cache, then keep current through probe events.
  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false

    void (async () => {
      try {
        const meta = await loadAvailablePlugins(() => !cancelled)
        if (cancelled) return
        setPluginsMeta(meta)

        // Provider metadata is enough to render. Optional store reads fall back
        // to defaults instead of blocking the rows.
        const defaultSettings = normalizePluginSettings(DEFAULT_PLUGIN_SETTINGS, meta)
        setPluginSettings(defaultSettings)

        try {
          const cachedOutputs = await invoke<PluginOutput[]>("get_cached_probe_outputs")
          if (!cancelled) {
            for (const output of cachedOutputs) handleProbeResult(output)
          }
        } catch (error) {
          console.error("Failed to hydrate widget provider cache:", error)
        }

        const [stored, providers, providerMetrics] = await Promise.all([
          loadPluginSettings().catch((error) => {
            console.error("Failed to load widget provider settings:", error)
            return DEFAULT_PLUGIN_SETTINGS
          }),
          loadWidgetProviderIds().catch((error) => {
            console.error("Failed to load widget providers:", error)
            return null
          }),
          loadWidgetProviderMetrics().catch((error) => {
            console.error("Failed to load widget provider metrics:", error)
            return DEFAULT_WIDGET_PROVIDER_METRICS
          }),
        ])
        if (cancelled) return

        setPluginSettings(normalizePluginSettings(stored, meta))
        setWidgetProviderIds(providers)
        setWidgetProviderMetrics(providerMetrics)
      } catch (error) {
        console.error("Failed to bootstrap widget rows:", error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [handleProbeResult])

  // Accounts added/removed/renamed: reload the plugin list. The main window probes new ids.
  useAccountsChanged(() => {
    void reloadPluginList()
      .then(({ meta, settings }) => {
        setPluginsMeta(meta)
        setPluginSettings(settings)
      })
      .catch((error) => console.error("Failed to reload widget providers after account change:", error))
  })

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
      await subscribe<WidgetProviderIds>("widgetProviderIds", setWidgetProviderIds)
      await subscribe<unknown>("widgetProviderMetrics", (value) =>
        setWidgetProviderMetrics(parseWidgetProviderMetrics(value))
      )
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

  return buildWidgetRows({
    pluginsMeta,
    pluginSettings,
    pluginStates,
    widgetProviderIds,
    widgetProviderMetrics,
    nowMs,
  })
}
