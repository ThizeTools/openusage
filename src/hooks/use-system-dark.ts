import { useEffect, useState } from "react"

const QUERY = "(prefers-color-scheme: dark)"

function supportsMatchMedia(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
}

/** Follows the system color scheme (the macOS menu bar follows it too). Dark when it cannot be read. */
export function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => (supportsMatchMedia() ? window.matchMedia(QUERY).matches : true))

  useEffect(() => {
    if (!supportsMatchMedia()) return
    const media = window.matchMedia(QUERY)
    const onChange = () => setDark(media.matches)
    onChange()
    media.addEventListener?.("change", onChange)
    return () => media.removeEventListener?.("change", onChange)
  }, [])

  return dark
}
