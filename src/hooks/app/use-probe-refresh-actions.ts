import { useCallback } from "react"
import type { MutableRefObject } from "react"
import { getEnabledPluginIds, type PluginSettings } from "@/lib/settings"
import {
  selectProvidersToProbe,
  type RefreshBackoff,
  type RefreshSource,
} from "@/lib/refresh-policy"
import type { PluginState } from "@/hooks/app/types"

type UseProbeRefreshActionsArgs = {
  pluginSettings: PluginSettings | null
  pluginStatesRef: MutableRefObject<Record<string, PluginState>>
  manualRefreshIdsRef: MutableRefObject<Set<string>>
  backoffsRef: MutableRefObject<Record<string, RefreshBackoff>>
  setLoadingForPlugins: (ids: string[]) => void
  setErrorForPlugins: (ids: string[], error: string) => void
  startBatch: (pluginIds?: string[]) => Promise<string[] | undefined>
}

export function useProbeRefreshActions({
  pluginSettings,
  pluginStatesRef,
  manualRefreshIdsRef,
  backoffsRef,
  setLoadingForPlugins,
  setErrorForPlugins,
  startBatch,
}: UseProbeRefreshActionsArgs) {
  const startManualRefresh = useCallback(
    (ids: string[], errorMessage: string) => {
      for (const id of ids) {
        manualRefreshIdsRef.current.add(id)
      }

      setLoadingForPlugins(ids)
      startBatch(ids).catch((error) => {
        for (const id of ids) {
          manualRefreshIdsRef.current.delete(id)
        }
        console.error(errorMessage, error)
        setErrorForPlugins(ids, "Failed to start probe")
      })
    },
    [manualRefreshIdsRef, setLoadingForPlugins, setErrorForPlugins, startBatch]
  )

  // A manual refresh is forced: it skips the freshness check and any backoff the provider did
  // not ask for, but never interrupts a probe that is already running.
  const selectForced = useCallback(
    (ids: string[]) => {
      const source: RefreshSource = {
        lastSuccessAt: (id) => pluginStatesRef.current[id]?.lastUpdatedAt,
        backoff: (id) => backoffsRef.current[id],
        inFlight: (id) =>
          Boolean(pluginStatesRef.current[id]?.loading) ||
          manualRefreshIdsRef.current.has(id),
      }
      return selectProvidersToProbe(ids, Date.now(), true, source)
    },
    [backoffsRef, manualRefreshIdsRef, pluginStatesRef]
  )

  const handleRetryPlugin = useCallback(
    (id: string) => {
      if (selectForced([id]).length === 0) return
      startManualRefresh([id], "Failed to retry plugin:")
    },
    [selectForced, startManualRefresh]
  )

  const handleRefreshAll = useCallback(() => {
    if (!pluginSettings) return
    const eligibleIds = selectForced(getEnabledPluginIds(pluginSettings))
    if (eligibleIds.length === 0) return

    startManualRefresh(eligibleIds, "Failed to start refresh batch:")
  }, [pluginSettings, selectForced, startManualRefresh])

  return {
    handleRetryPlugin,
    handleRefreshAll,
  }
}
