import { useMemo } from "react"
import { BatteryFullIcon, SearchIcon, WifiIcon } from "lucide-react"
import { MenuBarImage } from "@/components/menu-bar-widget-preview"
import { useModelDemoPayload } from "@/components/widget-tab/demo-payload"
import type { WidgetAppearance, WidgetTabModel } from "@/components/widget-tab/types"
import { useSystemDark } from "@/hooks/use-system-dark"
import { accountLabel as accountPart, claudeAccountId } from "@/lib/claude-desktop"
import { isWindowsPlatform } from "@/lib/platform"
import type { MenuBarAccountLabel } from "@/lib/settings"
import { cn } from "@/lib/utils"

/** The widget is 22pt tall in the real menu bar. */
const WIDGET_HEIGHT_PT = 22
const BAR_HEIGHT_PX = 24
const WALLPAPER_HEIGHT_PX = 56
const CLOCK_TEXT = "Tue 9:41"
/** Windows: a taskbar along the bottom of the wallpaper; the widget is scaled to it (taskbar height / 36). */
const TASKBAR_HEIGHT_PX = 40
const TASKBAR_WIDGET_HEIGHT_PX = Math.round((22 * TASKBAR_HEIGHT_PX) / 36)
const TASKBAR_CLOCK_TEXT = "9:41 AM"

const WALLPAPER = {
  dark: "linear-gradient(115deg,#2d1b69 0%,#6b2a9a 38%,#b8386a 72%,#e8654f 100%)",
  light: "linear-gradient(115deg,#9cc4ff 0%,#c9b8f5 38%,#f5b8d0 72%,#ffd2a8 100%)",
} as const
const BAR = {
  dark: { background: "rgba(14,10,26,.5)", color: "#fff" },
  light: { background: "rgba(255,255,255,.55)", color: "#1c1c1e" },
} as const
const TASKBAR = {
  dark: { background: "rgba(32,32,32,.92)", color: "#fff" },
  light: { background: "rgba(243,243,243,.92)", color: "#1c1c1e" },
} as const

export interface MenuBarPreviewStripProps {
  /** Only the appearance is needed; pass the whole `WidgetTabModel` (plus `visible`) for the full behavior. */
  model: WidgetAppearance &
    Pick<WidgetTabModel, "plugins" | "pluginsMeta" | "providerIds" | "providerMetrics"> &
    Partial<Pick<WidgetTabModel, "visible">>
  /** 1 = real size (22px widget). Use ~2.2 for a big preview. */
  zoom?: number
  /** How Claude accounts are named in the demo widget (when 2+ are registered); omit to leave the demo unnamed. */
  accountLabel?: MenuBarAccountLabel
  /** Small caption chip in the bottom-left corner of the wallpaper ("Live preview"). */
  label?: string
  className?: string
}

/**
 * A fake macOS menu bar (a Windows taskbar on Windows) over a wallpaper with the REAL rendered widget in it (the same
 * image the real bar shows, at scale 3, displayed 22px tall x `zoom`). Dark / light follows the system. Pin it with
 * `sticky top-0`.
 */
export function MenuBarPreviewStrip({ model, zoom = 1, accountLabel, label, className }: MenuBarPreviewStripProps) {
  const dark = useSystemDark()
  const theme = dark ? "dark" : "light"
  const demoPayload = useModelDemoPayload(model)
  // Account names (account part of the plugin name) once 2+ Claude accounts are registered; keyed on content.
  const claudeAccounts = model.pluginsMeta.filter((meta) => claudeAccountId(meta.id) !== null)
  const namesKey = JSON.stringify(
    accountLabel !== undefined && accountLabel !== "off" && claudeAccounts.length >= 2
      ? Object.fromEntries(claudeAccounts.map((meta) => [meta.id, accountPart(meta.name)]))
      : null
  )
  const payload = useMemo(() => {
    const names = JSON.parse(namesKey) as Record<string, string> | null
    if (!names) return demoPayload
    return {
      ...demoPayload,
      providers: demoPayload.providers.map((provider) =>
        names[provider.id] ? { ...provider, accountName: names[provider.id] } : provider
      ),
    }
  }, [demoPayload, namesKey])
  const hidden = model.visible === false
  const windows = isWindowsPlatform()
  const px = (value: number) => value * zoom
  const barHeight = windows ? TASKBAR_HEIGHT_PX : BAR_HEIGHT_PX
  const widgetHeight = windows ? TASKBAR_WIDGET_HEIGHT_PX : WIDGET_HEIGHT_PT
  const barStyle = {
    ...(windows ? TASKBAR : BAR)[theme],
    height: px(barHeight),
    fontSize: px(12),
    gap: px(12),
    padding: `0 ${px(12)}px`,
    ...(windows ? { position: "absolute" as const, left: 0, right: 0, bottom: 0 } : {}),
  }
  const iconSize = `${px(14)}px`
  const surface = windows ? "taskbar" : "menu bar"

  return (
    <div
      data-testid="menu-bar-preview-strip"
      className={cn("relative overflow-hidden", className)}
      style={{ height: px(WALLPAPER_HEIGHT_PX), background: WALLPAPER[theme], borderRadius: px(10) }}
    >
      <div className="flex items-center" style={barStyle}>
        {!windows && (
          <>
            <span className="font-semibold">Finder</span>
            <span>File</span>
            <span>Edit</span>
            <span>View</span>
          </>
        )}
        <span className="flex-1" />
        {!windows && <SearchIcon aria-hidden style={{ width: iconSize, height: iconSize }} />}
        <div
          className={cn("min-w-0", hidden && "opacity-30")}
          style={{ height: px(widgetHeight) }}
          data-testid="menu-bar-preview-widget"
          title={hidden ? `The widget is hidden from the ${surface}` : undefined}
        >
          <MenuBarImage
            payload={payload}
            dark={dark}
            style={model.style}
            backdrop={model.backdrop}
            colors={model.colors}
            textColors={model.textColors}
            toneModes={model.toneModes}
            accountLabel={accountLabel}
            heightPx={px(widgetHeight)}
          />
        </div>
        <WifiIcon aria-hidden style={{ width: iconSize, height: iconSize }} />
        <BatteryFullIcon aria-hidden style={{ width: px(18), height: iconSize }} />
        <span className="shrink-0 whitespace-nowrap">{windows ? TASKBAR_CLOCK_TEXT : CLOCK_TEXT}</span>
      </div>
      {label && (
        <span
          className="absolute rounded bg-black/25 px-1.5 py-px text-[10px] uppercase tracking-wider text-white/80"
          style={windows ? { left: px(10), top: px(8) } : { left: px(10), bottom: px(8) }}
        >
          {label}
        </span>
      )}
    </div>
  )
}
