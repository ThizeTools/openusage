import { invoke } from "@tauri-apps/api/core"
import { emit } from "@tauri-apps/api/event"

export const SETTINGS_OPEN_TAB_EVENT = "settings:open-tab"

/** Shows the Settings window on the given tab (the window is created at startup, so it is listening). */
export async function openSettingsTab(tab: string): Promise<void> {
  await invoke("open_settings_window")
  await emit(SETTINGS_OPEN_TAB_EVENT, { tab })
}
