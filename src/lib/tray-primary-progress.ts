import type { PluginMeta, PluginOutput } from "@/lib/plugin-types"
import type { PluginSettings } from "@/lib/settings"
import { clamp01 } from "@/lib/utils"

type PluginState = {
  data: PluginOutput | null
  loading: boolean
  error: string | null
}

export type TrayPrimaryBar = {
  id: string
  label?: string
  fraction?: number
  usedFraction?: number
  expectedFraction?: number
}

type ProgressLine = Extract<
  PluginOutput["lines"][number],
  { type: "progress"; label: string; used: number; limit: number }
>

function isProgressLine(line: PluginOutput["lines"][number]): line is ProgressLine {
  return line.type === "progress"
}

function expectedFractionForLine(line: ProgressLine, nowMs: number): number | undefined {
  if (!line.resetsAt || typeof line.periodDurationMs !== "number") return undefined
  if (!Number.isFinite(line.periodDurationMs) || line.periodDurationMs <= 0) return undefined
  const resetsAtMs = Date.parse(line.resetsAt)
  if (!Number.isFinite(resetsAtMs)) return undefined
  const elapsedMs = nowMs - (resetsAtMs - line.periodDurationMs)
  return clamp01(elapsedMs / line.periodDurationMs)
}

export function getTrayPrimaryBars(args: {
  pluginsMeta: PluginMeta[]
  pluginSettings: PluginSettings | null
  pluginStates: Record<string, PluginState | undefined>
  maxBars?: number
  pluginId?: string
  nowMs?: number
  includeAllOverview?: boolean
  preferredLabels?: string[]
  preferredLabelsOnly?: boolean
  includeAllMatches?: boolean
}): TrayPrimaryBar[] {
  const {
    pluginsMeta,
    pluginSettings,
    pluginStates,
    maxBars = 4,
    pluginId,
    nowMs = Date.now(),
    includeAllOverview = false,
    preferredLabels,
    preferredLabelsOnly = false,
    includeAllMatches = false,
  } = args
  if (!pluginSettings) return []

  const metaById = new Map(pluginsMeta.map((p) => [p.id, p]))
  const disabled = new Set(pluginSettings.disabled)
  const orderedIds = pluginId
    ? [pluginId]
    : pluginSettings.order

  const out: TrayPrimaryBar[] = []
  for (const id of orderedIds) {
    if (disabled.has(id)) continue
    const meta = metaById.get(id)
    if (!meta) continue
    
    const overviewLabels = meta.lines
      .filter((line) => line.type === "progress" && line.scope === "overview")
      .map((line) => line.label)
    const fallbackLabels = includeAllOverview ? overviewLabels : (meta.primaryCandidates ?? [])
    const candidateLabels =
      preferredLabels && preferredLabels.length > 0
        ? preferredLabelsOnly
          ? preferredLabels
          : [
              ...preferredLabels,
              ...fallbackLabels.filter((label) => !preferredLabels.includes(label)),
            ]
        : fallbackLabels

    // Skip if no primary candidates defined
    if (!candidateLabels || candidateLabels.length === 0) continue

    const state = pluginStates[id]
    const data = state?.data ?? null

    const addLine = (line: ProgressLine | undefined) => {
      if (line && line.limit > 0) {
        const usedFraction = clamp01(line.used / line.limit)
        const expectedFraction = expectedFractionForLine(line, nowMs)
        out.push({
          id,
          label: line.label,
          fraction: usedFraction,
          usedFraction,
          expectedFraction,
        })
      } else {
        out.push({ id, label: undefined, fraction: undefined, usedFraction: undefined, expectedFraction: undefined })
      }
    }

    if (data) {
      const matchedLabels = candidateLabels.filter((label) =>
        data.lines.some((line) => isProgressLine(line) && line.label === label)
      )
      const labels = includeAllMatches ? matchedLabels : matchedLabels.slice(0, 1)
      for (const label of labels) {
        addLine(data.lines.find(
          (line): line is ProgressLine =>
            isProgressLine(line) && line.label === label
        ))
        if (out.length >= maxBars) break
      }
      if (labels.length === 0) addLine(undefined)
    } else {
      addLine(undefined)
    }

    if (out.length >= maxBars) break
  }

  return out
}

