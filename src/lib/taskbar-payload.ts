import type { MenuBarWidgetBackdrop } from "@/lib/settings"
import { formatAvailableAt, formatUsageText } from "@/lib/widget-format"
import type { WidgetRow } from "@/lib/widget-rows"

export type TaskbarItem = {
  label: string
  value: string
  tone: "ahead" | "on-track" | "behind" | "neutral"
  /** Used 0..1 fraction (the Dock overlay draws it); null when the item has none. */
  fraction?: number | null
  expectedFraction?: number | null
}

export type TaskbarProvider = {
  id: string
  brandColor?: string
  iconMask?: string | null
  items: TaskbarItem[]
  /** Claude accounts (2+ registered): the account name drawn with the usage. */
  accountName?: string
}

/** Blur under the widget's background card (macOS: native blur view; Windows: blurred wallpaper drawn natively). */
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

/** macOS: pre-rendered Dock overlay (140x140 unit canvas, see dock-overlay-image.ts) for the apps with these bundle ids.
 * `accountId` (Claude accounts): only the Dock tile of the app copy signed in to that OpenUsage account gets it. */
export type DockOverlay = {
  bundleIds: string[]
  png: string
  accountId?: string
}

export type TaskbarPayload = {
  providers: TaskbarProvider[]
  tooltip: string
  /** macOS: base64 PNG (no data: prefix) of the pre-rendered menu bar widget. */
  menuBarImage?: string | null
  /** Blur under the image (macOS and Windows); null when the background is off or its blur is 0. */
  menuBarBackdrop?: TaskbarBackdrop | null
  /** Windows: the pre-rendered widget (rendered at MENU_BAR_RENDER_SCALE); null falls back to the native text layout. */
  widgetImage?: WidgetRgbaImage | null
  /** macOS: one overlay per provider app in the Dock; empty (or null) removes them all. */
  dockOverlays?: DockOverlay[] | null
}

type TaskbarProviderDraft = Omit<TaskbarProvider, "iconMask"> & { iconUrl: string }

function buildItems(row: WidgetRow): TaskbarItem[] {
  if (typeof row.limitedUntilMs === "number") {
    return [{ label: "", value: formatAvailableAt(row.limitedUntilMs), tone: "neutral", fraction: null, expectedFraction: null }]
  }
  if (row.metrics?.length) {
    return row.metrics.map((metric) => ({
      label: metric.label,
      value: formatUsageText(metric.fraction, metric.expectedFraction),
      tone: metric.tone,
      fraction: metric.fraction,
      expectedFraction: metric.expectedFraction ?? null,
    }))
  }
  if (row.fraction === null) {
    return [{ label: "", value: "—", tone: "neutral", fraction: null, expectedFraction: null }]
  }
  return [
    {
      label: "",
      value: formatUsageText(row.fraction, row.expectedFraction),
      tone: row.tone,
      fraction: row.fraction,
      expectedFraction: row.expectedFraction ?? null,
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
