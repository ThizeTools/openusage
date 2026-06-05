import type { PaceResult, PaceStatus } from "@/lib/pace-status"

export function getPaceStatusText(status: PaceStatus): string {
  return status === "ahead" ? "Plenty of room" : status === "on-track" ? "Right on target" : "Will run out"
}

export function formatCompactDuration(deltaMs: number): string | null {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return null
  const totalSeconds = Math.floor(deltaMs / 1000)
  const totalMinutes = Math.floor(totalSeconds / 60)
  const totalHours = Math.floor(totalMinutes / 60)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  const minutes = totalMinutes % 60

  if (days > 0) return `${days}d ${hours}h`
  if (totalHours > 0) return `${totalHours}h ${minutes}m`
  if (totalMinutes > 0) return `${totalMinutes}m`
  return "<1m"
}

/**
 * Absolute timestamp (ms) when usage is projected to hit the limit. Null when
 * not behind pace or the limit would only be hit after the period resets.
 */
export function getRunsOutAtMs({
  paceResult,
  used,
  limit,
  periodDurationMs,
  resetsAtMs,
  nowMs,
}: {
  paceResult: PaceResult | null
  used: number
  limit: number
  periodDurationMs: number
  resetsAtMs: number
  nowMs: number
}): number | null {
  if (!paceResult || paceResult.status !== "behind") return null
  const rate = paceResult.projectedUsage / periodDurationMs
  if (rate <= 0) return null
  const etaMs = (limit - used) / rate
  const remainingMs = resetsAtMs - nowMs
  if (etaMs <= 0 || etaMs >= remainingMs) return null
  return nowMs + etaMs
}

function getRunsOutDurationText(args: {
  paceResult: PaceResult | null
  used: number
  limit: number
  periodDurationMs: number
  resetsAtMs: number
  nowMs: number
}): string | null {
  const runsOutAtMs = getRunsOutAtMs(args)
  if (runsOutAtMs === null) return null
  return formatCompactDuration(runsOutAtMs - args.nowMs)
}

export function buildPaceDetailText({
  paceResult,
  used,
  limit,
  periodDurationMs,
  resetsAtMs,
  nowMs,
}: {
  paceResult: PaceResult | null
  used: number
  limit: number
  periodDurationMs: number
  resetsAtMs: number
  nowMs: number
}): string | null {
  if (!paceResult || !Number.isFinite(limit) || limit <= 0 || paceResult.projectedUsage === 0) return null

  if (paceResult.status === "behind") {
    const durationText = getRunsOutDurationText({ paceResult, used, limit, periodDurationMs, resetsAtMs, nowMs })
    if (durationText) return `Limit in ${durationText}`
  }

  // Show projected % at reset (clamped to 100%)
  const projectedPercent = Math.min(100, Math.round((paceResult.projectedUsage / limit) * 100))
  return `${projectedPercent}% used at reset`
}
