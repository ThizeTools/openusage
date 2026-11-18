import { useEffect } from "react"
import { isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { LazyStore } from "@tauri-apps/plugin-store"
import type { PluginMeta } from "@/lib/plugin-types"
import {
  getEnabledPluginIds,
  normalizePluginSettings,
  SETTINGS_PLUGINS_CHANGED_EVENT,
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
  setLoadingForPlugins: (ids: string[]) => void
  setErrorForPlugins: (ids: string[], error: string) => void
  startBatch: (pluginIds?: string[]) => Promise<string[] | undefined>
  /** The ids among `ids` an automatic pass should probe: not fresh, not backed off, not running. */
  selectDueProviders: (ids: string[]) => string[]
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
  setLoadingForPlugins,
  setErrorForPlugins,
  startBatch,
  selectDueProviders,
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

          // A provider enabled just now has no reading and is probed at once; the others keep a
          // fresh reading or wait out their backoff.
          const dueIds = selectDueProviders(getEnabledPluginIds(normalized))
          if (dueIds.length === 0) return
          setLoadingForPlugins(dueIds)
          void startBatch(dueIds).catch((error) => {
            console.error("Failed to refresh providers after settings change:", error)
            setErrorForPlugins(dueIds, "Failed to start probe")
          })
        }
      )
      if (cancelled) pluginsChangedUnlisten()
      else unlisteners.push(pluginsChangedUnlisten)
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
    setLoadingForPlugins,
    setErrorForPlugins,
    startBatch,
    selectDueProviders,
    scheduleTrayIconUpdate,
  ])
}
