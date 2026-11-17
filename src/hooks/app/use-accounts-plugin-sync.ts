import { useAccountsChanged } from "@/hooks/app/use-accounts-changed"
import { reloadPluginList } from "@/lib/provider-discovery"
import { getEnabledPluginIds } from "@/lib/settings"
import { useAppPluginStore } from "@/stores/app-plugin-store"

type Args = {
  startBatch: (pluginIds?: string[]) => Promise<string[] | undefined>
  setLoadingForPlugins: (ids: string[]) => void
  setErrorForPlugins: (ids: string[], error: string) => void
  scheduleTrayIconUpdate: (reason: "settings", delayMs?: number) => void
}

/**
 * Main window: when accounts change, reload the plugin list and probe the
 * enabled plugin ids that were not in the list before (new account instances).
 */
export function useAccountsPluginSync({
  startBatch,
  setLoadingForPlugins,
  setErrorForPlugins,
  scheduleTrayIconUpdate,
}: Args) {
  useAccountsChanged(() => {
    void (async () => {
      const previousIds = new Set(useAppPluginStore.getState().pluginsMeta.map((plugin) => plugin.id))
      const { meta, settings } = await reloadPluginList()

      const store = useAppPluginStore.getState()
      store.setPluginsMeta(meta)
      store.setPluginSettings(settings)
      scheduleTrayIconUpdate("settings", 0)

      const newlyEnabled = getEnabledPluginIds(settings).filter((id) => !previousIds.has(id))
      if (newlyEnabled.length === 0) return
      setLoadingForPlugins(newlyEnabled)
      try {
        await startBatch(newlyEnabled)
      } catch (error) {
        console.error("Failed to probe newly added accounts:", error)
        setErrorForPlugins(newlyEnabled, "Failed to start probe")
      }
    })().catch((error) => console.error("Failed to reload providers after account change:", error))
  })
}
