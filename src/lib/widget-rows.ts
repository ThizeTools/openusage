import type { PluginMeta, PluginOutput } from "@/lib/plugin-types"
import type { PluginState } from "@/hooks/app/types"
import {
  DEFAULT_PACE_THRESHOLDS,
  type PaceThresholds,
  type PluginSettings,
  type WidgetProviderIds,
  type WidgetProviderMetrics,
} from "@/lib/settings"
import { expectedFractionForLine, type ProgressLine } from "@/lib/tray-primary-progress"
import { clamp01 } from "@/lib/utils"

/** Pace tone, mirroring the tray icon tint. */
export type WidgetTone = "ahead" | "on-track" | "behind" | "neutral"

/** One labeled metric value shown in a widget row. */
export type WidgetRowMetric = {
  label: string
  fraction: number
  expectedFraction?: number | null
  tone: WidgetTone
}

export type WidgetRow = {
  id: string
  name: string
  iconUrl: string
  brandColor?: string
  /** Used 0..1 fraction of the first shown metric. null when no data. */
  fraction: number | null
  /** Expected 0..1 fraction of the first shown metric pace. */
  expectedFraction?: number | null
  /** Color tone derived from pace; "neutral" when unknown. */
  tone: WidgetTone
  /** Selected metrics that have data, in the plugin's line order. */
  metrics?: WidgetRowMetric[]
  /**
   * When ANY of the provider's limits is reached (even one not shown, e.g. the
   * 5h session while the widget shows Weekly): the moment the provider becomes
   * available again (ms). Undefined when nothing is capped.
   */
  limitedUntilMs?: number
}

/** Suggested metrics per base plugin id (account suffix removed), in widget order. */
const SUGESTAO_LABELS_BY_PROVIDER: Record<string, string[] | undefined> = {
  claude: ["Session", "Weekly"],
  codex: ["Session", "Weekly", "Spark", "Spark Weekly"],
  cursor: ["Total Usage"],
}

/** Plugin id without its account suffix: "claude@1a2b3c4d" -> "claude". */
function getBaseProviderId(id: string): string {
  return id.split("@")[0]
}

/**
 * Progress labels declared by the plugin manifest, in manifest order, without
 * duplicates. Feeds the per-provider metric checkboxes in Settings.
 */
export function getProviderMetricOptions(meta: PluginMeta): string[] {
  const labels: string[] = []
  for (const line of meta.lines) {
    if (line.type !== "progress" || labels.includes(line.label)) continue
    labels.push(line.label)
  }
  return labels
}

function findProgressLine(output: PluginOutput, label: string): ProgressLine | undefined {
  return output.lines.find(
    (line): line is ProgressLine => line.type === "progress" && line.label === label
  )
}

function hasSparkUsage(output: PluginOutput, label: string): boolean {
  const line = findProgressLine(output, label)
  return line !== undefined && line.limit > 0 && line.used > 0
}

/**
 * Metrics shown for a provider the user has not configured. Known providers use
 * their suggestion list; with output, Spark metrics stay out until they have
 * usage. Other providers use their first two primary candidates.
 */
export function getDefaultProviderMetrics(meta: PluginMeta, output?: PluginOutput | null): string[] {
  const suggested = SUGESTAO_LABELS_BY_PROVIDER[getBaseProviderId(meta.id)]
  if (suggested) {
    if (!output) return [...suggested]
    return suggested.filter(
      (label) => !label.toLowerCase().startsWith("spark") || hasSparkUsage(output, label)
    )
  }
  // Same tolerance as tray-primary-progress: some plugin metas omit primaryCandidates.
  const candidates = meta.primaryCandidates ?? []
  if (candidates.length > 0) return candidates.slice(0, 2)
  return getProviderMetricOptions(meta).slice(0, 2)
}

/** Pace tone matching the tray icon (getTrayTintColor); the limits come from the pace thresholds. */
export function paceTone(
  usedFraction?: number,
  expectedFraction?: number,
  thresholds: PaceThresholds = DEFAULT_PACE_THRESHOLDS
): WidgetTone {
  if (typeof usedFraction !== "number" || !Number.isFinite(usedFraction)) return "neutral"
  if (usedFraction >= 1) return "behind"
  if (typeof expectedFraction !== "number" || !Number.isFinite(expectedFraction) || expectedFraction <= 0) {
    return "neutral"
  }
  const projectedUsage = usedFraction / expectedFraction
  if (projectedUsage <= thresholds.healthy / 100) return "ahead"
  if (projectedUsage <= thresholds.closeToLimit / 100) return "on-track"
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

/** Selected metrics that have a limit in the output, in manifest order. */
function buildSelectedMetrics(
  meta: PluginMeta,
  output: PluginOutput | null,
  selected: string[],
  nowMs: number,
  thresholds: PaceThresholds
): WidgetRowMetric[] {
  if (!output) return []
  const metrics: WidgetRowMetric[] = []
  for (const label of getProviderMetricOptions(meta)) {
    if (!selected.includes(label)) continue
    const line = findProgressLine(output, label)
    if (!line || !(line.limit > 0)) continue
    const fraction = clamp01(line.used / line.limit)
    const expectedFraction = expectedFractionForLine(line, nowMs)
    metrics.push({
      label,
      fraction,
      expectedFraction: expectedFraction ?? null,
      tone: paceTone(fraction, expectedFraction, thresholds),
    })
  }
  return metrics
}

/**
 * Builds one row per enabled provider for the taskbar widget. Each row shows the
 * metrics the user picked for that provider (or the default selection). A
 * provider with an empty selection is left out. When any of the provider's
 * limits is reached, the row carries the time it becomes available again instead.
 */
export function buildWidgetRows(args: {
  pluginsMeta: PluginMeta[]
  pluginSettings: PluginSettings | null
  pluginStates: Record<string, PluginState | undefined>
  widgetProviderIds?: WidgetProviderIds
  widgetProviderMetrics?: WidgetProviderMetrics
  paceThresholds?: PaceThresholds
  nowMs?: number
}): WidgetRow[] {
  const { pluginsMeta, pluginSettings, pluginStates, widgetProviderIds, widgetProviderMetrics = {} } = args
  const paceThresholds = args.paceThresholds ?? DEFAULT_PACE_THRESHOLDS
  const nowMs = args.nowMs ?? Date.now()
  if (!pluginSettings) return []

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

    const output = pluginStates[id]?.data ?? null
    const selected = widgetProviderMetrics[id] ?? getDefaultProviderMetrics(meta, output)
    if (selected.length === 0) continue

    const limitedUntilMs = getLimitedUntilMs(pluginStates[id], nowMs)
    const metrics = buildSelectedMetrics(meta, output, selected, nowMs, paceThresholds)
    const primary = metrics[0]
    rows.push({
      id,
      name: meta.name,
      iconUrl: meta.iconUrl,
      brandColor: meta.brandColor,
      fraction: primary?.fraction ?? null,
      expectedFraction: primary?.expectedFraction ?? null,
      tone: limitedUntilMs !== undefined ? "behind" : (primary?.tone ?? "neutral"),
      metrics,
      limitedUntilMs,
    })
  }

  return rows
}
