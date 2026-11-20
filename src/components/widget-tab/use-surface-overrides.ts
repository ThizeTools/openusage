import { useCallback, useEffect, useState } from "react"
import {
  DEFAULT_SURFACE_OVERRIDES,
  loadSurfaceOverrides,
  saveSurfaceOverrides,
  type SurfaceOverrides,
  type WidgetSurface,
} from "@/lib/settings"

/** The stored overrides of one surface (Dock / Menu Bar): loaded on mount, saved on every change. */
export function useSurfaceOverrides(surface: WidgetSurface): [SurfaceOverrides, (value: SurfaceOverrides) => void] {
  const [overrides, setOverrides] = useState<SurfaceOverrides>(DEFAULT_SURFACE_OVERRIDES)

  useEffect(() => {
    let cancelled = false
    loadSurfaceOverrides(surface)
      .then((stored) => {
        if (!cancelled) setOverrides(stored)
      })
      .catch((error) => console.error(`Failed to load ${surface} overrides:`, error))
    return () => {
      cancelled = true
    }
  }, [surface])

  const update = useCallback(
    (value: SurfaceOverrides) => {
      setOverrides(value)
      saveSurfaceOverrides(surface, value).catch((error) => console.error(`Failed to save ${surface} overrides:`, error))
    },
    [surface]
  )

  return [overrides, update]
}
