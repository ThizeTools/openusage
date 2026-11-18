import { LazyStore } from "@tauri-apps/plugin-store"
import { activeBackoffs, parseStoredBackoffs, type RefreshBackoffs } from "@/lib/refresh-policy"

const SETTINGS_STORE_PATH = "settings.json"
export const REFRESH_BACKOFFS_KEY = "refreshBackoffs"

const store = new LazyStore(SETTINGS_STORE_PATH)

/** Backoffs saved by an earlier run that are still in force. */
export async function loadRefreshBackoffs(now: number = Date.now()): Promise<RefreshBackoffs> {
  const stored = await store.get<unknown>(REFRESH_BACKOFFS_KEY)
  return parseStoredBackoffs(stored, now)
}

/** Saves the backoffs in force, so a rate limit's retry time survives a restart. */
export async function saveRefreshBackoffs(
  backoffs: RefreshBackoffs,
  now: number = Date.now()
): Promise<void> {
  await store.set(REFRESH_BACKOFFS_KEY, activeBackoffs(backoffs, now))
  await store.save()
}
