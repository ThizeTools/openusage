import { getRelativeLuminance } from "@/lib/color"
import { getTimeFormatter } from "@/lib/reset-tooltip"
import { formatTrayPercentText } from "@/lib/tray-tooltip"
import { cn } from "@/lib/utils"
import type { WidgetRow, WidgetTone } from "@/lib/widget-rows"

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

function toneClass(tone: WidgetTone): string | false {
  return (
    (tone === "ahead" && "text-green-500") ||
    (tone === "on-track" && "text-yellow-500") ||
    (tone === "behind" && "text-red-500")
  )
}

function formatUsageValue(fraction: number, hidePercentSign = false): string {
  const value = formatTrayPercentText(fraction)
  return hidePercentSign ? value.replace("%", "") : value
}

function formatUsageText(
  fraction: number,
  expectedFraction: number | null | undefined,
  hidePercentSign = false
): string {
  const used = formatUsageValue(fraction, hidePercentSign)
  return typeof expectedFraction === "number"
    ? `${used}/${formatUsageValue(expectedFraction, hidePercentSign)}`
    : used
}

export function WidgetRowItem({ row, layout, isDark }: WidgetRowProps) {
  const isLimited = typeof row.limitedUntilMs === "number"
  const value = isLimited
    ? formatAvailableAt(row.limitedUntilMs!)
    : row.fraction === null
      ? "—"
      : formatTrayPercentText(row.fraction)
  // Labeled multi-metric display ("most used" / "all" modes); limited state
  // falls back to the single availability time.
  const metrics = !isLimited && row.metrics && row.metrics.length > 0 ? row.metrics : null

  return (
    <div
      title={isLimited ? `Limit reached — available ${formatAvailableAt(row.limitedUntilMs!)}` : undefined}
      className={cn(
        "flex gap-1.5 text-foreground",
        layout === "horizontal" ? "items-center px-2 py-1" : "items-center px-2.5 py-1.5"
      )}
      data-testid="widget-row"
    >
      <span
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
      <span
        className={cn(
          "min-w-0",
          layout === "horizontal" ? "contents" : "flex items-center gap-2"
        )}
      >
        <span className="text-xs font-medium shrink-0 pointer-events-none">
          {row.name}
        </span>
        {metrics ? (
          <span
            data-testid="metric-list"
            className={cn(
              "text-xs font-semibold tabular-nums pointer-events-none flex",
              layout === "horizontal" ? "flex-row items-center gap-2 ml-auto pl-1" : "flex-row items-center gap-2 min-w-0"
            )}
          >
            {metrics.map((metric, index) => (
              <span key={metric.label} className="contents">
                <span className="whitespace-nowrap">
                  <span className="text-muted-foreground font-normal">{metric.label} </span>
                  <span className={cn(toneClass(metric.tone))}>
                    {formatUsageText(metric.fraction, metric.expectedFraction, metric.hidePercentSign)}
                  </span>
                </span>
                {index < metrics.length - 1 ? (
                  <span
                    aria-hidden="true"
                    data-testid="metric-divider"
                    className="text-muted-foreground/60 font-normal"
                  >
                    |
                  </span>
                ) : null}
              </span>
            ))}
          </span>
        ) : (
          <span
            className={cn(
              "text-xs font-semibold tabular-nums pointer-events-none",
              layout === "horizontal" && "ml-auto pl-1",
              toneClass(row.tone)
            )}
          >
            {isLimited || row.fraction === null
              ? value
              : formatUsageText(row.fraction, row.expectedFraction)}
          </span>
        )}
      </span>
    </div>
  )
}
