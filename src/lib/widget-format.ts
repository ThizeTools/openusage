import { getTimeFormatter } from "@/lib/reset-tooltip"
import { formatTrayPercentText } from "@/lib/tray-tooltip"

export const WEEKDAY_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
})

/** Compact "available at" time: "2:30 PM" today, otherwise "Sat 2:30 PM". */
export function formatAvailableAt(limitedUntilMs: number): string {
  const target = new Date(limitedUntilMs)
  const now = new Date()
  const sameDay =
    target.getFullYear() === now.getFullYear() &&
    target.getMonth() === now.getMonth() &&
    target.getDate() === now.getDate()
  return sameDay ? getTimeFormatter().format(target) : WEEKDAY_TIME_FORMATTER.format(target)
}

export function formatUsageText(
  fraction: number,
  expectedFraction: number | null | undefined
): string {
  const used = formatTrayPercentText(fraction)
  return typeof expectedFraction === "number"
    ? `${used}/${formatTrayPercentText(expectedFraction)}`
    : used
}
