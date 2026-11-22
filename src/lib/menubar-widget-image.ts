import type {
  MenuBarAccountLabel,
  MenuBarWidgetBackdrop,
  MenuBarWidgetColors,
  MenuBarWidgetStyle,
  MenuBarWidgetTextColors,
  MenuBarWidgetToneModes,
} from "@/lib/settings"
import { badgeLetter, fitName } from "@/lib/menubar-account-label"
import { isWindowsPlatform } from "@/lib/platform"
import type { TaskbarItem, TaskbarPayload, WidgetRgbaImage } from "@/lib/taskbar-payload"

/** Menu bar widget geometry in logical points (the PNG is shown 22pt tall, see taskbar/mac.rs). */
export const MENU_BAR_METRICS = {
  height: 22,
  /** Horizontal padding without a background. */
  pad: 3,
  /** Horizontal padding when the background card is drawn. */
  cardPad: 8,
  cardRadius: 7,
  /** Icon box of the single-row styles. */
  icon: 16,
  iconGap: 5,
} as const

/** Label color alpha (content color), same for every style. */
const LABEL_ALPHA = 0.62
/** The "/expected" part of a value: same tone color at this alpha, at EXPECTED_SCALE of the value size. */
const EXPECTED_ALPHA = 0.6
const EXPECTED_SCALE = 0.82
/** Label alpha when the label is drawn in the row's tone color ("color" mode). */
const LABEL_TONE_ALPHA = 0.85
/** The "/expected" part in content color ("mono" mode). */
const EXPECTED_MONO_ALPHA = 0.55
/** Baseline offset from the vertical middle of a row, as a fraction of the value size (font metrics approximation). */
const BASELINE_FACTOR = 0.35

/** Per-style geometry. Font sizes in pt. Labels ("S", "Weekly") are as small as the "/expected" part. */
export const STYLE_METRICS = {
  stacked: {
    labelSize: 9.5 * EXPECTED_SCALE,
    fontSize: 9.5,
    rowHeight: 9.5,
    icon: 15,
    labelGap: 3,
    colGap: 9,
    provGap: 12,
    labelAlpha: LABEL_ALPHA,
  },
  compact: {
    labelSize: 9.5 * EXPECTED_SCALE,
    fontSize: 9.5,
    rowHeight: 9.5,
    icon: 15,
    labelGap: 2,
    colGap: 6,
    provGap: 10,
    labelAlpha: LABEL_ALPHA,
  },
  inline: {
    labelSize: 12.5 * EXPECTED_SCALE,
    fontSize: 12.5,
    icon: 16,
    labelGap: 4,
    sepGap: 6,
    provGap: 16,
    labelAlpha: LABEL_ALPHA,
    sepAlpha: 120 / 255,
  },
  "inline-compact": {
    labelSize: 12.5 * EXPECTED_SCALE,
    fontSize: 12.5,
    icon: 16,
    labelGap: 3,
    sepGap: 4,
    provGap: 12,
    labelAlpha: LABEL_ALPHA,
    sepAlpha: 120 / 255,
  },
} as const

const MASK_SIDE = 64

/** Canvas font family (system UI font). */
export const MENU_BAR_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'

export type FontWeight = 500 | 600 | 700
export type MeasureText = (text: string, weight: FontWeight, size: number) => number

/** Same as DEFAULT_MENU_BAR_WIDGET_TEXT_COLORS (not imported: settings pulls in the Tauri store). */
const DEFAULT_TEXT_COLORS: MenuBarWidgetTextColors = { label: "mono", used: "color", expected: "mono" }
const DEFAULT_TONE_MODES: MenuBarWidgetToneModes = { ahead: "mono", onTrack: "color", behind: "color" }

/** Which part of a metric a text run is; decides how `menuBarWidgetTextColors` applies. Separators have none. */
export type MenuBarTextPart = "label" | "used" | "expected"

/** Text run drawn on an alphabetic baseline. `tone` set → tone color (neutral/unknown falls back to the content color). */
export type MenuBarText = {
  type: "text"
  text: string
  x: number
  /** Alphabetic baseline of the run. */
  baseline: number
  size: number
  weight: FontWeight
  align: "left" | "center"
  tone?: string
  /** Part of the metric this run belongs to (unset for separators). */
  part?: MenuBarTextPart
  /** Tone of the row a label belongs to (labels carry no `tone` of their own, so they stay content-colored by default). */
  rowTone?: string
  /** Alpha (0..1) applied to the tone color, or to the content color when `tone` is not set. */
  alpha: number
}

export type MenuBarShape = MenuBarText

export type MenuBarProviderLayout = {
  x: number
  brandColor?: string
  iconMask: Uint8Array | null
  icon: { x: number; y: number; size: number } | null
  /** Round badge with the account's first letter on the icon's bottom-right corner ("initial" account label). */
  badge?: { cx: number; cy: number; r: number; letter: string }
  /** Where the items start (right of the icon, and of the account name when it sits beside the icon). */
  contentX: number
  width: number
  shapes: MenuBarShape[]
}

export type MenuBarLayout = {
  width: number
  height: number
  providers: MenuBarProviderLayout[]
}

/** 64x64 alpha mask (base64) → bytes, or null when missing/malformed. */
export function decodeIconMask(base64: string | null | undefined): Uint8Array | null {
  if (!base64) return null
  try {
    const binary = atob(base64)
    if (binary.length !== MASK_SIDE * MASK_SIDE) return null
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/** Horizontal padding: wider when the background card is drawn. */
export function menuBarPad(backdrop: Pick<MenuBarWidgetBackdrop, "enabled">): number {
  return backdrop.enabled ? MENU_BAR_METRICS.cardPad : MENU_BAR_METRICS.pad
}

/** The menu bar widget shows bare numbers: "13%/91%" → "13/91". */
export function stripPercent(value: string): string {
  return value.replace(/%/g, "")
}

type StyleContent = { shapes: MenuBarShape[]; width: number }

function text(
  value: string,
  x: number,
  baseline: number,
  size: number,
  weight: FontWeight,
  extra: { tone?: string; alpha?: number; align?: "left" | "center"; part?: MenuBarTextPart; rowTone?: string } = {}
): MenuBarText {
  return {
    type: "text",
    text: value,
    x,
    baseline,
    size,
    weight,
    align: extra.align ?? "left",
    tone: extra.tone,
    ...(extra.part !== undefined ? { part: extra.part } : {}),
    ...(extra.rowTone !== undefined ? { rowTone: extra.rowTone } : {}),
    alpha: extra.alpha ?? 1,
  }
}

/** Baseline that visually centers a row of `size` text on `midY`. */
function baselineFor(midY: number, size: number): number {
  return midY + size * BASELINE_FACTOR
}

/**
 * A metric value as rich segments: "13/91" → "13" (bold, tone) + "/91" (medium, 82% size, tone at 60%).
 * Values without "/" are a single bold run. Both segments share one baseline.
 */
function valueRuns(
  value: string,
  x: number,
  baseline: number,
  size: number,
  tone: string | undefined,
  measure: MeasureText
): { shapes: MenuBarText[]; width: number } {
  const slash = value.indexOf("/")
  if (slash < 0) {
    return { shapes: [text(value, x, baseline, size, 700, { tone, part: "used" })], width: measure(value, 700, size) }
  }
  const used = value.slice(0, slash)
  const expected = value.slice(slash)
  const expectedSize = size * EXPECTED_SCALE
  const shapes: MenuBarText[] = []
  let width = 0
  if (used) {
    shapes.push(text(used, x, baseline, size, 700, { tone, part: "used" }))
    width += measure(used, 700, size)
  }
  shapes.push(text(expected, x + width, baseline, expectedSize, 500, { tone, alpha: EXPECTED_ALPHA, part: "expected" }))
  width += measure(expected, 500, expectedSize)
  return { shapes, width }
}

/** Width of a value as laid out by `valueRuns`. */
function valueWidth(value: string, size: number, measure: MeasureText): number {
  return valueRuns(value, 0, 0, size, undefined, measure).width
}

/** One item of a column: its width and the shapes to draw at (x, baseline). */
type Cell = { width: number; draw: (x: number, baseline: number) => MenuBarShape[] }

/** Columns of up to two stacked cells; extra items wrap into new columns. */
function layoutColumns(
  items: TaskbarItem[],
  startX: number,
  s: { rowHeight: number; fontSize: number; colGap: number },
  cellFor: (item: TaskbarItem) => Cell
): StyleContent {
  const m = MENU_BAR_METRICS
  const shapes: MenuBarShape[] = []
  let x = startX
  for (let start = 0; start < items.length; start += 2) {
    const cells = items.slice(start, start + 2).map(cellFor)
    const top = (m.height - s.rowHeight * cells.length) / 2
    const colWidth = Math.max(...cells.map((c) => c.width))
    cells.forEach((cell, row) => {
      const midY = top + row * s.rowHeight + s.rowHeight / 2
      shapes.push(...cell.draw(x, baselineFor(midY, s.fontSize)))
    })
    x += colWidth
    if (start + 2 < items.length) x += s.colGap
  }
  return { shapes, width: x - startX }
}

/** Sizes of a lone line in the two-row styles: the one-row (inline) sizes. */
const SINGLE_LINE_SIZES = {
  labelSize: STYLE_METRICS.inline.labelSize,
  fontSize: STYLE_METRICS.inline.fontSize,
  rowHeight: STYLE_METRICS.inline.fontSize,
}

function twoRowContent(
  base: (typeof STYLE_METRICS)["stacked"] | (typeof STYLE_METRICS)["compact"],
  items: TaskbarItem[],
  x: number,
  measure: MeasureText,
  shorten: boolean
): StyleContent {
  // A provider with a single line (e.g. "limit reached: Fri 6:00 PM") has the full height to itself, so it is
  // drawn at the same size as the one-row styles instead of shrinking with the two-row ones.
  const s = items.length === 1 ? { ...base, ...SINGLE_LINE_SIZES } : base
  return layoutColumns(items, x, s, (item) => {
    const label = shorten ? (Array.from(item.label)[0] ?? "") : item.label
    const labelW = label ? measure(label, 500, s.labelSize) + s.labelGap : 0
    const valueW = valueWidth(item.value, s.fontSize, measure)
    return {
      width: labelW + valueW,
      draw: (cx, baseline) => [
        ...(label
          ? [text(label, cx, baseline, s.labelSize, 500, { alpha: s.labelAlpha, part: "label", rowTone: item.tone })]
          : []),
        ...valueRuns(item.value, cx + labelW, baseline, s.fontSize, item.tone, measure).shapes,
      ],
    }
  })
}

function stackedContent(items: TaskbarItem[], x: number, measure: MeasureText): StyleContent {
  return twoRowContent(STYLE_METRICS.stacked, items, x, measure, false)
}

function compactContent(items: TaskbarItem[], x: number, measure: MeasureText): StyleContent {
  return twoRowContent(STYLE_METRICS.compact, items, x, measure, true)
}

function inlineRow(
  s: { labelSize: number; fontSize: number; labelGap: number; sepGap: number; labelAlpha: number; sepAlpha: number },
  items: TaskbarItem[],
  x: number,
  measure: MeasureText,
  shorten: boolean,
  /** Alphabetic baseline of the row; default: centered in the bar. */
  rowBaseline?: number
): StyleContent {
  const baseline = rowBaseline ?? baselineFor(MENU_BAR_METRICS.height / 2, s.fontSize)
  const shapes: MenuBarShape[] = []
  let cursor = x
  items.forEach((item, index) => {
    if (index > 0) {
      cursor += s.sepGap
      shapes.push(text("·", cursor, baseline, s.fontSize, 500, { alpha: s.sepAlpha }))
      cursor += measure("·", 500, s.fontSize) + s.sepGap
    }
    const label = shorten ? (Array.from(item.label)[0] ?? "") : item.label
    if (label) {
      shapes.push(
        text(label, cursor, baseline, s.labelSize, 500, { alpha: s.labelAlpha, part: "label", rowTone: item.tone })
      )
      cursor += measure(label, 500, s.labelSize) + s.labelGap
    }
    const run = valueRuns(item.value, cursor, baseline, s.fontSize, item.tone, measure)
    shapes.push(...run.shapes)
    cursor += run.width
  })
  return { shapes, width: cursor - x }
}

function inlineContent(items: TaskbarItem[], x: number, measure: MeasureText): StyleContent {
  return inlineRow(STYLE_METRICS.inline, items, x, measure, false)
}

function inlineCompactContent(items: TaskbarItem[], x: number, measure: MeasureText): StyleContent {
  return inlineRow(STYLE_METRICS["inline-compact"], items, x, measure, true)
}

const STYLE_LAYOUTS: Record<
  MenuBarWidgetStyle,
  { content: (items: TaskbarItem[], x: number, measure: MeasureText) => StyleContent; provGap: number; icon: number }
> = {
  stacked: { content: stackedContent, provGap: STYLE_METRICS.stacked.provGap, icon: STYLE_METRICS.stacked.icon },
  compact: { content: compactContent, provGap: STYLE_METRICS.compact.provGap, icon: STYLE_METRICS.compact.icon },
  inline: { content: inlineContent, provGap: STYLE_METRICS.inline.provGap, icon: STYLE_METRICS.inline.icon },
  "inline-compact": {
    content: inlineCompactContent,
    provGap: STYLE_METRICS["inline-compact"].provGap,
    icon: STYLE_METRICS["inline-compact"].icon,
  },
}

/** Account name styles: badge radius, and the name text sizes / widths of the "beside" and "top" labels. */
const ACCOUNT_BADGE_RADIUS = 4.25
const ACCOUNT_NAME_BESIDE = { size: 11, maxWidth: 56, gap: 5 }
const ACCOUNT_NAME_TOP = { size: 8, maxWidth: 120, offset: 4.75 }
/** The one-line value row under the name of the "top" account label. */
const ACCOUNT_TOP_ROW = {
  labelSize: 9.5 * EXPECTED_SCALE,
  fontSize: 9.5,
  labelGap: 2,
  sepGap: 3,
  labelAlpha: LABEL_ALPHA,
  sepAlpha: 120 / 255,
}

/**
 * Lays out the widget: providers → optional monochrome icon → the items arranged by `style`.
 * A provider with an `accountName` also shows it as `opts.accountLabel` says (default "initial").
 * Pure: text widths come from the injected `measure`.
 */
export function layoutMenuBarWidget(
  payload: TaskbarPayload,
  measure: MeasureText,
  opts: { pad?: number; style?: MenuBarWidgetStyle; accountLabel?: MenuBarAccountLabel } = {}
): MenuBarLayout | null {
  const m = MENU_BAR_METRICS
  const pad = opts.pad ?? m.pad
  const styleLayout = STYLE_LAYOUTS[opts.style ?? "stacked"]
  const providers: MenuBarProviderLayout[] = []
  let x = pad

  for (const provider of payload.providers) {
    if (provider.items.length === 0) continue
    if (providers.length > 0) x += styleLayout.provGap

    const providerX = x
    const iconMask = decodeIconMask(provider.iconMask)
    let icon: MenuBarProviderLayout["icon"] = null
    if (iconMask) {
      const size = styleLayout.icon
      icon = { x, y: (m.height - size) / 2, size }
      x += size + m.iconGap
    }

    const accountMode = opts.accountLabel ?? "initial"
    const accountName = accountMode === "off" ? "" : (provider.accountName?.trim() ?? "")
    const shapes: MenuBarShape[] = []
    let badge: MenuBarProviderLayout["badge"]
    if (accountName && accountMode === "initial" && icon) {
      const r = ACCOUNT_BADGE_RADIUS
      badge = { cx: icon.x + icon.size - 1.5, cy: icon.y + icon.size - 1.5, r, letter: badgeLetter(accountName) }
    } else if (accountName && accountMode !== "top") {
      // "beside" (also "initial" without an icon): the name between the icon and the values.
      const { size, maxWidth, gap } = ACCOUNT_NAME_BESIDE
      const name = fitName(accountName, maxWidth, measure, 600, size)
      shapes.push(text(name, x, baselineFor(m.height / 2, size), size, 600, { alpha: 0.9 }))
      x += measure(name, 600, size) + gap
    }

    const contentX = x
    const items = provider.items.map((item) => ({ ...item, value: stripPercent(item.value) }))
    let content: StyleContent
    if (accountName && accountMode === "top") {
      // The name on a small top line, every value on one line below it.
      const { size, maxWidth, offset } = ACCOUNT_NAME_TOP
      const name = fitName(accountName, maxWidth, measure, 600, size)
      const compact = opts.style === "compact" || opts.style === "inline-compact"
      const rowBaseline = baselineFor(m.height / 2 + offset, ACCOUNT_TOP_ROW.fontSize)
      const row = inlineRow(ACCOUNT_TOP_ROW, items, contentX, measure, compact, rowBaseline)
      content = {
        shapes: [text(name, contentX, baselineFor(m.height / 2 - offset, size), size, 600, { alpha: 0.75 }), ...row.shapes],
        width: Math.max(measure(name, 600, size), row.width),
      }
    } else {
      content = styleLayout.content(items, contentX, measure)
    }
    x += content.width
    providers.push({
      x: providerX,
      brandColor: provider.brandColor,
      iconMask,
      icon,
      ...(badge ? { badge } : {}),
      contentX,
      width: x - providerX,
      shapes: [...shapes, ...content.shapes],
    })
  }

  if (providers.length === 0) return null
  return { width: x + pad, height: m.height, providers }
}

type Rgb = [number, number, number]

/** Same tables as paint.rs tone_rgb, as `#rrggbb`. */
const TONE_DEFAULTS_LIGHT: Required<MenuBarWidgetColors> = {
  ahead: "#107c10",
  onTrack: "#9d5d00",
  behind: "#c42b1c",
}
const TONE_DEFAULTS_DARK: Required<MenuBarWidgetColors> = {
  ahead: "#6ccb5f",
  onTrack: "#fce100",
  behind: "#ff6251",
}

/** Built-in tone colors for a menu bar appearance (what a tone without a custom color uses). */
export function defaultToneColors(dark: boolean): Required<MenuBarWidgetColors> {
  return { ...(dark ? TONE_DEFAULTS_DARK : TONE_DEFAULTS_LIGHT) }
}

const TONE_KEYS: Record<string, keyof MenuBarWidgetColors> = {
  ahead: "ahead",
  "on-track": "onTrack",
  behind: "behind",
}

/** Custom color when set (any appearance/background), else the built-in one. Null for neutral/unknown (use fg). */
function toneColor(tone: string, dark: boolean, colors: MenuBarWidgetColors): string | null {
  const key = TONE_KEYS[tone]
  if (!key) return null
  return colors[key] ?? defaultToneColors(dark)[key]
}

function rgbCss([r, g, b]: Rgb, alpha = 1): string {
  return `rgba(${r},${g},${b},${alpha})`
}

export type MenuBarPalette = {
  /** Color of icons, labels and tracks. */
  fg: Rgb
  /** Which tone table to use (matches the brightness behind the content). */
  toneDark: boolean
  /** Card fill, or null when no background is drawn. */
  fill: string | null
  /** Vertical sheen drawn over the fill: `top` at the top edge fading to `bottom` at `extent` (0..1 of the height). */
  overlay: { top: string; bottom: string; extent: number } | null
  /** Specular rim: 1pt outline (inset 0.5pt) as a diagonal gradient from the top-left to the bottom-right corner. */
  strokeGradient: { from: string; to: string } | null
  /** 1pt line just inside the bottom edge (y = height - 1.5), between the corner radii, or null. */
  shade: string | null
  /** Card corner radius in pt. */
  radius: number
}

/** Card color of "auto": follows the menu bar. */
const AUTO_CARD_DARK = "#1c1c1e"
const AUTO_CARD_LIGHT = "#ffffff"
/** The content follows the card's contrast from this opacity (%) up; below it the card is too faint. */
const CONTENT_CONTRAST_MIN_OPACITY = 45

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** WCAG relative luminance (0 black .. 1 white). */
function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Card color of a backdrop on a menu bar of the given appearance. */
export function backdropCardColor(dark: boolean, backdrop: Pick<MenuBarWidgetBackdrop, "color">): string {
  if (backdrop.color === "auto" || !/^#[0-9a-f]{6}$/i.test(backdrop.color)) return dark ? AUTO_CARD_DARK : AUTO_CARD_LIGHT
  return backdrop.color.toLowerCase()
}

/**
 * Colors for a backdrop. `dark` is the menu bar's appearance. Glass scales a top sheen, a specular rim and a
 * bottom shade by `glass / 100`; at 0 none of them is drawn. Blur is never drawn here (it is native).
 */
export function menuBarPalette(dark: boolean, backdrop: MenuBarWidgetBackdrop): MenuBarPalette {
  const menuFg: Rgb = dark ? [255, 255, 255] : [0, 0, 0]
  const radius = MENU_BAR_METRICS.cardRadius
  if (!backdrop.enabled) {
    return { fg: menuFg, toneDark: dark, fill: null, overlay: null, strokeGradient: null, shade: null, radius }
  }

  const card = hexToRgb(backdropCardColor(dark, backdrop))
  const opacity = backdrop.opacity / 100
  // The glass sheen looks wrong on the flat Windows taskbar, so it is never drawn there.
  const g = isWindowsPlatform() ? 0 : backdrop.glass / 100
  const round = (alpha: number) => Math.round(alpha * 1000) / 1000
  const white = (alpha: number) => rgbCss([255, 255, 255], round(alpha))

  // Past the opacity threshold the content contrasts with the card (black on light cards, white on dark ones).
  let fg = menuFg
  let toneDark = dark
  if (backdrop.opacity >= CONTENT_CONTRAST_MIN_OPACITY) {
    const lightCard = relativeLuminance(card) > 0.5
    fg = lightCard ? [0, 0, 0] : [255, 255, 255]
    toneDark = !lightCard
  }

  return {
    fg,
    toneDark,
    fill: rgbCss(card, opacity),
    overlay:
      g > 0 ? { top: white(0.2 * g), bottom: white(0), extent: 0.6 } : null,
    strokeGradient: g > 0 ? { from: white(0.65 * g), to: white(0.1 * g) } : null,
    shade: g > 0 ? rgbCss([0, 0, 0], round(0.22 * g)) : null,
    radius,
  }
}

/** `color` (`#rrggbb` or any CSS color) at `alpha`; hex colors get the alpha applied, others are kept as is. */
function withAlpha(color: string, alpha: number): string {
  if (alpha >= 1) return color
  const match = /^#([0-9a-f]{6})$/i.exec(color)
  if (!match) return color
  const n = parseInt(match[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/** Fill style of a text run under the per-part color modes. */
function textFill(
  shape: MenuBarText,
  fg: Rgb,
  toneDark: boolean,
  colors: MenuBarWidgetColors,
  textColors: MenuBarWidgetTextColors,
  toneModes: MenuBarWidgetToneModes
): string {
  const mono = (alpha: number) => rgbCss(fg, alpha)
  /** A tone in "mono" mode is never drawn in its color, whatever the text mode says. */
  const toneIsColor = (tone: string | undefined) => {
    const key = tone !== undefined ? TONE_KEYS[tone] : undefined
    return key === undefined || toneModes[key] === "color"
  }
  const toned = (tone: string | undefined, alpha: number, fallbackAlpha: number) => {
    const color = tone !== undefined ? toneColor(tone, toneDark, colors) : null
    return color !== null ? withAlpha(color, alpha) : mono(fallbackAlpha)
  }
  switch (shape.part) {
    case "label":
      return textColors.label === "color" && toneIsColor(shape.rowTone)
        ? toned(shape.rowTone, LABEL_TONE_ALPHA, shape.alpha)
        : mono(shape.alpha)
    case "used":
      return textColors.used === "color" && toneIsColor(shape.tone) ? toned(shape.tone, shape.alpha, shape.alpha) : mono(1)
    case "expected":
      return textColors.expected === "color" && toneIsColor(shape.tone)
        ? toned(shape.tone, shape.alpha, shape.alpha)
        : mono(EXPECTED_MONO_ALPHA)
    default:
      return toned(shape.tone, shape.alpha, shape.alpha)
  }
}

function drawIcon(
  ctx: CanvasRenderingContext2D,
  mask: Uint8Array,
  box: { x: number; y: number; size: number },
  tint: string
) {
  const tile = document.createElement("canvas")
  tile.width = MASK_SIDE
  tile.height = MASK_SIDE
  const tctx = tile.getContext("2d")
  if (!tctx) throw new Error("2d canvas context unavailable")
  const image = tctx.createImageData(MASK_SIDE, MASK_SIDE)
  for (let i = 0; i < mask.length; i += 1) image.data[i * 4 + 3] = mask[i]
  tctx.putImageData(image, 0, 0)
  tctx.globalCompositeOperation = "source-in"
  tctx.fillStyle = tint
  tctx.fillRect(0, 0, MASK_SIDE, MASK_SIDE)

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(tile, box.x, box.y, box.size, box.size)
}

/** Options shared by every output of the widget renderer. */
export type MenuBarRenderOptions = {
  dark: boolean
  backdrop: MenuBarWidgetBackdrop
  style: MenuBarWidgetStyle
  colors?: MenuBarWidgetColors
  /** Per text part: content color ("mono") or pace tone color ("color"). */
  textColors?: MenuBarWidgetTextColors
  /** Per pace state: tone color ("color") or content color ("mono"); combined with `textColors`. */
  toneModes?: MenuBarWidgetToneModes
  /** How a Claude account provider shows its account name (providers with an `accountName`); default "initial". */
  accountLabel?: MenuBarAccountLabel
  scale?: number
}

/**
 * Renders the menu bar widget to a transparent PNG whose logical height is 22pt
 * (Rust shows the image at that height). Returns base64 without the data: prefix.
 */
export async function renderMenuBarWidgetPng(
  payload: TaskbarPayload,
  opts: MenuBarRenderOptions
): Promise<string | null> {
  const canvas = renderMenuBarWidgetCanvas(payload, opts)
  if (!canvas) return null
  const dataUrl = canvas.toDataURL("image/png")
  const comma = dataUrl.indexOf(",")
  return comma >= 0 ? dataUrl.slice(comma + 1) : null
}

/** Renders the same widget as `renderMenuBarWidgetPng`, as raw RGBA pixels (the Windows taskbar draws them natively). */
export async function renderMenuBarWidgetRgba(
  payload: TaskbarPayload,
  opts: MenuBarRenderOptions
): Promise<WidgetRgbaImage | null> {
  const canvas = renderMenuBarWidgetCanvas(payload, opts)
  if (!canvas) return null
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk))
  }
  return { width: canvas.width, height: canvas.height, rgba: btoa(binary) }
}

function renderMenuBarWidgetCanvas(payload: TaskbarPayload, opts: MenuBarRenderOptions): HTMLCanvasElement | null {
  const scale = opts.scale ?? MENU_BAR_RENDER_SCALE
  const colors = opts.colors ?? {}
  const textColors = opts.textColors ?? DEFAULT_TEXT_COLORS
  const toneModes = opts.toneModes ?? DEFAULT_TONE_MODES
  const font = (weight: FontWeight, size: number) => `${weight} ${size}px ${MENU_BAR_FONT_FAMILY}`

  const measureCanvas = document.createElement("canvas")
  const mctx = measureCanvas.getContext("2d")
  if (!mctx) throw new Error("2d canvas context unavailable")
  const measure: MeasureText = (value, weight, size) => {
    mctx.font = font(weight, size)
    return mctx.measureText(value).width
  }

  const layout = layoutMenuBarWidget(payload, measure, {
    pad: menuBarPad(opts.backdrop),
    style: opts.style,
    accountLabel: opts.accountLabel,
  })
  if (!layout) return null

  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.ceil(layout.width * scale))
  canvas.height = layout.height * scale
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("2d canvas context unavailable")
  ctx.scale(scale, scale)
  ctx.textBaseline = "alphabetic"

  const palette = menuBarPalette(opts.dark, opts.backdrop)
  const { fg } = palette
  const radius = palette.radius

  const cardPath = (inset: number) => {
    ctx.beginPath()
    ctx.roundRect(inset, inset, layout.width - 2 * inset, layout.height - 2 * inset, Math.max(0, radius - inset))
  }
  const hLine = (color: string, y: number) => {
    if (layout.width <= 2 * radius) return
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(radius, y)
    ctx.lineTo(layout.width - radius, y)
    ctx.stroke()
  }

  const verticalGradient = (stops: [number, string][]) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, layout.height)
    for (const [at, color] of stops) gradient.addColorStop(at, color)
    return gradient
  }

  if (palette.fill) {
    ctx.fillStyle = palette.fill
    cardPath(0)
    ctx.fill()
  }
  if (palette.overlay) {
    // Past `extent` the last stop holds, so the sheen fades out without clipping.
    ctx.fillStyle = verticalGradient([
      [0, palette.overlay.top],
      [palette.overlay.extent, palette.overlay.bottom],
      [1, palette.overlay.bottom],
    ])
    cardPath(0)
    ctx.fill()
  }
  if (palette.strokeGradient) {
    const gradient = ctx.createLinearGradient(0, 0, layout.width, layout.height)
    gradient.addColorStop(0, palette.strokeGradient.from)
    gradient.addColorStop(1, palette.strokeGradient.to)
    ctx.strokeStyle = gradient
    ctx.lineWidth = 1
    cardPath(0.5)
    ctx.stroke()
  }
  if (palette.shade) hLine(palette.shade, layout.height - 1.5)

  for (const provider of layout.providers) {
    if (provider.icon && provider.iconMask) {
      // Monochrome like native menu bar icons: same color as the text.
      drawIcon(ctx, provider.iconMask, provider.icon, rgbCss(fg))
    }
    if (provider.badge) {
      // Content-colored disc with the letter cut out of it (and of the icon under it).
      const { cx, cy, r, letter } = provider.badge
      ctx.fillStyle = rgbCss(fg)
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalCompositeOperation = "destination-out"
      ctx.font = font(700, 6.5)
      ctx.textAlign = "center"
      ctx.fillStyle = "#000"
      ctx.fillText(letter, cx, cy + 6.5 * BASELINE_FACTOR)
      ctx.globalCompositeOperation = "source-over"
      ctx.textAlign = "left"
    }
    for (const shape of provider.shapes) {
      ctx.font = font(shape.weight, shape.size)
      ctx.textAlign = shape.align
      ctx.fillStyle = textFill(shape, fg, palette.toneDark, colors, textColors, toneModes)
      ctx.fillText(shape.text, shape.x, shape.baseline)
    }
  }

  return canvas
}

/** Scale `renderMenuBarWidgetPng` renders at unless told otherwise. */
export const MENU_BAR_RENDER_SCALE = 3

/** Logical size (pt) of a rendered widget PNG (base64, no data: prefix), read from its IHDR. Null when malformed. */
export function menuBarImageSizePt(
  base64: string,
  scale: number = MENU_BAR_RENDER_SCALE
): { width: number; height: number } | null {
  try {
    const head = atob(base64.slice(0, 32))
    if (head.length < 24 || head.slice(1, 4) !== "PNG") return null
    const u32 = (at: number) =>
      ((head.charCodeAt(at) << 24) | (head.charCodeAt(at + 1) << 16) | (head.charCodeAt(at + 2) << 8) | head.charCodeAt(at + 3)) >>> 0
    const width = u32(16)
    const height = u32(20)
    if (width === 0 || height === 0) return null
    return { width: width / scale, height: height / scale }
  } catch {
    return null
  }
}
