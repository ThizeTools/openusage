import { useEffect, useRef } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { emit } from "@tauri-apps/api/event"
import { getCurrentWindow, PhysicalSize } from "@tauri-apps/api/window"
import { Settings } from "lucide-react"
import { useDarkMode } from "@/hooks/use-dark-mode"
import { useWidgetData } from "@/widget/use-widget-data"
import { WidgetRowItem } from "@/widget/widget-row"

const WIDGET_VERTICAL_WIDTH_PX = 260

export function WidgetApp() {
  const { rows, layout, toggleLayout } = useWidgetData()
  const isDark = useDarkMode()
  const containerRef = useRef<HTMLDivElement>(null)

  // Auto-fit the window to content. Vertical = fixed width / stacked rows;
  // horizontal = a single strip whose width follows the content.
  useEffect(() => {
    if (!isTauri()) return
    const container = containerRef.current
    if (!container) return

    const resize = async () => {
      const factor = window.devicePixelRatio
      const widthLogical =
        layout === "horizontal" ? Math.max(1, container.scrollWidth) : WIDGET_VERTICAL_WIDTH_PX
      const width = Math.ceil(widthLogical * factor)
      const height = Math.max(1, Math.ceil(container.scrollHeight * factor))
      try {
        await getCurrentWindow().setSize(new PhysicalSize(width, height))
      } catch (error) {
        console.error("Failed to resize widget:", error)
      }
    }

    void resize()
    const observer = new ResizeObserver(() => void resize())
    observer.observe(container)
    return () => observer.disconnect()
  }, [rows, layout])

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
      data-tauri-drag-region
      onDoubleClick={toggleLayout}
      title="Double-click to switch layout"
      className="bg-card text-foreground rounded-lg border overflow-hidden select-none flex flex-row items-stretch"
      style={{ width: isHorizontal ? "max-content" : `${WIDGET_VERTICAL_WIDTH_PX}px` }}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); openWidgetSettings() }}
        onDoubleClick={(e) => e.stopPropagation()}
        title="Widget Settings"
        className="flex items-start justify-center pt-1.5 px-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border-r border-border shrink-0"
      >
        <Settings className="size-3" />
      </button>
      <div
        data-tauri-drag-region
        className={
          isHorizontal
            ? "flex flex-row items-stretch divide-x divide-border"
            : "flex flex-col"
        }
      >
        {rows.length === 0 ? (
          <div className="px-2.5 py-1.5 text-xs text-muted-foreground" data-tauri-drag-region>
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
