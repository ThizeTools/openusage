import { defaultToneColors } from "@/lib/menubar-widget-image"
import type {
  DockOverlayAccountLabel,
  MenuBarWidgetColors,
  MenuBarWidgetTextColors,
  MenuBarWidgetToneModes,
} from "@/lib/settings"
import type { TaskbarProvider } from "@/lib/taskbar-payload"

/**
 * Dock overlay geometry, in units. Rust depends on it: the PNG canvas is DOCK_OVERLAY_CANVAS units wide and tall and
 * the Dock icon tile (the square the app icon artwork is drawn in) sits at (TILE_OFFSET, TILE_OFFSET) inside it.
 */
export const DOCK_OVERLAY_TILE = 100
export const DOCK_OVERLAY_CANVAS = 140
/** Render scale: pixels per unit. */
export const DOCK_OVERLAY_SCALE = 3

const TILE_OFFSET = (DOCK_OVERLAY_CANVAS - DOCK_OVERLAY_TILE) / 2
/** The visible icon squircle inside the tile. */
const SQ = { x: TILE_OFFSET + 9.75, y: TILE_OFFSET + 9.75, size: 80.5, radius: 18.5 }
const SQ_CENTER_X = SQ.x + SQ.size / 2
const SQ_BOTTOM = SQ.y + SQ.size

const NUMBER_FONT = 'ui-rounded, -apple-system, BlinkMacSystemFont, "SF Pro Rounded", system-ui, sans-serif'
const LABEL_FONT = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif'
const NEUTRAL_TONE = "#f2f2f2"
const EXPECTED_SCALE = 0.82
const EXPECTED_ALPHA = 0.6
/** Baseline offset below a row's vertical middle, as a fraction of the font size. */
const BASELINE_FACTOR = 0.36

export type DockOverlayOptions = {
  colors: MenuBarWidgetColors
  toneModes: MenuBarWidgetToneModes
  /** Mono / Color per text part, same rules as the menu bar widget. Missing → label mono, used color, expected mono. */
  textColors?: MenuBarWidgetTextColors
  /** Draws the account name too (style + name). */
  account?: { mode: DockOverlayAccountLabel; name: string }
}

/** Widest an account name may be drawn, in units. */
const ACCOUNT_NAME_MAX_WIDTH = 112
/** Dark fill and stroke shared by the usage pill and the account name shapes. */
const SHAPE_FILL = "rgba(30,30,34,0.9)"
const SHAPE_STROKE = "rgba(255,255,255,0.18)"

const DEFAULT_TEXT_COLORS: MenuBarWidgetTextColors = { label: "mono", used: "color", expected: "mono" }
const MONO = "#f2f2f2"

/** `#rrggbb` → `rgba(r,g,b,alpha)`. */
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1, 7), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/**
 * Fill of each part of a pill line, following the menu bar rules: a part set to "color" uses the line's tone color
 * (unless that tone is mono), otherwise white. Label 0.6 / 0.85 alpha, expected 0.55 / 0.6 alpha.
 */
export function dockTextFills(toneColor: string, textColors: MenuBarWidgetTextColors) {
  const toned = toneColor.toLowerCase() !== MONO
  const pick = (mode: "mono" | "color", alpha: number, monoAlpha: number) =>
    mode === "color" && toned ? withAlpha(toneColor, alpha) : `rgba(255,255,255,${monoAlpha})`
  return {
    label: pick(textColors.label, 0.85, 0.6),
    used: pick(textColors.used, 1, 1),
    expected: pick(textColors.expected, 0.6, 0.55),
  }
}

/** One metric shown on the overlay. */
export type DockMetric = {
  label: string
  tone: string
  fraction: number
  expectedFraction: number | null
  used: number
  expected: number | null
}

type Run = { text: string; weight: 500 | 600 | 700; scale: number; alpha: number }

const TONE_KEYS = { ahead: "ahead", "on-track": "onTrack", behind: "behind" } as const

/** Tone color: neutral/unknown and "mono" tones use the neutral light color, others the custom or built-in color. */
export function dockToneColor(tone: string, colors: MenuBarWidgetColors, toneModes: MenuBarWidgetToneModes): string {
  const key = TONE_KEYS[tone as keyof typeof TONE_KEYS]
  if (!key || toneModes[key] === "mono") return NEUTRAL_TONE
  return colors[key] ?? defaultToneColors(true)[key]
}

/** First 2 items with a finite fraction, with their rounded percentages. */
export function selectDockMetrics(provider: TaskbarProvider): DockMetric[] {
  const metrics: DockMetric[] = []
  for (const item of provider.items) {
    if (typeof item.fraction !== "number" || !Number.isFinite(item.fraction)) continue
    const expectedFraction =
      typeof item.expectedFraction === "number" && Number.isFinite(item.expectedFraction) ? item.expectedFraction : null
    metrics.push({
      label: item.label,
      tone: item.tone,
      fraction: item.fraction,
      expectedFraction,
      used: Math.round(item.fraction * 100),
      expected: expectedFraction === null ? null : Math.round(expectedFraction * 100),
    })
    if (metrics.length === 2) break
  }
  return metrics
}

/** "Session" -> "S"; empty -> "". */
export function shortLabel(label: string): string {
  return label.trim().charAt(0).toUpperCase()
}

/** Value text as styled runs: "42" bold then "/38" lighter and smaller; without an expected value "42%" in one run. */
export function valueRuns(metric: Pick<DockMetric, "used" | "expected">): Run[] {
  if (metric.expected === null) return [{ text: `${metric.used}%`, weight: 700, scale: 1, alpha: 1 }]
  return [
    { text: `${metric.used}`, weight: 700, scale: 1, alpha: 1 },
    { text: `/${metric.expected}`, weight: 500, scale: EXPECTED_SCALE, alpha: EXPECTED_ALPHA },
  ]
}

type Ctx = CanvasRenderingContext2D

function runFont(run: Run, size: number, family: string): string {
  return `${run.weight} ${size * run.scale}px ${family}`
}

function runsWidth(ctx: Ctx, runs: Run[], size: number): number {
  let total = 0
  for (const run of runs) {
    ctx.font = runFont(run, size, NUMBER_FONT)
    total += ctx.measureText(run.text).width
  }
  return total
}

/** Draws the runs starting at x (left aligned) on the given baseline. Returns the x after the last run. */
function drawRuns(ctx: Ctx, runs: Run[], x: number, baseline: number, size: number, fills: string[]): number {
  runs.forEach((run, i) => {
    ctx.font = runFont(run, size, NUMBER_FONT)
    ctx.fillStyle = fills[i] ?? fills[0]
    ctx.fillText(run.text, x, baseline)
    x += ctx.measureText(run.text).width
  })
  return x
}

function labelWidth(ctx: Ctx, text: string, size: number): number {
  if (!text) return 0
  ctx.font = `600 ${size}px ${LABEL_FONT}`
  return ctx.measureText(text).width
}

function drawLabel(ctx: Ctx, text: string, x: number, baseline: number, size: number, color: string) {
  ctx.font = `600 ${size}px ${LABEL_FONT}`
  ctx.fillStyle = color
  ctx.fillText(text, x, baseline)
}

function pillPath(ctx: Ctx, x: number, y: number, w: number, h: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, Math.min(h / 2, 11))
}

/** `text` cut with "…" so it fits `maxWidth` in the context's current font; whole when it already fits. */
export function fitText(ctx: Pick<Ctx, "measureText">, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let cut = Array.from(text)
  while (cut.length > 0 && ctx.measureText(cut.join("") + "…").width > maxWidth) cut = cut.slice(0, -1)
  return cut.join("") + "…"
}

/** Fills and strokes the current path with the dark shape style of the usage pill. */
function paintShape(ctx: Ctx, stroke = SHAPE_STROKE, lineWidth = 0.8) {
  ctx.fillStyle = SHAPE_FILL
  ctx.fill()
  ctx.lineWidth = lineWidth
  ctx.strokeStyle = stroke
  ctx.stroke()
}

function drawPill(
  ctx: Ctx,
  metrics: DockMetric[],
  toneColors: string[],
  textColors: MenuBarWidgetTextColors,
  title?: string
) {
  // Sized to stay readable at the Dock's small icon size (1 unit ≈ 0.58pt at the default 58pt tile).
  const labelSize = 12.5
  const valueSize = 16
  const items = metrics.map((metric) => {
    const label = shortLabel(metric.label)
    const runs = valueRuns(metric)
    const labelW = labelWidth(ctx, label, labelSize)
    return { label, runs, labelW, width: (label ? labelW + 3 : 0) + runsWidth(ctx, runs, valueSize) }
  })
  // The account name (when given) is an extra first line above the metrics.
  const titleSize = labelSize
  const titleH = title ? titleSize + 3 : 0
  // fitText measures with the current font: set the title's before cutting.
  ctx.font = `600 ${titleSize}px ${LABEL_FONT}`
  const titleText = title ? fitText(ctx, title, ACCOUNT_NAME_MAX_WIDTH) : ""
  const titleW = title ? labelWidth(ctx, titleText, titleSize) : 0
  // One line per metric, stacked; extra lines grow upward. The pill's bottom edge sits just below the icon.
  const lineH = valueSize + 2
  const w = Math.max(Math.max(...items.map((item) => item.width)) + 16, title ? titleW + 16 : 0)
  const h = items.length * lineH + 5 + titleH
  const bottom = SQ_BOTTOM + 7.7 + 1.5
  const top = bottom - h
  const left = SQ_CENTER_X - w / 2

  pillPath(ctx, left, top, w, h)
  paintShape(ctx)

  if (title) {
    ctx.textAlign = "center"
    const titleBaseline = top + 2.5 + titleH / 2 + titleSize * BASELINE_FACTOR
    drawLabel(ctx, titleText, SQ_CENTER_X, titleBaseline, titleSize, "rgba(255,255,255,0.85)")
    ctx.textAlign = "left"
  }

  items.forEach((item, i) => {
    const cy = top + 2.5 + titleH + lineH * (i + 0.5)
    const baseline = cy + valueSize * BASELINE_FACTOR
    const fills = dockTextFills(toneColors[i], textColors)
    let x = left + 8
    if (item.label) {
      drawLabel(ctx, item.label, x, baseline, labelSize, fills.label)
      x += item.labelW + 3
    }
    // One run = "42%" (used only); two runs = "42" + "/38".
    drawRuns(ctx, item.runs, x, baseline, valueSize, [fills.used, fills.expected])
  })
}

/** "initial": round badge at the icon's top-left corner with the name's first letter. */
function drawInitialBadge(ctx: Ctx, name: string) {
  const letter = Array.from(name.trim())[0]?.toUpperCase()
  if (!letter) return
  const cx = SQ.x + 4
  const cy = SQ.y + 4
  ctx.beginPath()
  ctx.arc(cx, cy, 12, 0, Math.PI * 2)
  paintShape(ctx, "rgba(255,255,255,0.35)", 1)
  ctx.textAlign = "center"
  drawLabel(ctx, letter, cx, cy + 15 * BASELINE_FACTOR, 15, NEUTRAL_TONE)
  ctx.textAlign = "left"
}

/** "tag": small pill centered on the icon's top edge with the (truncated) name. */
function drawNameTag(ctx: Ctx, name: string) {
  const size = 12.5
  ctx.font = `600 ${size}px ${LABEL_FONT}`
  const text = fitText(ctx, name.trim(), ACCOUNT_NAME_MAX_WIDTH)
  if (!text) return
  const w = labelWidth(ctx, text, size) + 14
  const h = 17
  const cy = SQ.y - 1
  const left = SQ_CENTER_X - w / 2
  ctx.beginPath()
  ctx.roundRect(left, cy - h / 2, w, h, h / 2)
  paintShape(ctx)
  drawLabel(ctx, text, left + 7, cy + size * BASELINE_FACTOR, size, NEUTRAL_TONE)
}

/**
 * Renders a provider's Dock overlay to a transparent PNG (base64, no data: prefix) on a DOCK_OVERLAY_CANVAS x
 * DOCK_OVERLAY_CANVAS unit canvas at DOCK_OVERLAY_SCALE px per unit. With `opts.account` the account name is drawn
 * too. Null when the provider has no numeric fraction or the canvas is unavailable.
 */
export async function renderDockOverlayPng(
  provider: TaskbarProvider,
  opts: DockOverlayOptions
): Promise<string | null> {
  const metrics = selectDockMetrics(provider)
  if (metrics.length === 0) return null

  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = DOCK_OVERLAY_CANVAS * DOCK_OVERLAY_SCALE
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.scale(DOCK_OVERLAY_SCALE, DOCK_OVERLAY_SCALE)
  ctx.textBaseline = "alphabetic"

  const colors = metrics.map((metric) => dockToneColor(metric.tone, opts.colors, opts.toneModes))
  const account = opts.account
  const title = account?.mode === "pill" ? account.name.trim() : undefined
  drawPill(ctx, metrics, colors, opts.textColors ?? DEFAULT_TEXT_COLORS, title || undefined)
  if (account?.mode === "initial") drawInitialBadge(ctx, account.name)
  if (account?.mode === "tag") drawNameTag(ctx, account.name)

  const dataUrl = canvas.toDataURL("image/png")
  const comma = dataUrl.indexOf(",")
  return comma >= 0 ? dataUrl.slice(comma + 1) : null
}
