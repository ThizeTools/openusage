import { useEffect, useRef } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { useWidgetRows } from "@/hooks/app/use-widget-rows"
import { getIconMask } from "@/lib/icon-mask"
import { buildTaskbarPayload, type TaskbarPayload } from "@/lib/taskbar-payload"

/** Pushes provider rows to the native taskbar widget whenever their content changes. */
export function useTaskbarWidgetSync(): void {
  const rows = useWidgetRows()
  const lastSentKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isTauri()) return
    const draft = buildTaskbarPayload(rows)
    const draftKey = JSON.stringify(draft)
    if (draftKey === lastSentKeyRef.current) return

    let cancelled = false
    void (async () => {
      const providers = await Promise.all(
        draft.providers.map(async ({ iconUrl, ...provider }) => ({
          ...provider,
          iconMask: await getIconMask(iconUrl),
        }))
      )
      if (cancelled) return

      const payload: TaskbarPayload = { providers, tooltip: draft.tooltip }
      try {
        await invoke("taskbar_widget_update", { payload })
        lastSentKeyRef.current = draftKey
      } catch (error) {
        console.error("Failed to update taskbar widget:", error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [rows])
}
