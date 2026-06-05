import type { PluginMeta } from "@/lib/plugin-types"
import type { PluginState } from "@/hooks/app/types"
import {
  WIDGET_METRIC_ALL,
  WIDGET_METRIC_MOST_USED,
  WIDGET_METRIC_SUGESTAO,
  type PluginSettings,
  type WidgetMetric,
  type WidgetProviderIds,
} from "@/lib/settings"
import { getTrayPrimaryBars, type TrayPrimaryBar } from "@/lib/tray-primary-progress"

/** Pace tone, mirroring the tray icon tint. */
export type WidgetTone = "ahead" | "on-track" | "behind" | "neutral"

/** One labeled metric value, used by the "most used" / "all" widget modes. */
export type WidgetRowMetric = {
  label: string
  fraction: number
  expectedFraction?: number | null
  hidePercentSign?: boolean
  tone: WidgetTone
}

export type WidgetRow = {
  id: string
  name: string
  iconUrl: string
  brandColor?: string
  /** Used 0..1 fraction of the shown metric. null when no data. */
  fraction: number | null
  /** Expected 0..1 fraction of the shown metric pace. */
  expectedFraction?: number | null
  /** Color tone derived from pace; "neutral" when unknown. */
  tone: WidgetTone
  /**
   * Labeled metric values for the "most used" / "all" pseudo-metrics; absent in
   * the single-metric modes (Auto / a specific label).
   */
  metrics?: WidgetRowMetric[]
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

const SUGESTAO_LABELS_BY_PROVIDER: Record<string, string[]> = {
  claude: ["Session", "Weekly"],
  codex: ["Session", "Weekly", "Spark", "Spark Weekly"],
  cursor: ["Total usage"],
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase()
}

function getSugestaoLabels(id: string, name: string): string[] {
  return SUGESTAO_LABELS_BY_PROVIDER[normalizeText(id)] ?? SUGESTAO_LABELS_BY_PROVIDER[normalizeText(name)] ?? []
}

function filterSugestaoBars(
  id: string,
  name: string,
  bars: TrayPrimaryBar[]
): Array<TrayPrimaryBar & { label: string; fraction: number }> {
  const byLabel = new Map(
    bars
      .filter((bar): bar is TrayPrimaryBar & { label: string; fraction: number } =>
        typeof bar.label === "string" && typeof bar.fraction === "number"
      )
      .map((bar) => [normalizeText(bar.label), bar])
  )
  return getSugestaoLabels(id, name)
    .map((label) => byLabel.get(normalizeText(label)))
    .filter((bar): bar is TrayPrimaryBar & { label: string; fraction: number } => {
      if (!bar) return false
      if (normalizeText(bar.label).startsWith("spark")) return (bar.used ?? 0) > 0
      return true
    })
}

/**
 * Builds one row per enabled provider for the floating widget. Each row shows
 * the used fraction for the weekly/total metric (like the tray icon), the
 * user-picked metric, the provider's most-used metric, or all of its metrics.
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

  const multiMode =
    widgetMetric === WIDGET_METRIC_MOST_USED ||
    widgetMetric === WIDGET_METRIC_ALL ||
    widgetMetric === WIDGET_METRIC_SUGESTAO

  // Single mode: one bar per provider — the picked label, or the weekly/total
  // metric the tray icon uses. Multi mode: every metric the provider exposes.
  const preferredLabels = multiMode
    ? widgetMetric === WIDGET_METRIC_SUGESTAO
      ? Array.from(new Set(Object.values(SUGESTAO_LABELS_BY_PROVIDER).flat()))
      : getAvailableWidgetMetrics(
          pluginsMeta,
          pluginSettings.order.filter((id) => !pluginSettings.disabled.includes(id))
        )
    : widgetMetric
      ? [widgetMetric]
      : WIDGET_PRIMARY_USAGE_LABELS
  const bars = getTrayPrimaryBars({
    pluginsMeta,
    pluginSettings,
    pluginStates,
    maxBars: Number.POSITIVE_INFINITY,
    nowMs,
    preferredLabels,
    preferredLabelsOnly: true,
    includeAllMatches: multiMode,
  })
  const barsById = new Map<string, TrayPrimaryBar[]>()
  for (const bar of bars) {
    const list = barsById.get(bar.id)
    if (list) list.push(bar)
    else barsById.set(bar.id, [bar])
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
    const limitedUntilMs = getLimitedUntilMs(pluginStates[id], nowMs)

    let providerBars = (barsById.get(id) ?? []).filter(
      (bar): bar is TrayPrimaryBar & { label: string; fraction: number } =>
        typeof bar.label === "string" && typeof bar.fraction === "number"
    )
    if (widgetMetric === WIDGET_METRIC_SUGESTAO) {
      providerBars = filterSugestaoBars(id, meta.name, providerBars)
    }
    if (widgetMetric === WIDGET_METRIC_MOST_USED && providerBars.length > 1) {
      providerBars = [
        providerBars.reduce((max, bar) => (bar.fraction > max.fraction ? bar : max)),
      ]
    }

    const primary = providerBars[0]
    rows.push({
      id,
      name: meta.name,
      iconUrl: meta.iconUrl,
      brandColor: meta.brandColor,
      fraction: typeof primary?.fraction === "number" ? primary.fraction : null,
      expectedFraction: typeof primary?.expectedFraction === "number" ? primary.expectedFraction : null,
      tone:
        limitedUntilMs !== undefined
          ? "behind"
          : paceTone(primary?.usedFraction, primary?.expectedFraction),
      metrics: multiMode
        ? providerBars.map((bar) => ({
            label: bar.label,
            fraction: bar.fraction,
            expectedFraction: typeof bar.expectedFraction === "number" ? bar.expectedFraction : null,
            hidePercentSign: widgetMetric === WIDGET_METRIC_SUGESTAO,
            tone: paceTone(bar.usedFraction, bar.expectedFraction),
          }))
        : undefined,
      limitedUntilMs,
    })
  }

  return rows
}
