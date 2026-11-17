import { invoke } from "@tauri-apps/api/core"
import type { PluginMeta } from "@/lib/plugin-types"
import {
  loadPluginSettings,
  normalizePluginSettings,
  type PluginSettings,
} from "@/lib/settings"

const PLUGIN_LIST_TIMEOUT_MS = 2_000
const PLUGIN_LIST_MAX_ATTEMPTS = 2
const PLUGIN_LIST_RETRY_DELAY_MS = 150

export async function loadAvailablePlugins(isActive: () => boolean): Promise<PluginMeta[]> {
  let lastError: unknown

  for (let attempt = 0; attempt < PLUGIN_LIST_MAX_ATTEMPTS; attempt += 1) {
    if (!isActive()) throw new Error("Provider loading cancelled")
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, PLUGIN_LIST_RETRY_DELAY_MS))
      if (!isActive()) throw new Error("Provider loading cancelled")
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        invoke<PluginMeta[]>("list_plugins"),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("Timed out loading providers")),
            PLUGIN_LIST_TIMEOUT_MS
          )
        })
      ])
    } catch (error) {
      lastError = error
      if (!isActive()) throw new Error("Provider loading cancelled")
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to load providers")
}

/**
 * Re-reads the plugin list (sign-in accounts come and go) and normalizes the
 * stored plugin settings against it. Does not persist: the main window owns writes.
 */
export async function reloadPluginList(): Promise<{ meta: PluginMeta[]; settings: PluginSettings }> {
  const meta = await loadAvailablePlugins(() => true)
  const stored = await loadPluginSettings()
  return { meta, settings: normalizePluginSettings(stored, meta) }
}
