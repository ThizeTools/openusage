import { useEffect } from "react"
import { isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { LazyStore } from "@tauri-apps/plugin-store"
import type { PluginMeta } from "@/lib/plugin-types"
import {
  getEnabledPluginIds,
  normalizePluginSettings,
  SETTINGS_AUTO_UPDATE_INTERVAL_CHANGED_EVENT,
  SETTINGS_PLUGINS_CHANGED_EVENT,
  type AutoUpdateIntervalMinutes,
  type MenubarIconStyle,
  type PluginSettings,
  type ResetTimerDisplayMode,
  type ThemeMode,
} from "@/lib/settings"

type ScheduleTrayIconUpdate = (reason: "probe" | "settings" | "init", delayMs?: number) => void

type Args = {
  pluginsMeta: PluginMeta[]
  setPluginSettings: (value: PluginSettings) => void
  setMenubarIconStyle: (value: MenubarIconStyle) => void
  setThemeMode: (value: ThemeMode) => void
  setResetTimerDisplayMode: (value: ResetTimerDisplayMode) => void
  setAutoUpdateInterval: (value: AutoUpdateIntervalMinutes) => void
  setLoadingForPlugins: (ids: string[]) => void
  setErrorForPlugins: (ids: string[], error: string) => void
  startBatch: (pluginIds?: string[]) => Promise<string[] | undefined>
  scheduleTrayIconUpdate: ScheduleTrayIconUpdate
}

/**
 * Keeps the main (popup) window's preference + plugin stores in sync with
 * settings edited in the dedicated Settings window. Both share `settings.json`;
 * we react to its key changes so the tray icon and popup update live.
 */
export function useSettingsStoreSync({
  pluginsMeta,
  setPluginSettings,
  setMenubarIconStyle,
  setThemeMode,
  setResetTimerDisplayMode,
  setAutoUpdateInterval,
  setLoadingForPlugins,
  setErrorForPlugins,
  startBatch,
  scheduleTrayIconUpdate,
}: Args) {
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

      await subscribe<MenubarIconStyle>("menubarIconStyle", (value) => {
        setMenubarIconStyle(value)
        scheduleTrayIconUpdate("settings", 0)
      })
      await subscribe<ThemeMode>("themeMode", setThemeMode)
      await subscribe<ResetTimerDisplayMode>("resetTimerDisplayMode", setResetTimerDisplayMode)
      await subscribe<AutoUpdateIntervalMinutes>("autoUpdateInterval", setAutoUpdateInterval)
      await subscribe<PluginSettings>("plugins", (value) => {
        // Guard against normalizing against an empty meta list (e.g. a bootstrap
        // save firing before plugins loaded), which would wipe `order` and hide
        // every provider. Only sync once we know the real plugin set.
        if (pluginsMeta.length === 0) return
        setPluginSettings(normalizePluginSettings(value, pluginsMeta))
        scheduleTrayIconUpdate("settings", 0)
      })

      const pluginsChangedUnlisten = await listen<PluginSettings>(
        SETTINGS_PLUGINS_CHANGED_EVENT,
        (event) => {
          if (pluginsMeta.length === 0) return
          const normalized = normalizePluginSettings(event.payload, pluginsMeta)
          setPluginSettings(normalized)
          scheduleTrayIconUpdate("settings", 0)

          const enabledIds = getEnabledPluginIds(normalized)
          if (enabledIds.length === 0) return
          setLoadingForPlugins(enabledIds)
          void startBatch(enabledIds).catch((error) => {
            console.error("Failed to refresh providers after settings change:", error)
            setErrorForPlugins(enabledIds, "Failed to start probe")
          })
        }
      )
      if (cancelled) pluginsChangedUnlisten()
      else unlisteners.push(pluginsChangedUnlisten)

      const intervalChangedUnlisten = await listen<AutoUpdateIntervalMinutes>(
        SETTINGS_AUTO_UPDATE_INTERVAL_CHANGED_EVENT,
        (event) => setAutoUpdateInterval(event.payload)
      )
      if (cancelled) intervalChangedUnlisten()
      else unlisteners.push(intervalChangedUnlisten)
    })()

    return () => {
      cancelled = true
      for (const fn of unlisteners) fn()
    }
  }, [
    pluginsMeta,
    setPluginSettings,
    setMenubarIconStyle,
    setThemeMode,
    setResetTimerDisplayMode,
    setAutoUpdateInterval,
    setLoadingForPlugins,
    setErrorForPlugins,
    startBatch,
    scheduleTrayIconUpdate,
  ])
}
