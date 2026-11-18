import { getCurrentWindow } from "@tauri-apps/api/window"
import { Minus, Square, X } from "lucide-react"
import { isMacPlatform } from "@/lib/platform"
import { cn } from "@/lib/utils"

/**
 * Frameless-window titlebar with custom Windows controls (minimize / maximize /
 * close). Dragging uses ONLY Tauri's native drag region — no manual
 * startDragging — to avoid the Win11 drag-teleport bug. Control buttons stop
 * mouse-event propagation so a click never starts a window drag.
 * See docs/tauri-fix/tauri-win11-titlebar-drag-teleport-fix.md.
 */
export function WindowTitleBar({ title }: { title: string }) {
  // macOS uses the native title bar (decorations are enabled in Rust).
  if (isMacPlatform()) return null

  const win = getCurrentWindow()

  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <header
      data-tauri-drag-region
      className="flex h-9 shrink-0 items-center justify-between border-b bg-card pl-3 select-none"
    >
      <span data-tauri-drag-region className="text-xs font-medium text-foreground pointer-events-none">
        {title}
      </span>
      <div className="flex items-stretch h-full">
        <TitleBarButton
          ariaLabel="Minimizar"
          onMouseDown={stop}
          onDoubleClick={stop}
          onClick={() => void win.minimize()}
        >
          <Minus className="size-3.5" />
        </TitleBarButton>
        <TitleBarButton
          ariaLabel="Maximizar"
          onMouseDown={stop}
          onDoubleClick={stop}
          onClick={() => void win.toggleMaximize()}
        >
          <Square className="size-3" />
        </TitleBarButton>
        <TitleBarButton
          ariaLabel="Fechar"
          danger
          onMouseDown={stop}
          onDoubleClick={stop}
          onClick={() => void win.close()}
        >
          <X className="size-3.5" />
        </TitleBarButton>
      </div>
    </header>
  )
}

function TitleBarButton({
  children,
  ariaLabel,
  danger,
  onClick,
  onMouseDown,
  onDoubleClick,
}: {
  children: React.ReactNode
  ariaLabel: string
  danger?: boolean
  onClick: () => void
  onMouseDown: (e: React.MouseEvent) => void
  onDoubleClick: (e: React.MouseEvent) => void
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      className={cn(
        "flex w-11 items-center justify-center text-muted-foreground transition-colors",
        // Keep hover rectangles square (no radius) so they don't clip at rounded corners.
        danger ? "hover:bg-red-500 hover:text-white" : "hover:bg-accent hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}
