import { useEffect, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { useSystemDark } from "@/hooks/use-system-dark"
import { usesRenderedWidget } from "@/lib/platform"

const APPEARANCE_EVENT = "menubar:appearance"

function parseAppearance(value: unknown): boolean | null {
  if (value === "dark") return true
  if (value === "light") return false
  return null
}

/**
 * Whether the real menu bar / taskbar is dark. On recent macOS that depends on the wallpaper, and on Windows the
 * taskbar theme is separate from the app theme, so on macOS and Windows in Tauri the native side reports it
 * (`menu_bar_appearance` + the `menubar:appearance` event). Everywhere else, or while it is unknown, it follows
 * the system scheme.
 */
export function useMenuBarDark(): boolean {
  const systemDark = useSystemDark()
  const [native, setNative] = useState<boolean | null>(null)

  useEffect(() => {
    if (!isTauri() || !usesRenderedWidget()) return
    let cancelled = false
    let gotEvent = false
    let unlisten: (() => void) | undefined

    listen<unknown>(APPEARANCE_EVENT, (event) => {
      const parsed = parseAppearance(event.payload)
      if (parsed === null) return
      gotEvent = true
      setNative(parsed)
    })
      .then((fn) => {
        if (cancelled) fn()
        else unlisten = fn
      })
      .catch((error) => console.error("Failed to listen for menu bar appearance:", error))

    invoke<unknown>("menu_bar_appearance")
      .then((value) => {
        // An event that arrived meanwhile is newer than this answer.
        if (cancelled || gotEvent) return
        setNative(parseAppearance(value))
      })
      .catch((error) => console.error("Failed to read menu bar appearance:", error))

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  return native ?? systemDark
}
