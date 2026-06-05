import { useCallback, useEffect, useRef } from "react"
import { TrayIcon } from "@tauri-apps/api/tray"
import type { PluginMeta } from "@/lib/plugin-types"
import type { PluginSettings } from "@/lib/settings"
import { getEnabledPluginIds } from "@/lib/settings"
import { getTrayPrimaryBars } from "@/lib/tray-primary-progress"
import { formatTrayTooltip } from "@/lib/tray-tooltip"
import type { PluginState } from "@/hooks/app/types"

type TrayUpdateReason = "probe" | "settings" | "init"

type UseTrayIconArgs = {
  pluginsMeta: PluginMeta[]
  pluginSettings: PluginSettings | null
  pluginStates: Record<string, PluginState>
}

const TOOLTIP_TOTAL_USAGE_LABELS = ["Total usage", "Session", "Weekly"]

export function useTrayIcon({
  pluginsMeta,
  pluginSettings,
  pluginStates,
}: UseTrayIconArgs) {
  const trayRef = useRef<TrayIcon | null>(null)
  const trayUpdateTimerRef = useRef<number | null>(null)
  const trayUpdatePendingRef = useRef(false)
  const trayUpdateQueuedRef = useRef(false)
  const trayReadyRef = useRef(false)

  const pluginsMetaRef = useRef(pluginsMeta)
  const pluginSettingsRef = useRef(pluginSettings)
  const pluginStatesRef = useRef(pluginStates)

  useEffect(() => {
    pluginsMetaRef.current = pluginsMeta
  }, [pluginsMeta])

  useEffect(() => {
    pluginSettingsRef.current = pluginSettings
  }, [pluginSettings])

  useEffect(() => {
    pluginStatesRef.current = pluginStates
  }, [pluginStates])

  const scheduleTrayIconUpdate = useCallback((
    _reason: TrayUpdateReason,
    delayMs = 0,
  ) => {
    if (trayUpdateTimerRef.current !== null) {
      window.clearTimeout(trayUpdateTimerRef.current)
      trayUpdateTimerRef.current = null
    }

    trayUpdateTimerRef.current = window.setTimeout(() => {
      trayUpdateTimerRef.current = null
      if (trayUpdatePendingRef.current) {
        trayUpdateQueuedRef.current = true
        return
      }
      trayUpdatePendingRef.current = true

      const finalizeUpdate = () => {
        trayUpdatePendingRef.current = false
        if (!trayUpdateQueuedRef.current) return
        trayUpdateQueuedRef.current = false
        scheduleTrayIconUpdate("probe", 0)
      }

      const tray = trayRef.current
      const maybeSetTitle = tray
        ? (tray as TrayIcon & { setTitle?: (value: string) => Promise<void> }).setTitle
        : undefined
      const setTitleFn =
        tray && typeof maybeSetTitle === "function" ? (value: string) => maybeSetTitle.call(tray, value) : null
      const setTrayTitle = (title: string) => {
        if (setTitleFn) {
          return setTitleFn(title)
        }
        return Promise.resolve()
      }

      const maybeSetTooltip = tray
        ? (tray as TrayIcon & { setTooltip?: (value: string) => Promise<void> }).setTooltip
        : undefined
      const setTooltipFn =
        tray && typeof maybeSetTooltip === "function" ? (value: string) => maybeSetTooltip.call(tray, value) : null
      const setTrayTooltip = (tooltip: string) => {
        if (setTooltipFn) {
          return setTooltipFn(tooltip)
        }
        return Promise.resolve()
      }

      // Icon itself is static (set once in Rust to the app/taskbar icon);
      // only title and tooltip are updated from the frontend.
      const updateStaticTray = (tooltip: string) => {
        Promise.all([setTrayTitle(""), setTrayTooltip(tooltip)])
          .catch((e) => {
            console.error("Failed to update tray icon:", e)
          })
          .finally(finalizeUpdate)
      }

      const currentSettings = pluginSettingsRef.current
      if (!currentSettings) {
        updateStaticTray("OpenUsage")
        return
      }

      const enabledPluginIds = getEnabledPluginIds(currentSettings)
      if (enabledPluginIds.length === 0) {
        updateStaticTray("OpenUsage")
        return
      }

      const tooltipBars = getTrayPrimaryBars({
        pluginsMeta: pluginsMetaRef.current,
        pluginSettings: currentSettings,
        pluginStates: pluginStatesRef.current,
        maxBars: 20,
        preferredLabels: TOOLTIP_TOTAL_USAGE_LABELS,
        includeAllMatches: true,
      })
      const tooltip = formatTrayTooltip(tooltipBars, pluginsMetaRef.current)
      updateStaticTray(tooltip)
    }, delayMs)
  }, [])

  const trayInitializedRef = useRef(false)
  useEffect(() => {
    if (trayInitializedRef.current) return
    let cancelled = false

    ;(async () => {
      try {
        const tray = await TrayIcon.getById("tray")
        if (cancelled) return
        trayRef.current = tray
        trayInitializedRef.current = true
        trayReadyRef.current = true
        scheduleTrayIconUpdate("init", 0)
      } catch (e) {
        console.error("Failed to load tray icon handle:", e)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [scheduleTrayIconUpdate])

  useEffect(() => {
    if (!trayReadyRef.current) return
    scheduleTrayIconUpdate("init", 0)
  }, [pluginsMeta, pluginSettings, pluginStates, scheduleTrayIconUpdate])

  useEffect(() => {
    return () => {
      if (trayUpdateTimerRef.current !== null) {
        window.clearTimeout(trayUpdateTimerRef.current)
        trayUpdateTimerRef.current = null
      }
      trayUpdatePendingRef.current = false
      trayUpdateQueuedRef.current = false
    }
  }, [])

  return {
    scheduleTrayIconUpdate,
  }
}
