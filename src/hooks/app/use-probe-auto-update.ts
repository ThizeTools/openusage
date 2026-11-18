import { useEffect, useRef, useState } from "react"
import type { MutableRefObject } from "react"
import { getEnabledPluginIds, type PluginSettings } from "@/lib/settings"
import {
  REFRESH_INTERVAL_MS,
  selectProvidersToProbe,
  type RefreshBackoff,
} from "@/lib/refresh-policy"
import type { PluginState } from "@/hooks/app/types"

/** How often a running pass is checked for completion, and how long it may take before the wait is dropped. */
const SETTLE_POLL_MS = 250
const SETTLE_TIMEOUT_MS = 60_000

type UseProbeAutoUpdateArgs = {
  pluginSettings: PluginSettings | null
  pluginStatesRef: MutableRefObject<Record<string, PluginState>>
  backoffsRef: MutableRefObject<Record<string, RefreshBackoff>>
  setLoadingForPlugins: (ids: string[]) => void
  setErrorForPlugins: (ids: string[], error: string) => void
  startBatch: (pluginIds?: string[]) => Promise<string[] | undefined>
}

/**
 * Automatic refresh passes on the fixed 5-minute schedule, starting at launch. Each pass probes
 * only the providers the refresh policy allows: not fresh, not backed off, not already running.
 * The next pass is scheduled 5 minutes after this one finishes, like the native app, so a
 * 5-minute backoff set by a failure in this pass has run out by then.
 */
export function useProbeAutoUpdate({
  pluginSettings,
  pluginStatesRef,
  backoffsRef,
  setLoadingForPlugins,
  setErrorForPlugins,
  startBatch,
}: UseProbeAutoUpdateArgs) {
  const [autoUpdateNextAt, setAutoUpdateNextAt] = useState<number | null>(null)

  // The pass reads the latest settings without restarting the schedule on every settings change.
  const pluginSettingsRef = useRef(pluginSettings)
  useEffect(() => {
    pluginSettingsRef.current = pluginSettings
  }, [pluginSettings])

  const hasEnabledPlugins = pluginSettings
    ? getEnabledPluginIds(pluginSettings).length > 0
    : false

  useEffect(() => {
    if (!hasEnabledPlugins) {
      setAutoUpdateNextAt(null)
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const isLoading = (id: string) => Boolean(pluginStatesRef.current[id]?.loading)

    const waitForSettle = async (ids: string[]) => {
      const giveUpAt = Date.now() + SETTLE_TIMEOUT_MS
      while (!cancelled && Date.now() < giveUpAt && ids.some(isLoading)) {
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, SETTLE_POLL_MS)
        })
      }
    }

    const scheduleNext = () => {
      setAutoUpdateNextAt(Date.now() + REFRESH_INTERVAL_MS)
      timer = setTimeout(runPass, REFRESH_INTERVAL_MS)
    }

    const runPass = async () => {
      const settings = pluginSettingsRef.current
      const enabledIds = settings ? getEnabledPluginIds(settings) : []
      const due = selectProvidersToProbe(enabledIds, Date.now(), false, {
        lastSuccessAt: (id) => pluginStatesRef.current[id]?.lastUpdatedAt,
        backoff: (id) => backoffsRef.current[id],
        inFlight: isLoading,
      })
      if (due.length > 0) {
        setLoadingForPlugins(due)
        try {
          await startBatch(due)
        } catch (error) {
          console.error("Failed to start auto-update batch:", error)
          setErrorForPlugins(due, "Failed to start probe")
        }
        // Shown while the pass runs; corrected once it finishes.
        setAutoUpdateNextAt(Date.now() + REFRESH_INTERVAL_MS)
        await waitForSettle(due)
      }
      if (!cancelled) scheduleNext()
    }

    setAutoUpdateNextAt(Date.now() + REFRESH_INTERVAL_MS)
    timer = setTimeout(runPass, REFRESH_INTERVAL_MS)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [
    hasEnabledPlugins,
    pluginStatesRef,
    backoffsRef,
    setLoadingForPlugins,
    setErrorForPlugins,
    startBatch,
  ])

  return { autoUpdateNextAt }
}
