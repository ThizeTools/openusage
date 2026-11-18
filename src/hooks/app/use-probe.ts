import { useCallback } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { useProbeEvents } from "@/hooks/use-probe-events"
import { type PluginSettings } from "@/lib/settings"
import type { CachedPluginOutput } from "@/lib/plugin-types"
import { loadRefreshBackoffs } from "@/lib/refresh-backoff-store"
import { selectProvidersToProbe, type RefreshSource } from "@/lib/refresh-policy"
import { useProbeAutoUpdate } from "@/hooks/app/use-probe-auto-update"
import { useProbeRefreshActions } from "@/hooks/app/use-probe-refresh-actions"
import { useProbeState } from "@/hooks/app/use-probe-state"

type UseProbeArgs = {
  pluginSettings: PluginSettings | null
  onProbeResult?: () => void
}

export function useProbe({
  pluginSettings,
  onProbeResult,
}: UseProbeArgs) {
  const {
    pluginStates,
    pluginStatesRef,
    manualRefreshIdsRef,
    backoffsRef,
    setLoadingForPlugins,
    setErrorForPlugins,
    handleProbeResult,
    hydrateFromCache,
    restoreBackoffs,
  } = useProbeState({ onProbeResult, persistBackoffs: true })

  const handleBatchComplete = useCallback(() => {}, [])

  const { startBatch } = useProbeEvents({
    onResult: handleProbeResult,
    onBatchComplete: handleBatchComplete,
  })

  const { autoUpdateNextAt } = useProbeAutoUpdate({
    pluginSettings,
    pluginStatesRef,
    backoffsRef,
    setLoadingForPlugins,
    setErrorForPlugins,
    startBatch,
  })

  const { handleRetryPlugin, handleRefreshAll } = useProbeRefreshActions({
    pluginSettings,
    pluginStatesRef,
    manualRefreshIdsRef,
    backoffsRef,
    setLoadingForPlugins,
    setErrorForPlugins,
    startBatch,
  })

  // An automatic pass (launch, settings sync) probes only what the refresh policy allows: not
  // fresh, not backed off, not already running. Providers with no reading yet always qualify.
  const selectDueProviders = useCallback(
    (ids: string[]) => {
      const source: RefreshSource = {
        lastSuccessAt: (id) => pluginStatesRef.current[id]?.lastUpdatedAt,
        backoff: (id) => backoffsRef.current[id],
        inFlight: (id) => Boolean(pluginStatesRef.current[id]?.loading),
      }
      return selectProvidersToProbe(ids, Date.now(), false, source)
    },
    [backoffsRef, pluginStatesRef]
  )

  // Launch hydration: the persisted last-good readings (with their fetch time) and the backoffs
  // saved by the previous run, before the first automatic pass decides what to probe.
  const hydrateProbeState = useCallback(async () => {
    if (!isTauri()) return
    try {
      hydrateFromCache(await invoke<CachedPluginOutput[]>("get_cached_probe_outputs"))
    } catch (error) {
      console.error("Failed to hydrate probe cache:", error)
    }
    try {
      restoreBackoffs(await loadRefreshBackoffs())
    } catch (error) {
      console.error("Failed to restore refresh backoffs:", error)
    }
  }, [hydrateFromCache, restoreBackoffs])

  return {
    pluginStates,
    selectDueProviders,
    hydrateProbeState,
    setLoadingForPlugins,
    setErrorForPlugins,
    startBatch,
    autoUpdateNextAt,
    handleRetryPlugin,
    handleRefreshAll,
  }
}
