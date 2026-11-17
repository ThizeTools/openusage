import { formatAvailableAt, formatUsageText } from "@/lib/widget-format"
import type { WidgetRow } from "@/lib/widget-rows"

export type TaskbarItem = {
  label: string
  value: string
  tone: "ahead" | "on-track" | "behind" | "neutral"
}

export type TaskbarProvider = {
  id: string
  brandColor?: string
  iconMask?: string | null
  items: TaskbarItem[]
}

export type TaskbarPayload = {
  providers: TaskbarProvider[]
  tooltip: string
}

type TaskbarProviderDraft = Omit<TaskbarProvider, "iconMask"> & { iconUrl: string }

function buildItems(row: WidgetRow): TaskbarItem[] {
  if (typeof row.limitedUntilMs === "number") {
    return [{ label: "", value: formatAvailableAt(row.limitedUntilMs), tone: "behind" }]
  }
  if (row.metrics?.length) {
    return row.metrics.map((metric) => ({
      label: metric.label,
      value: formatUsageText(metric.fraction, metric.expectedFraction),
      tone: metric.tone,
    }))
  }
  if (row.fraction === null) {
    return [{ label: "", value: "—", tone: "neutral" }]
  }
  return [{ label: "", value: formatUsageText(row.fraction, row.expectedFraction), tone: row.tone }]
}

function buildTooltipLine(row: WidgetRow, items: TaskbarItem[]): string {
  if (typeof row.limitedUntilMs === "number") {
    return `${row.name}: limit reached — available ${formatAvailableAt(row.limitedUntilMs)}`
  }
  const parts = items.map((item) => (item.label ? `${item.label} ` : "") + item.value)
  return `${row.name}: ${parts.join(" · ")}`
}

/** Builds the taskbar widget payload (icon masks are resolved separately). */
export function buildTaskbarPayload(rows: WidgetRow[]): Omit<TaskbarPayload, "providers"> & {
  providers: TaskbarProviderDraft[]
} {
  const providers: TaskbarProviderDraft[] = []
  const tooltipLines = ["OpenUsage"]
  for (const row of rows) {
    const items = buildItems(row)
    providers.push({ id: row.id, brandColor: row.brandColor, iconUrl: row.iconUrl, items })
    tooltipLines.push(buildTooltipLine(row, items))
  }
  return { providers, tooltip: tooltipLines.join("\n") }
}
