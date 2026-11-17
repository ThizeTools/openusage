import { useEffect, useRef } from "react"
import { isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { ACCOUNTS_CHANGED_EVENT } from "@/lib/accounts"

/** Calls `onChanged` after any account is added, removed or renamed. */
export function useAccountsChanged(onChanged: () => void) {
  const handlerRef = useRef(onChanged)

  useEffect(() => {
    handlerRef.current = onChanged
  }, [onChanged])

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    let unlisten: (() => void) | undefined

    void listen(ACCOUNTS_CHANGED_EVENT, () => handlerRef.current())
      .then((fn) => {
        if (cancelled) fn()
        else unlisten = fn
      })
      .catch((error) => console.error("Failed to listen for account changes:", error))

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])
}
