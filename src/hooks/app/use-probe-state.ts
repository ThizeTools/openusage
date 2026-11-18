import { useCallback, useEffect, useRef, useState } from "react"
import type { CachedPluginOutput, PluginFailure, PluginOutput } from "@/lib/plugin-types"
import type { PluginState } from "@/hooks/app/types"
import { saveRefreshBackoffs } from "@/lib/refresh-backoff-store"
import {
  activeBackoffs,
  backoffAfter,
  rateLimitNotice,
  type RefreshBackoff,
  type RefreshBackoffs,
} from "@/lib/refresh-policy"

type UseProbeStateArgs = {
  onProbeResult?: () => void
  /** Save the backoffs to the settings store whenever they change. Only the window that probes does. */
  persistBackoffs?: boolean
}

export function useProbeState({ onProbeResult, persistBackoffs = false }: UseProbeStateArgs) {
  const [pluginStates, setPluginStates] = useState<Record<string, PluginState>>({})

  const pluginStatesRef = useRef(pluginStates)
  useEffect(() => {
    pluginStatesRef.current = pluginStates
  }, [pluginStates])

  const manualRefreshIdsRef = useRef<Set<string>>(new Set())

  // Per-provider backoff left by the last failed probe; success clears it. Saved to the settings
  // store (when `persistBackoffs`) so a rate limit's retry time survives a relaunch.
  const backoffsRef = useRef<Record<string, RefreshBackoff>>({})

  const persistBackoffsNow = useCallback(() => {
    if (!persistBackoffs) return
    void saveRefreshBackoffs(backoffsRef.current).catch((error) => {
      console.error("Failed to save refresh backoffs:", error)
    })
  }, [persistBackoffs])

  const updatePluginStates = useCallback(
    (
      updater: (
        previousStates: Record<string, PluginState>
      ) => Record<string, PluginState>
    ) => {
      const nextStates = updater(pluginStatesRef.current)
      pluginStatesRef.current = nextStates
      setPluginStates(nextStates)
    },
    []
  )

  const getErrorMessage = useCallback((output: PluginOutput) => {
    if (output.lines.length !== 1) return null
    const line = output.lines[0]
    if (line.type === "badge" && line.label === "Error") {
      return line.text || "Couldn't update data. Try again?"
    }
    return null
  }, [])

  const setLoadingForPlugins = useCallback((ids: string[]) => {
    updatePluginStates((prev) => {
      const next = { ...prev }
      for (const id of ids) {
        const existing = prev[id]
        next[id] = {
          data: existing?.data ?? null,
          loading: true,
          error: null,
          notice: null,
          lastManualRefreshAt: existing?.lastManualRefreshAt ?? null,
          lastUpdatedAt: existing?.lastUpdatedAt ?? null,
        }
      }
      return next
    })
  }, [updatePluginStates])

  const setErrorForPlugins = useCallback((ids: string[], error: string) => {
    updatePluginStates((prev) => {
      const next = { ...prev }
      for (const id of ids) {
        const existing = prev[id]
        next[id] = {
          data: existing?.data ?? null,
          loading: false,
          error,
          notice: null,
          lastManualRefreshAt: existing?.lastManualRefreshAt ?? null,
          lastUpdatedAt: existing?.lastUpdatedAt ?? null,
        }
      }
      return next
    })
  }, [updatePluginStates])

  const handleProbeResult = useCallback(
    (output: PluginOutput) => {
      const errorMessage = getErrorMessage(output)
      const isManual = manualRefreshIdsRef.current.has(output.providerId)
      if (isManual) {
        manualRefreshIdsRef.current.delete(output.providerId)
      }

      const now = Date.now()
      // An error badge without a structured signal is a plain refusal.
      const failure: PluginFailure | null =
        output.failure ?? (errorMessage ? { kind: "refused" } : null)
      let notice: string | null = null
      if (failure) {
        const backoff = backoffAfter(failure, backoffsRef.current[output.providerId], now)
        if (failure.kind === "rateLimited") {
          notice = rateLimitNotice(output.displayName, backoff.retryAt)
        }
        const message = notice ?? errorMessage
        backoffsRef.current[output.providerId] = message ? { ...backoff, message } : backoff
        persistBackoffsNow()
      } else if (output.providerId in backoffsRef.current) {
        delete backoffsRef.current[output.providerId]
        persistBackoffsNow()
      }

      updatePluginStates((prev) => {
        const existing = prev[output.providerId]
        return {
          ...prev,
          [output.providerId]: {
            // A failed probe keeps the last good reading. With none, a returned badge (a plugin's
            // own rate-limit status) is still better than an empty card.
            data: failure ? (existing?.data ?? (errorMessage ? null : output)) : output,
            loading: false,
            // The rate-limit notice replaces the error text.
            error: notice ? null : errorMessage,
            notice,
            lastManualRefreshAt: !failure && isManual
              ? now
              : existing?.lastManualRefreshAt ?? null,
            lastUpdatedAt: failure ? (existing?.lastUpdatedAt ?? null) : now,
          },
        }
      })

      onProbeResult?.()
    },
    [getErrorMessage, onProbeResult, persistBackoffsNow, updatePluginStates]
  )

  // Shows the persisted last-good readings right away, each with the time it was fetched, so the
  // refresh policy can tell they are fresh. A live result that already arrived is kept.
  const hydrateFromCache = useCallback(
    (outputs: CachedPluginOutput[]) => {
      if (outputs.length === 0) return
      updatePluginStates((prev) => {
        const next = { ...prev }
        for (const cached of outputs) {
          const { fetchedAt, ...output } = cached
          const existing = prev[output.providerId]
          const lastUpdatedAt =
            typeof fetchedAt === "number" && Number.isFinite(fetchedAt) ? fetchedAt : null
          if (existing?.data && (existing.lastUpdatedAt ?? 0) >= (lastUpdatedAt ?? 0)) continue
          next[output.providerId] = {
            data: output,
            loading: existing?.loading ?? false,
            error: existing?.error ?? null,
            notice: existing?.notice ?? null,
            lastManualRefreshAt: existing?.lastManualRefreshAt ?? null,
            lastUpdatedAt,
          }
        }
        return next
      })
      onProbeResult?.()
    },
    [onProbeResult, updatePluginStates]
  )

  // Loads backoffs saved by an earlier run (expired ones are dropped) and shows the message each
  // left, so a provider that was rate limited before the relaunch still explains why it waits.
  const restoreBackoffs = useCallback(
    (stored: RefreshBackoffs) => {
      const restored = activeBackoffs(stored, Date.now())
      const ids = Object.keys(restored)
      if (ids.length === 0) return
      backoffsRef.current = { ...backoffsRef.current, ...restored }
      updatePluginStates((prev) => {
        const next = { ...prev }
        for (const id of ids) {
          const { message, providerAsked } = restored[id]
          if (!message) continue
          const existing = prev[id]
          next[id] = {
            data: existing?.data ?? null,
            loading: existing?.loading ?? false,
            error: providerAsked ? null : message,
            notice: providerAsked ? message : null,
            lastManualRefreshAt: existing?.lastManualRefreshAt ?? null,
            lastUpdatedAt: existing?.lastUpdatedAt ?? null,
          }
        }
        return next
      })
    },
    [updatePluginStates]
  )

  return {
    pluginStates,
    pluginStatesRef,
    manualRefreshIdsRef,
    backoffsRef,
    setLoadingForPlugins,
    setErrorForPlugins,
    handleProbeResult,
    hydrateFromCache,
    restoreBackoffs,
  }
}
