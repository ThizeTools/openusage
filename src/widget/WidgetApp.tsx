import { useCallback, useEffect, useRef, type PointerEvent, type WheelEvent } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { emit } from "@tauri-apps/api/event"
import { getCurrentWindow, PhysicalSize } from "@tauri-apps/api/window"
import { Settings } from "lucide-react"
import { useDarkMode } from "@/hooks/use-dark-mode"
import { useWidgetData } from "@/widget/use-widget-data"
import { adjustWidgetZoom, widgetZoomDeltaFromWheel } from "@/lib/widget-zoom"
import { WidgetRowItem } from "@/widget/widget-row"

/** Movement (CSS px) below which a pointer-down still counts as a click. */
const DRAG_THRESHOLD_PX = 3

type DragState = {
  pointerId: number
  startScreenX: number
  startScreenY: number
  /** CSS px → physical px factor, snapshotted at drag start so a mid-drag
   * monitor-DPI change can't rescale the whole accumulated delta. */
  factor: number
  /** Window outer position (physical px) at drag start; null until fetched. */
  base: { x: number; y: number } | null
  /** Last pointer screen coords seen before `base` resolved. */
  lastScreen: { x: number; y: number } | null
  moved: boolean
}

export function WidgetApp() {
  const { rows, layout, zoom, setWidgetZoom, toggleLayout } = useWidgetData()
  const isDark = useDarkMode()
  const containerRef = useRef<HTMLDivElement>(null)

  // The widget is dragged in JS (pointer capture + move_widget_to) instead of
  // data-tauri-drag-region: Windows' native move loop clamps a tiny frameless
  // window back into the work area on drop, so it could never rest over the
  // taskbar. The Rust command clamps to full monitor bounds instead.
  const dragRef = useRef<DragState | null>(null)
  const lastDragMovedAtRef = useRef(0)
  const moveBusyRef = useRef(false)
  const movePendingRef = useRef<{ x: number; y: number } | null>(null)

  const sendMove = (x: number, y: number) => {
    // One move in flight at a time; coalesce the rest to the newest target.
    if (moveBusyRef.current) {
      movePendingRef.current = { x, y }
      return
    }
    moveBusyRef.current = true
    void invoke("move_widget_to", { x, y })
      .catch((error) => console.error("Failed to move widget:", error))
      .finally(() => {
        moveBusyRef.current = false
        const pending = movePendingRef.current
        movePendingRef.current = null
        if (pending) sendMove(pending.x, pending.y)
      })
  }

  const applyMove = (drag: DragState, screenX: number, screenY: number) => {
    if (!drag.base) {
      drag.lastScreen = { x: screenX, y: screenY }
      return
    }
    const dx = screenX - drag.startScreenX
    const dy = screenY - drag.startScreenY
    if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return
    drag.moved = true
    sendMove(drag.base.x + Math.round(dx * drag.factor), drag.base.y + Math.round(dy * drag.factor))
  }

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !isTauri()) return
    const container = containerRef.current
    if (!container) return
    container.setPointerCapture(e.pointerId)
    const drag: DragState = {
      pointerId: e.pointerId,
      startScreenX: e.screenX,
      startScreenY: e.screenY,
      factor: window.devicePixelRatio,
      base: null,
      lastScreen: null,
      moved: false,
    }
    dragRef.current = drag
    void getCurrentWindow()
      .outerPosition()
      .then((pos) => {
        if (dragRef.current !== drag) return
        drag.base = { x: pos.x, y: pos.y }
        if (drag.lastScreen) applyMove(drag, drag.lastScreen.x, drag.lastScreen.y)
      })
      .catch((error) => console.error("Failed to read widget position:", error))
  }

  const clearDrag = (pointerId?: number) => {
    const drag = dragRef.current
    if (!drag || (pointerId !== undefined && drag.pointerId !== pointerId)) return
    if (drag.moved) lastDragMovedAtRef.current = Date.now()
    dragRef.current = null
    if (containerRef.current?.hasPointerCapture(drag.pointerId)) {
      containerRef.current.releasePointerCapture(drag.pointerId)
    }
  }

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || e.pointerId !== drag.pointerId) return
    // If capture is lost or the window is hidden mid-drag (Escape, Win+L, UAC),
    // Chromium may miss pointerup. Same mouse pointerId is reused later; without
    // this, buttonless hover would keep moving the widget.
    if ((e.buttons & 1) === 0) {
      clearDrag(e.pointerId)
      return
    }
    applyMove(drag, e.screenX, e.screenY)
  }

  const endDrag = (e: PointerEvent<HTMLDivElement>) => clearDrag(e.pointerId)

  const handleDoubleClick = () => {
    // A jittery first click can move, then the second click still forms a
    // dblclick. Suppress layout toggles right after any drag movement.
    if (Date.now() - lastDragMovedAtRef.current < 500) return
    toggleLayout()
  }

  // Auto-fit the window to content. Horizontal is one strip; vertical stacks
  // providers while each provider keeps the same one-line row shape.
  useEffect(() => {
    if (!isTauri()) return
    const container = containerRef.current
    if (!container) return

    const resize = async () => {
      const factor = window.devicePixelRatio
      const rect = container.getBoundingClientRect()
      const width = Math.ceil(Math.max(1, rect.width) * factor)
      const height = Math.ceil(Math.max(1, rect.height) * factor)
      try {
        await getCurrentWindow().setSize(new PhysicalSize(width, height))
        await invoke("bring_widget_on_screen")
      } catch (error) {
        console.error("Failed to resize widget:", error)
      }
    }

    void resize()
    const observer = new ResizeObserver(() => void resize())
    observer.observe(container)
    return () => observer.disconnect()
  }, [rows, layout, zoom])

  const handleWheel = useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      if (!isTauri()) return
      e.preventDefault()
      const next = adjustWidgetZoom(zoom, widgetZoomDeltaFromWheel(e.deltaY))
      if (next !== zoom) setWidgetZoom(next)
    },
    [zoom, setWidgetZoom]
  )

  // Escape hides the widget (mirrors the panel's Escape-to-hide).
  useEffect(() => {
    if (!isTauri()) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        void invoke("set_widget_visible", { visible: false }).catch(() => {})
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [])

  const isHorizontal = layout === "horizontal"

  const openWidgetSettings = () => {
    if (!isTauri()) return
    invoke("open_settings_window").catch(console.error)
    emit("settings:open-tab", { tab: "widget" }).catch(console.error)
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={handleDoubleClick}
      onWheel={handleWheel}
      title="Double-click to switch layout · Scroll to zoom"
      className="bg-card text-foreground rounded-lg border overflow-hidden select-none flex flex-row items-stretch"
      style={{ width: "max-content", zoom }}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); openWidgetSettings() }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        title="Widget Settings"
        className="flex items-start justify-center pt-1.5 px-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border-r border-border shrink-0"
      >
        <Settings className="size-3" />
      </button>
      <div
        className={
          isHorizontal
            ? "flex flex-row items-stretch divide-x divide-border"
            : "flex flex-col divide-y divide-border"
        }
      >
        {rows.length === 0 ? (
          <div className="px-2.5 py-1.5 text-xs text-muted-foreground">
            No providers enabled
          </div>
        ) : (
          rows.map((row) => (
            <WidgetRowItem key={row.id} row={row} layout={layout} isDark={isDark} />
          ))
        )}
      </div>
    </div>
  )
}
