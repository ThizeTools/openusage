import { useEffect } from "react"
import { isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

/**
 * Keeps the main window's `widgetVisible` preference in sync when the widget is
 * toggled elsewhere (tray "Show Widget" item). Rust emits `widget:visibility`
 * with the new boolean state.
 */
export function useWidgetVisibilitySync(setWidgetVisible: (value: boolean) => void) {
  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    let unlisten: (() => void) | undefined

    void (async () => {
      const fn = await listen<boolean>("widget:visibility", (event) => {
        setWidgetVisible(Boolean(event.payload))
      })
      if (cancelled) {
        fn()
        return
      }
      unlisten = fn
    })()

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [setWidgetVisible])
}
