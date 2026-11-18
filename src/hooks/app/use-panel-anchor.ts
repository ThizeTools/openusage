import { useEffect, useState } from "react"
import { isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { isMacPlatform } from "@/lib/platform"

/** Side of the screen the panel hangs from: "top" under the macOS menu bar, "bottom" over a taskbar. */
export type PanelAnchor = "top" | "bottom"

export function defaultPanelAnchor(): PanelAnchor {
  return isMacPlatform() ? "top" : "bottom"
}

/** Follows the native "panel:anchor" event; starts from the platform default. */
export function usePanelAnchor(): PanelAnchor {
  const [anchor, setAnchor] = useState<PanelAnchor>(defaultPanelAnchor)

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    let unlisten: (() => void) | undefined
    void listen<string>("panel:anchor", (event) => {
      if (event.payload === "top" || event.payload === "bottom") setAnchor(event.payload)
    })
      .then((fn) => {
        if (cancelled) fn()
        else unlisten = fn
      })
      .catch((error) => console.error("Failed to listen for panel anchor:", error))
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  return anchor
}
