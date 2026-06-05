import { getRelativeLuminance } from "@/lib/color"
import { getTimeFormatter } from "@/lib/reset-tooltip"
import { formatTrayPercentText } from "@/lib/tray-tooltip"
import { cn } from "@/lib/utils"
import type { WidgetRow } from "@/lib/widget-rows"

/** Mirrors side-nav's getIconColor: keep brand logos legible on either theme. */
function getIconColor(brandColor: string | undefined, isDark: boolean): string {
  if (!brandColor) return "currentColor"
  const luminance = getRelativeLuminance(brandColor)
  if (isDark && luminance < 0.15) return "#ffffff"
  if (!isDark && luminance > 0.85) return "currentColor"
  return brandColor
}

type WidgetRowProps = {
  row: WidgetRow
  layout: "vertical" | "horizontal"
  isDark: boolean
}

const WEEKDAY_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
})

/** Compact "available at" time: "2:30 PM" today, otherwise "Sat 2:30 PM". */
function formatAvailableAt(limitedUntilMs: number): string {
  const target = new Date(limitedUntilMs)
  const now = new Date()
  const sameDay =
    target.getFullYear() === now.getFullYear() &&
    target.getMonth() === now.getMonth() &&
    target.getDate() === now.getDate()
  return sameDay ? getTimeFormatter().format(target) : WEEKDAY_TIME_FORMATTER.format(target)
}

export function WidgetRowItem({ row, layout, isDark }: WidgetRowProps) {
  const isLimited = typeof row.limitedUntilMs === "number"
  const value = isLimited
    ? formatAvailableAt(row.limitedUntilMs!)
    : row.fraction === null
      ? "—"
      : formatTrayPercentText(row.fraction)

  return (
    <div
      data-tauri-drag-region
      title={isLimited ? `Limit reached — available ${formatAvailableAt(row.limitedUntilMs!)}` : undefined}
      className={cn(
        "flex items-center gap-1.5 text-foreground",
        layout === "horizontal" ? "px-2 py-1" : "px-2.5 py-1.5"
      )}
      data-testid="widget-row"
    >
      <span
        data-tauri-drag-region
        role="img"
        aria-label={row.name}
        className="size-4 shrink-0 inline-block pointer-events-none"
        style={{
          backgroundColor: getIconColor(row.brandColor, isDark),
          WebkitMaskImage: `url(${row.iconUrl})`,
          WebkitMaskSize: "contain",
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskImage: `url(${row.iconUrl})`,
          maskSize: "contain",
          maskRepeat: "no-repeat",
          maskPosition: "center",
        }}
      />
      <span data-tauri-drag-region className="text-xs font-medium shrink-0 pointer-events-none">
        {row.name}
      </span>
      <span
        data-tauri-drag-region
        className={cn(
          "text-xs font-semibold tabular-nums ml-auto pl-1 pointer-events-none",
          row.tone === "ahead" && "text-green-500",
          row.tone === "on-track" && "text-yellow-500",
          row.tone === "behind" && "text-red-500"
        )}
      >
        {value}
      </span>
    </div>
  )
}
