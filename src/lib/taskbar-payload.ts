import type { MenuBarWidgetBackdrop } from "@/lib/settings"
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

/** macOS: native blur drawn under the widget image (the PNG itself never blurs). */
export type TaskbarBackdrop = {
  /** 0..1 strength (alpha of the native blur view). */
  blur: number
  /** Corner radius in pt. */
  radius: number
  /** Size of the widget image in pt. */
  widthPt: number
  heightPt: number
}

/** Windows: raw widget pixels (straight, non-premultiplied RGBA, base64) drawn natively on the taskbar. */
export type WidgetRgbaImage = { width: number; height: number; rgba: string }

export type TaskbarPayload = {
  providers: TaskbarProvider[]
  tooltip: string
  /** macOS: base64 PNG (no data: prefix) of the pre-rendered menu bar widget. */
  menuBarImage?: string | null
  /** macOS: native blur behind the image; null when the background is off or its blur is 0. */
  menuBarBackdrop?: TaskbarBackdrop | null
  /** Windows: the pre-rendered widget (rendered at MENU_BAR_RENDER_SCALE); null falls back to the native text layout. */
  widgetImage?: WidgetRgbaImage | null
}

type TaskbarProviderDraft = Omit<TaskbarProvider, "iconMask"> & { iconUrl: string }

function buildItems(row: WidgetRow): TaskbarItem[] {
  if (typeof row.limitedUntilMs === "number") {
    return [{ label: "", value: formatAvailableAt(row.limitedUntilMs), tone: "neutral" }]
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
  return [
    {
      label: "",
      value: formatUsageText(row.fraction, row.expectedFraction),
      tone: row.tone,
    },
  ]
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

/** Native blur request for the rendered image, or null when the background is disabled or its blur is 0. */
export function buildMenuBarBackdrop(
  backdrop: MenuBarWidgetBackdrop,
  size: { width: number; height: number } | null,
  radius: number
): TaskbarBackdrop | null {
  if (!backdrop.enabled || backdrop.blur <= 0 || !size) return null
  return { blur: backdrop.blur / 100, radius, widthPt: size.width, heightPt: size.height }
}
