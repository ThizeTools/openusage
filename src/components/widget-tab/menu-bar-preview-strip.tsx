import { BatteryFullIcon, SearchIcon, WifiIcon } from "lucide-react"
import { MenuBarImage } from "@/components/menu-bar-widget-preview"
import { useModelDemoPayload } from "@/components/widget-tab/demo-payload"
import type { WidgetAppearance, WidgetTabModel } from "@/components/widget-tab/types"
import { useSystemDark } from "@/hooks/use-system-dark"
import { cn } from "@/lib/utils"

/** The widget is 22pt tall in the real menu bar. */
const WIDGET_HEIGHT_PT = 22
const BAR_HEIGHT_PX = 24
const WALLPAPER_HEIGHT_PX = 56
const CLOCK_TEXT = "Tue 9:41"

const WALLPAPER = {
  dark: "linear-gradient(115deg,#2d1b69 0%,#6b2a9a 38%,#b8386a 72%,#e8654f 100%)",
  light: "linear-gradient(115deg,#9cc4ff 0%,#c9b8f5 38%,#f5b8d0 72%,#ffd2a8 100%)",
} as const
const BAR = {
  dark: { background: "rgba(14,10,26,.5)", color: "#fff" },
  light: { background: "rgba(255,255,255,.55)", color: "#1c1c1e" },
} as const

export interface MenuBarPreviewStripProps {
  /** Only the appearance is needed; pass the whole `WidgetTabModel` (plus `visible`) for the full behavior. */
  model: WidgetAppearance &
    Pick<WidgetTabModel, "plugins" | "pluginsMeta" | "providerIds" | "providerMetrics"> &
    Partial<Pick<WidgetTabModel, "visible">>
  /** 1 = real size (22px widget). Use ~2.2 for a big preview. */
  zoom?: number
  /** Small caption chip in the bottom-left corner of the wallpaper ("Live preview"). */
  label?: string
  className?: string
}

/**
 * A fake macOS menu bar over a wallpaper with the REAL rendered widget in it (the same PNG the menu bar shows,
 * at scale 3, displayed 22px tall x `zoom`). Dark / light follows the system. Pin it with `sticky top-0`.
 */
export function MenuBarPreviewStrip({ model, zoom = 1, label, className }: MenuBarPreviewStripProps) {
  const dark = useSystemDark()
  const theme = dark ? "dark" : "light"
  const payload = useModelDemoPayload(model)
  const hidden = model.visible === false
  const px = (value: number) => value * zoom
  const barStyle = { ...BAR[theme], height: px(BAR_HEIGHT_PX), fontSize: px(12), gap: px(12), padding: `0 ${px(12)}px` }
  const iconSize = `${px(14)}px`

  return (
    <div
      data-testid="menu-bar-preview-strip"
      className={cn("relative overflow-hidden", className)}
      style={{ height: px(WALLPAPER_HEIGHT_PX), background: WALLPAPER[theme], borderRadius: px(10) }}
    >
      <div className="flex items-center" style={barStyle}>
        <span className="font-semibold">Finder</span>
        <span>File</span>
        <span>Edit</span>
        <span>View</span>
        <span className="flex-1" />
        <SearchIcon aria-hidden style={{ width: iconSize, height: iconSize }} />
        <div
          className={cn("min-w-0", hidden && "opacity-30")}
          style={{ height: px(WIDGET_HEIGHT_PT) }}
          data-testid="menu-bar-preview-widget"
          title={hidden ? "The widget is hidden from the menu bar" : undefined}
        >
          <MenuBarImage
            payload={payload}
            dark={dark}
            style={model.style}
            backdrop={model.backdrop}
            colors={model.colors}
            textColors={model.textColors}
            toneModes={model.toneModes}
            heightPx={px(WIDGET_HEIGHT_PT)}
          />
        </div>
        <WifiIcon aria-hidden style={{ width: iconSize, height: iconSize }} />
        <BatteryFullIcon aria-hidden style={{ width: px(18), height: iconSize }} />
        <span className="shrink-0 whitespace-nowrap">{CLOCK_TEXT}</span>
      </div>
      {label && (
        <span
          className="absolute rounded bg-black/25 px-1.5 py-px text-[10px] uppercase tracking-wider text-white/80"
          style={{ left: px(10), bottom: px(8) }}
        >
          {label}
        </span>
      )}
    </div>
  )
}
