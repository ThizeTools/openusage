import type { ResetTimerDisplayMode } from "@/lib/settings"
import { formatCompactDuration } from "@/lib/pace-tooltip"

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
})

export function getTimeFormatter(): Intl.DateTimeFormat {
  return TIME_FORMATTER
}

const RESET_MONTH_DAY_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
})

const RESET_SOON_THRESHOLD_MS = 5 * 60 * 1000

function parseResetTimestamp(resetsAtIso: string): number | null {
  const resetsAtMs = Date.parse(resetsAtIso)
  return Number.isFinite(resetsAtMs) ? resetsAtMs : null
}

function getLocalDayIndex(timestampMs: number): number {
  const date = new Date(timestampMs)
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)
}

function formatMonthDay(timestampMs: number): string {
  return RESET_MONTH_DAY_FORMATTER.format(timestampMs)
}

export function formatResetRelativeLabel(nowMs: number, resetsAtIso: string): string | null {
  const resetsAtMs = parseResetTimestamp(resetsAtIso)
  if (resetsAtMs === null) return null
  const deltaMs = resetsAtMs - nowMs
  if (deltaMs < RESET_SOON_THRESHOLD_MS) return "Resets soon"
  const durationText = formatCompactDuration(deltaMs)
  return durationText ? `Resets in ${durationText}` : null
}

/** Absolute "when" label: "today at 2:30 PM", "tomorrow at 2:30 PM", "Jun 7 at 2:30 PM". */
export function formatAtLabel(nowMs: number, targetMs: number): string {
  const dayDiff = getLocalDayIndex(targetMs) - getLocalDayIndex(nowMs)
  const timeText = getTimeFormatter().format(targetMs)
  if (dayDiff <= 0) return `today at ${timeText}`
  if (dayDiff === 1) return `tomorrow at ${timeText}`
  return `${formatMonthDay(targetMs)} at ${timeText}`
}

export function formatResetAbsoluteLabel(
  nowMs: number,
  resetsAtIso: string,
): string | null {
  const resetsAtMs = parseResetTimestamp(resetsAtIso)
  if (resetsAtMs === null) return null
  if (resetsAtMs - nowMs <= 0) return "Resets soon"
  return `Resets ${formatAtLabel(nowMs, resetsAtMs)}`
}

export function formatResetTooltipText({
  nowMs,
  resetsAtIso,
  visibleMode,
}: {
  nowMs: number
  resetsAtIso: string
  visibleMode: ResetTimerDisplayMode
}): string | null {
  return visibleMode === "absolute"
    ? formatResetRelativeLabel(nowMs, resetsAtIso)
    : formatResetAbsoluteLabel(nowMs, resetsAtIso)
}
