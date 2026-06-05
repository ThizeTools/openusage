import type { PluginMeta } from "@/lib/plugin-types"
import type { PluginState } from "@/hooks/app/types"
import type { PluginSettings, WidgetMetric, WidgetProviderIds } from "@/lib/settings"
import { getTrayPrimaryBars, type TrayPrimaryBar } from "@/lib/tray-primary-progress"

/** Pace tone, mirroring the tray icon tint. */
export type WidgetTone = "ahead" | "on-track" | "behind" | "neutral"

export type WidgetRow = {
  id: string
  name: string
  iconUrl: string
  brandColor?: string
  /** Used 0..1 fraction of the shown metric. null when no data. */
  fraction: number | null
  /** Color tone derived from pace; "neutral" when unknown. */
  tone: WidgetTone
  /**
   * When ANY of the provider's limits is reached (even one not shown, e.g. the
   * 5h session while the widget shows Weekly): the moment the provider becomes
   * available again (ms). Undefined when nothing is capped.
   */
  limitedUntilMs?: number
}

// Same primary metric the tray icon shows: weekly/total, never the 5h session.
const WIDGET_PRIMARY_USAGE_LABELS = ["Weekly", "Weekly quota", "Total usage"]

/**
 * Distinct progress-metric labels across the enabled widget providers, in order
 * of first appearance. Feeds the "which metric" picker in Settings.
 */
export function getAvailableWidgetMetrics(
  pluginsMeta: PluginMeta[],
  enabledIds: string[]
): string[] {
  const enabled = new Set(enabledIds)
  const labels: string[] = []
  const seen = new Set<string>()
  for (const meta of pluginsMeta) {
    if (!enabled.has(meta.id)) continue
    for (const line of meta.lines) {
      if (line.type !== "progress") continue
      if (seen.has(line.label)) continue
      seen.add(line.label)
      labels.push(line.label)
    }
  }
  return labels
}

/** Pace tone matching the tray icon (getTrayTintColor). */
function paceTone(usedFraction?: number, expectedFraction?: number): WidgetTone {
  if (typeof usedFraction !== "number" || !Number.isFinite(usedFraction)) return "neutral"
  if (usedFraction >= 1) return "behind"
  if (typeof expectedFraction !== "number" || !Number.isFinite(expectedFraction) || expectedFraction <= 0) {
    return "neutral"
  }
  const projectedUsage = usedFraction / expectedFraction
  if (projectedUsage <= 0.8) return "ahead"
  if (projectedUsage <= 1) return "on-track"
  return "behind"
}

/**
 * Latest future reset among the provider's limit-reached progress lines (any
 * metric, not just the one shown). Undefined when no limit is reached.
 */
function getLimitedUntilMs(state: PluginState | undefined, nowMs: number): number | undefined {
  const lines = state?.data?.lines
  if (!lines) return undefined
  let latest: number | undefined
  for (const line of lines) {
    if (line.type !== "progress") continue
    if (!(line.limit > 0) || line.used < line.limit) continue
    if (!line.resetsAt) continue
    const resetsAtMs = Date.parse(line.resetsAt)
    if (!Number.isFinite(resetsAtMs) || resetsAtMs <= nowMs) continue
    if (latest === undefined || resetsAtMs > latest) latest = resetsAtMs
  }
  return latest
}

/**
 * Builds one row per enabled provider for the floating widget. Each row shows
 * the used fraction for the weekly/total metric, exactly like the tray icon.
 * When any of the provider's limits is reached, the row carries the time it
 * becomes available again instead.
 */
export function buildWidgetRows(args: {
  pluginsMeta: PluginMeta[]
  pluginSettings: PluginSettings | null
  pluginStates: Record<string, PluginState | undefined>
  widgetProviderIds?: WidgetProviderIds
  widgetMetric?: WidgetMetric
  nowMs?: number
}): WidgetRow[] {
  const { pluginsMeta, pluginSettings, pluginStates, widgetProviderIds, widgetMetric } = args
  const nowMs = args.nowMs ?? Date.now()
  if (!pluginSettings) return []

  // One bar per provider. When the user picked a specific metric, prefer that
  // label; otherwise fall back to the weekly/total metric the tray icon uses.
  const preferredLabels = widgetMetric ? [widgetMetric] : WIDGET_PRIMARY_USAGE_LABELS
  const bars = getTrayPrimaryBars({
    pluginsMeta,
    pluginSettings,
    pluginStates,
    maxBars: Number.POSITIVE_INFINITY,
    nowMs,
    preferredLabels,
    preferredLabelsOnly: true,
  })
  const barById = new Map<string, TrayPrimaryBar>()
  for (const bar of bars) {
    if (!barById.has(bar.id)) barById.set(bar.id, bar)
  }

  const metaById = new Map(pluginsMeta.map((p) => [p.id, p]))
  const disabled = new Set(pluginSettings.disabled)
  const widgetProviderSet = widgetProviderIds === null || widgetProviderIds === undefined
    ? null
    : new Set(widgetProviderIds)

  const rows: WidgetRow[] = []
  for (const id of pluginSettings.order) {
    if (disabled.has(id)) continue
    if (widgetProviderSet && !widgetProviderSet.has(id)) continue
    const meta = metaById.get(id)
    if (!meta) continue
    const bar = barById.get(id)
    const limitedUntilMs = getLimitedUntilMs(pluginStates[id], nowMs)
    rows.push({
      id,
      name: meta.name,
      iconUrl: meta.iconUrl,
      brandColor: meta.brandColor,
      fraction: typeof bar?.fraction === "number" ? bar.fraction : null,
      tone: limitedUntilMs !== undefined ? "behind" : paceTone(bar?.usedFraction, bar?.expectedFraction),
      limitedUntilMs,
    })
  }

  return rows
}
