import type { PluginMeta } from "@/lib/plugin-types"
import type { TrayPrimaryBar } from "@/lib/tray-primary-progress"

/**
 * Formats a fraction (0.0 - 1.0) into a percentage string (0% - 100%).
 */
export function formatTrayPercentText(fraction: number | undefined): string {
  if (typeof fraction !== "number" || !Number.isFinite(fraction)) return "--%"
  const clampedFraction = Math.max(0, Math.min(1, fraction))
  return `${Math.round(clampedFraction * 100)}%`
}

export function formatTrayPercentNumberText(fraction: number | undefined): string {
  if (typeof fraction !== "number" || !Number.isFinite(fraction)) return "--"
  const clampedFraction = Math.max(0, Math.min(1, fraction))
  const pct = Math.min(99, Math.round(clampedFraction * 100))
  return `${pct}`
}

/**
 * Creates a multi-line tooltip string for the tray icon.
 * Lists the app name followed by enabled plugins and their usage percentages.
 */
const metricSuffixCache = new Map<string, string>()

function getTrayMetricSuffix(label: string | undefined): string {
  const normalized = String(label || "").trim().toLowerCase()
  const cached = metricSuffixCache.get(normalized)
  if (cached !== undefined) return cached

  let suffix = ""
  if (normalized.includes("5h") || normalized.includes("5 h") || normalized.includes("session")) suffix = "h"
  else if (normalized.includes("weekly") || normalized.includes("week") || normalized.includes("sonnet") || normalized.includes("design")) suffix = "w"
  else if (normalized.includes("monthly") || normalized.includes("month") || normalized.includes("credit") || normalized.includes("last 30 days")) suffix = "m"

  metricSuffixCache.set(normalized, suffix)
  return suffix
}

function formatTrayBarSummary(bar: TrayPrimaryBar): string {
  const used = formatTrayPercentText(bar.usedFraction ?? bar.fraction)
  return `${used}${getTrayMetricSuffix(bar.label)}`
}

const WINDOWS_TRAY_TOOLTIP_MAX_LENGTH = 127

function getOrderedTooltipBars(bars: TrayPrimaryBar[], pluginsMeta: PluginMeta[]) {
  const metaById = new Map(pluginsMeta.map((p) => [p.id, p]))
  const barsByPluginId = new Map<string, TrayPrimaryBar[]>()
  for (const bar of bars) {
    if (!metaById.has(bar.id)) continue
    const current = barsByPluginId.get(bar.id) ?? []
    current.push(bar)
    barsByPluginId.set(bar.id, current)
  }

  return pluginsMeta.flatMap((meta) =>
    (barsByPluginId.get(meta.id) ?? []).map((bar) => ({ meta, bar }))
  )
}

function buildTrayTooltip(orderedBars: ReturnType<typeof getOrderedTooltipBars>, visibleCount: number): string {
  const lines = ["OpenUsage"]
  const summariesByPluginId = new Map<string, string[]>()
  const metaByPluginId = new Map<string, PluginMeta>()

  for (const { meta, bar } of orderedBars.slice(0, visibleCount)) {
    metaByPluginId.set(meta.id, meta)
    const current = summariesByPluginId.get(meta.id) ?? []
    current.push(formatTrayBarSummary(bar))
    summariesByPluginId.set(meta.id, current)
  }

  for (const [pluginId, summaries] of summariesByPluginId) {
    const meta = metaByPluginId.get(pluginId)
    if (!meta) continue
    lines.push(`${meta.name}: ${summaries.join(" - ")}`)
  }

  const hiddenCount = orderedBars.length - visibleCount
  if (hiddenCount > 0) lines.push(`+ ${hiddenCount} more`)
  return lines.join("\n")
}

export function formatTrayTooltip(bars: TrayPrimaryBar[], pluginsMeta: PluginMeta[]): string {
  const orderedBars = getOrderedTooltipBars(bars, pluginsMeta)
  if (orderedBars.length === 0) return "OpenUsage"

  for (let visibleCount = orderedBars.length; visibleCount >= 0; visibleCount -= 1) {
    const tooltip = buildTrayTooltip(orderedBars, visibleCount)
    if (tooltip.length <= WINDOWS_TRAY_TOOLTIP_MAX_LENGTH) return tooltip
  }

  return "OpenUsage"
}
