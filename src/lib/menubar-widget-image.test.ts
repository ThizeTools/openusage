import { afterEach, describe, expect, it, vi } from "vitest"
import {
  defaultToneColors,
  layoutMenuBarWidget,
  MENU_BAR_FONT_FAMILY,
  MENU_BAR_RENDER_SCALE,
  renderMenuBarWidgetPng,
  renderMenuBarWidgetRgba,
  MENU_BAR_METRICS as M,
  backdropCardColor,
  menuBarImageSizePt,
  menuBarPad,
  menuBarPalette,
  stripPercent,
  STYLE_METRICS as S,
  type MenuBarProviderLayout,
  type MenuBarText,
} from "@/lib/menubar-widget-image"
import type { MenuBarWidgetBackdrop } from "@/lib/settings"
import type { TaskbarItem, TaskbarPayload, TaskbarProvider } from "@/lib/taskbar-payload"

/** Explicit base backdrop (auto, opacity 60, glass 40, blur 50), independent of the product defaults, overridden by `over`. */
const bd = (over: Partial<MenuBarWidgetBackdrop> = {}): MenuBarWidgetBackdrop => ({
  enabled: true,
  color: "auto",
  opacity: 60,
  glass: 40,
  blur: 50,
  ...over,
})
const OFF = bd({ enabled: false })

const measure = (text: string) => text.length * 4
const MASK = btoa(String.fromCharCode(...new Uint8Array(64 * 64).fill(255)))
/** Where content starts for a style (icon box differs: 15pt for the two-row styles, 16pt for the single-row ones). */
const iconEnd = (style: keyof typeof S, pad: number = M.pad) => pad + S[style].icon + M.iconGap
const ICON_END = iconEnd("stacked")
/** Vertical centre → alphabetic baseline, as the layout computes it. */
const base = (midY: number, size: number) => midY + size * 0.35

function item(label: string, value: string, extra: Partial<TaskbarItem> = {}): TaskbarItem {
  return { label, value, tone: "neutral", ...extra }
}

function provider(items: TaskbarItem[], withIcon = true): TaskbarProvider {
  return { id: "p", brandColor: "#DE7356", iconMask: withIcon ? MASK : null, items }
}

function payload(providers: TaskbarProvider[]): TaskbarPayload {
  return { providers, tooltip: "" }
}

const texts = (p: MenuBarProviderLayout) => p.shapes.filter((s): s is MenuBarText => s.type === "text")

const TWO = [item("Session", "42%"), item("Weekly", "9%")]

describe("layoutMenuBarWidget (shared)", () => {
  it("is 22pt tall", () => {
    expect(M.height).toBe(22)
    expect(layoutMenuBarWidget(payload([provider(TWO)]), measure)!.height).toBe(22)
  })

  it("returns null without providers or items", () => {
    expect(layoutMenuBarWidget(payload([]), measure)).toBeNull()
    expect(layoutMenuBarWidget(payload([provider([])]), measure)).toBeNull()
  })

  it("centers the icon vertically and reserves its space only with a valid mask", () => {
    const withIcon = layoutMenuBarWidget(payload([provider([item("", "42%")])]), measure)!
    expect(withIcon.providers[0].icon).toEqual({ x: M.pad, y: (22 - 15) / 2, size: 15 })
    expect(withIcon.providers[0].contentX).toBe(ICON_END)

    const none = layoutMenuBarWidget(payload([provider([item("", "42%")], false)]), measure)!
    expect(none.providers[0].icon).toBeNull()
    expect(none.providers[0].contentX).toBe(M.pad)
    expect(none.width).toBe(M.pad + 8 + M.pad)

    const bad = layoutMenuBarWidget(
      payload([{ ...provider([item("", "42%")]), iconMask: btoa("short") }]),
      measure
    )!
    expect(bad.providers[0].icon).toBeNull()
  })

  it("defaults to the stacked style", () => {
    const p = payload([provider(TWO)])
    expect(layoutMenuBarWidget(p, measure)).toEqual(layoutMenuBarWidget(p, measure, { style: "stacked" }))
  })

  it("separates providers by the style's provider gap", () => {
    const p = payload([provider([item("", "42%")], false), provider([item("", "7%")], false)])
    const gaps = {
      stacked: S.stacked.provGap,
      compact: S.compact.provGap,
      inline: S.inline.provGap,
      "inline-compact": S["inline-compact"].provGap,
    }
    for (const [style, gap] of Object.entries(gaps)) {
      const layout = layoutMenuBarWidget(p, measure, { style: style as keyof typeof gaps })!
      const [a, b] = layout.providers
      expect(b.x, style).toBe(a.x + a.width + gap)
      expect(layout.width, style).toBe(b.x + b.width + M.pad)
    }
  })

  it("widens by the extra padding when a background is on", () => {
    const p = payload([provider(TWO)])
    const base = layoutMenuBarWidget(p, measure, { pad: menuBarPad(OFF) })!
    const card = layoutMenuBarWidget(p, measure, { pad: menuBarPad(bd()) })!
    expect(card.width).toBe(base.width + 2 * (M.cardPad - M.pad))
    expect(card.height).toBe(22)
    expect(card.providers[0].icon?.x).toBe(M.cardPad)
  })

  it("uses a 15pt icon box in the two-row styles and 16pt in the single-row ones", () => {
    const sizes = Object.fromEntries(
      (["stacked", "compact", "inline", "inline-compact"] as const).map((style) => [
        style,
        layoutMenuBarWidget(payload([provider(TWO)]), measure, { style })!.providers[0].icon?.size,
      ])
    )
    expect(sizes).toEqual({ stacked: 15, compact: 15, inline: 16, "inline-compact": 16 })
  })
})

describe("menuBarPad", () => {
  it("is 3pt without a background and 8pt with one", () => {
    expect(menuBarPad(OFF)).toBe(3)
    expect(menuBarPad(bd())).toBe(8)
    expect(menuBarPad(bd({ glass: 100, opacity: 0 }))).toBe(8)
  })
})

describe("stacked style", () => {
  it("stacks two items in one column on two 9.5pt rows centered in the 22pt bar", () => {
    const layout = layoutMenuBarWidget(payload([provider(TWO)]), measure, { style: "stacked" })!
    const p = layout.providers[0]
    const [label1, value1, label2, value2] = texts(p)

    // Rows span 1.5..20.5: row midpoints 6.25 and 15.75, baseline = mid + 0.35 * value size.
    expect(S.stacked).toMatchObject({ fontSize: 9.5, labelSize: 9, rowHeight: 9.5 })
    expect(label1.baseline).toBeCloseTo(base(6.25, 9.5))
    expect(value1.baseline).toBeCloseTo(base(6.25, 9.5))
    expect(label2.baseline).toBeCloseTo(base(15.75, 9.5))
    expect(value2.baseline).toBeCloseTo(base(15.75, 9.5))
    // label "Session" 28 + gap 3, then value "42" 8 → widest row is 39
    expect(value1.x).toBe(ICON_END + 28 + S.stacked.labelGap)
    expect(label1.x).toBe(ICON_END)
    expect(p.width).toBe(15 + M.iconGap + 39)
    expect(layout.width).toBe(ICON_END + 39 + M.pad)
  })

  it("styles label medium fg@0.62 at 9pt and value bold in the tone color at 9.5pt", () => {
    const [p] = layoutMenuBarWidget(
      payload([provider([item("Session", "42%", { tone: "behind" }), item("Weekly", "42%", { tone: "behind" })])]),
      measure,
      { style: "stacked" }
    )!.providers
    const [label, value] = texts(p)
    expect(label).toMatchObject({ size: 9, weight: 500, alpha: 0.62, tone: undefined })
    expect(value).toMatchObject({ size: 9.5, weight: 700, tone: "behind", alpha: 1 })
  })

  it("splits `used/expected` into a bold used number and a lighter, smaller /expected on one baseline", () => {
    const [p] = layoutMenuBarWidget(
      payload([provider([item("Session", "13%/91%", { tone: "ahead" }), item("Session", "13%/91%", { tone: "ahead" })], false)]),
      measure,
      { style: "stacked" }
    )!
    .providers
    const [label, used, expected] = texts(p)
    expect(used).toMatchObject({ text: "13", size: 9.5, weight: 700, tone: "ahead", alpha: 1 })
    expect(expected).toMatchObject({ text: "/91", weight: 500, tone: "ahead", alpha: 0.6 })
    expect(expected.size).toBeCloseTo(9.5 * 0.82)
    expect(expected.baseline).toBe(used.baseline)
    expect(expected.x).toBe(used.x + 8)
    // label "Session" 28 + 3 gap, "13" 8 + "/91" 12
    expect(p.width).toBe(28 + S.stacked.labelGap + 8 + 12)
    expect(label.x).toBe(M.pad)
  })

  it("wraps extra items into new columns of two", () => {
    const [p] = layoutMenuBarWidget(
      payload([provider([item("A", "1%"), item("B", "2%"), item("C", "3%")], false)]),
      measure,
      { style: "stacked" }
    )!.providers
    const t = texts(p)
    // column 1: A/B ("A"4+3+"1"4 = 11 wide), column 2 starts after colGap with a lone, centered row
    const c = t[4]
    expect(c.text).toBe("C")
    expect(c.x).toBe(M.pad + 11 + S.stacked.colGap)
    expect(c.baseline).toBeCloseTo(base(11, 9.5))
  })

  it("centers a single unlabeled row and puts its value at the column start", () => {
    const [p] = layoutMenuBarWidget(payload([provider([item("", "42%")])]), measure, { style: "stacked" })!.providers
    const only = texts(p)
    expect(only).toHaveLength(1)
    // A lone line has the whole height: drawn at the one-row (inline) size, not the 9.5pt two-row size.
    expect(only[0].size).toBe(12.5)
    expect(only[0].baseline).toBeCloseTo(base(11, 12.5))
    expect(only[0].x).toBe(ICON_END)
  })

  it("draws a lone line at the same size in stacked, compact and inline styles", () => {
    const sizes = (["stacked", "compact", "inline", "inline-compact"] as const).map((style) => {
      const [p] = layoutMenuBarWidget(payload([provider([item("", "Fri 6:00 PM")])]), measure, { style })!.providers
      return texts(p)[0].size
    })
    expect(new Set(sizes)).toEqual(new Set([12.5]))
  })
})

describe("compact style", () => {
  it("shortens labels to their first letter and uses 9.5pt values", () => {
    const [p] = layoutMenuBarWidget(payload([provider(TWO)]), measure, { style: "compact" })!.providers
    const [label1, value1, label2, value2] = texts(p)
    expect([label1.text, label2.text]).toEqual(["S", "W"])
    expect(label1).toMatchObject({ alpha: 0.62, weight: 500, size: 9 })
    expect(value1).toMatchObject({ size: 9.5, weight: 700 })
    expect(value1.x).toBe(iconEnd("compact") + 4 + S.compact.labelGap)
    expect(value1.baseline).toBeCloseTo(base(6.25, 9.5))
    expect(value2.baseline).toBeCloseTo(base(15.75, 9.5))
    // "S" 4 + 2 + "42" 8 = 14, narrower than stacked's 39
    expect(p.width).toBe(15 + M.iconGap + 14)
  })

  it("keeps empty labels empty", () => {
    const [p] = layoutMenuBarWidget(payload([provider([item("", "42%")], false)]), measure, { style: "compact" })!.providers
    expect(texts(p).map((t) => t.text)).toEqual(["42"])
    expect(texts(p)[0].x).toBe(M.pad)
  })
})

describe("inline style", () => {
  it("lays out `Label value · Label value` on one centered 12.5pt row", () => {
    const inlineEnd = iconEnd("inline")
    const layout = layoutMenuBarWidget(payload([provider(TWO)]), measure, { style: "inline" })!
    const p = layout.providers[0]
    const t = texts(p)
    expect(t.map((s) => s.text)).toEqual(["Session", "42", "·", "Weekly", "9"])
    expect(t.every((s) => s.size === 12.5 && Math.abs(s.baseline - base(11, 12.5)) < 1e-9)).toBe(true)

    const [label1, value1, sep, label2, value2] = t
    expect(label1.x).toBe(inlineEnd)
    expect(value1.x).toBe(inlineEnd + 28 + S.inline.labelGap)
    expect(sep.x).toBe(value1.x + 8 + S.inline.sepGap)
    expect(label2.x).toBe(sep.x + 4 + S.inline.sepGap)
    expect(value2.x).toBe(label2.x + 24 + S.inline.labelGap)
    expect(layout.width).toBe(value2.x + 4 + M.pad)
    expect(label1).toMatchObject({ alpha: 0.62, weight: 500 })
    expect(value1.weight).toBe(700)
  })

  it("skips the separator for a single item and the label gap for no label", () => {
    const [p] = layoutMenuBarWidget(payload([provider([item("", "42%")], false)]), measure, { style: "inline" })!.providers
    expect(texts(p).map((t) => t.text)).toEqual(["42"])
    expect(texts(p)[0].x).toBe(M.pad)
  })
})

describe("inline-compact style", () => {
  it("lays out `L value · L value` on one row with first-letter labels and tighter gaps", () => {
    const layout = layoutMenuBarWidget(payload([provider(TWO)]), measure, { style: "inline-compact" })!
    const p = layout.providers[0]
    const t = texts(p)
    expect(t.map((s) => s.text)).toEqual(["S", "42", "·", "W", "9"])
    expect(t.every((s) => Math.abs(s.baseline - base(11, 12.5)) < 1e-9)).toBe(true)

    const end = iconEnd("inline-compact")
    const [label1, value1, sep, label2, value2] = t
    expect(label1).toMatchObject({ x: end, size: 12, weight: 500, alpha: 0.62 })
    expect(value1).toMatchObject({ x: end + 4 + 3, size: 12.5, weight: 700 })
    expect(S["inline-compact"]).toMatchObject({ labelGap: 3, sepGap: 4, provGap: 12 })
    expect(sep.x).toBe(value1.x + 8 + 4)
    expect(label2.x).toBe(sep.x + 4 + 4)
    expect(value2.x).toBe(label2.x + 4 + 3)
    expect(layout.width).toBe(value2.x + 4 + M.pad)
  })

  it("is narrower than inline and keeps empty labels empty", () => {
    const inline = layoutMenuBarWidget(payload([provider(TWO)]), measure, { style: "inline" })!
    const compact = layoutMenuBarWidget(payload([provider(TWO)]), measure, { style: "inline-compact" })!
    expect(compact.width).toBeLessThan(inline.width)

    const [p] = layoutMenuBarWidget(payload([provider([item("", "42%")], false)]), measure, {
      style: "inline-compact",
    })!.providers
    expect(texts(p).map((t) => t.text)).toEqual(["42"])
    expect(texts(p)[0].x).toBe(M.pad)
  })
})

describe("percent stripping", () => {
  it("stripPercent removes every % sign", () => {
    expect(stripPercent("13%/91%")).toBe("13/91")
    expect(stripPercent("94%")).toBe("94")
    expect(stripPercent("3:45 PM")).toBe("3:45 PM")
  })

  it("draws values without % in every style and leaves the payload untouched", () => {
    const items = [item("Session", "13%/91%"), item("Weekly", "94%")]
    for (const style of ["stacked", "compact", "inline", "inline-compact"] as const) {
      const [p] = layoutMenuBarWidget(payload([provider(items, false)]), measure, { style })!.providers
      const values = texts(p).filter((t) => t.weight === 700 || t.text.startsWith("/")).map((t) => t.text)
      expect(values, style).toEqual(["13", "/91", "94"])
    }
    expect(items[0].value).toBe("13%/91%")
  })
})

describe("menuBarPalette", () => {
  const plain = { fill: null, overlay: null, strokeGradient: null, shade: null, radius: 7 }

  it("disabled: menu bar color content, nothing drawn", () => {
    expect(menuBarPalette(true, OFF)).toEqual({ fg: [255, 255, 255], toneDark: true, ...plain })
    expect(menuBarPalette(false, OFF)).toEqual({ fg: [0, 0, 0], toneDark: false, ...plain })
  })

  it("auto color: #1c1c1e on a dark menu bar, #ffffff on a light one, at opacity / 100", () => {
    expect(backdropCardColor(true, bd())).toBe("#1c1c1e")
    expect(backdropCardColor(false, bd())).toBe("#ffffff")
    expect(menuBarPalette(true, bd({ glass: 0 })).fill).toBe("rgba(28,28,30,0.6)")
    expect(menuBarPalette(false, bd({ glass: 0, opacity: 92 })).fill).toBe("rgba(255,255,255,0.92)")
  })

  it("custom color: the hex at opacity / 100 on any menu bar", () => {
    const custom = bd({ color: "#336699", opacity: 25, glass: 0 })
    expect(backdropCardColor(true, custom)).toBe("#336699")
    expect(menuBarPalette(true, custom).fill).toBe("rgba(51,102,153,0.25)")
    expect(menuBarPalette(false, custom).fill).toBe("rgba(51,102,153,0.25)")
  })

  it("opacity 0 keeps a fully transparent fill", () => {
    expect(menuBarPalette(true, bd({ opacity: 0, glass: 0 })).fill).toBe("rgba(28,28,30,0)")
  })

  it("glass 0 draws no sheen, rim or shade", () => {
    for (const dark of [true, false]) {
      expect(menuBarPalette(dark, bd({ glass: 0 }))).toMatchObject({ overlay: null, strokeGradient: null, shade: null })
    }
  })

  it("glass 100: sheen 0.20, rim 0.65 to 0.10 and shade 0.22", () => {
    expect(menuBarPalette(true, bd({ glass: 100 }))).toMatchObject({
      overlay: { top: "rgba(255,255,255,0.2)", bottom: "rgba(255,255,255,0)", extent: 0.6 },
      strokeGradient: { from: "rgba(255,255,255,0.65)", to: "rgba(255,255,255,0.1)" },
      shade: "rgba(0,0,0,0.22)",
    })
  })

  it("glass scales every effect", () => {
    expect(menuBarPalette(true, bd({ glass: 50 }))).toMatchObject({
      overlay: { top: "rgba(255,255,255,0.1)", bottom: "rgba(255,255,255,0)", extent: 0.6 },
      strokeGradient: { from: "rgba(255,255,255,0.325)", to: "rgba(255,255,255,0.05)" },
      shade: "rgba(0,0,0,0.11)",
    })
    expect(menuBarPalette(true, bd({ glass: 40 })).overlay?.top).toBe("rgba(255,255,255,0.08)")
  })

  it("content contrasts with the card from opacity 45 up: auto follows the card, light cards get black content", () => {
    expect(menuBarPalette(true, bd())).toMatchObject({ fg: [255, 255, 255], toneDark: true })
    expect(menuBarPalette(false, bd())).toMatchObject({ fg: [0, 0, 0], toneDark: false })
    // White card on a dark bar → black content and the light-mode tones.
    expect(menuBarPalette(true, bd({ color: "#ffffff", opacity: 95 }))).toMatchObject({ fg: [0, 0, 0], toneDark: false })
    // Black card on a light bar → white content and the dark-mode tones.
    expect(menuBarPalette(false, bd({ color: "#000000", opacity: 95 }))).toMatchObject({
      fg: [255, 255, 255],
      toneDark: true,
    })
    // Mid gray is darker than the 0.5 luminance threshold, bright yellow is lighter.
    expect(menuBarPalette(false, bd({ color: "#808080" })).fg).toEqual([255, 255, 255])
    expect(menuBarPalette(true, bd({ color: "#ffee00" })).fg).toEqual([0, 0, 0])
  })

  it("below opacity 45 the content follows the menu bar", () => {
    expect(menuBarPalette(true, bd({ color: "#ffffff", opacity: 44 }))).toMatchObject({ fg: [255, 255, 255], toneDark: true })
    expect(menuBarPalette(false, bd({ color: "#000000", opacity: 44 }))).toMatchObject({ fg: [0, 0, 0], toneDark: false })
    expect(menuBarPalette(true, bd({ color: "#ffffff", opacity: 45 })).fg).toEqual([0, 0, 0])
  })
})

describe("menuBarImageSizePt", () => {
  const pngBase64 = (width: number, height: number) => {
    const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]
    for (const n of [width, height]) bytes.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255)
    return btoa(String.fromCharCode(...bytes, 8, 6, 0, 0, 0))
  }

  it("reads the PNG header and divides by the render scale", () => {
    expect(menuBarImageSizePt(pngBase64(300, 66))).toEqual({ width: 100, height: 22 })
    expect(menuBarImageSizePt(pngBase64(200, 44), 2)).toEqual({ width: 100, height: 22 })
  })

  it("returns null for anything that is not a PNG", () => {
    expect(menuBarImageSizePt("QUJD")).toBeNull()
    expect(menuBarImageSizePt("")).toBeNull()
    expect(menuBarImageSizePt("***")).toBeNull()
    expect(menuBarImageSizePt(pngBase64(0, 66))).toBeNull()
  })
})

describe("defaultToneColors", () => {
  it("returns the built-in tone colors per appearance", () => {
    expect(defaultToneColors(true)).toEqual({ ahead: "#6ccb5f", onTrack: "#fce100", behind: "#ff6251" })
    expect(defaultToneColors(false)).toEqual({ ahead: "#107c10", onTrack: "#9d5d00", behind: "#c42b1c" })
  })

  it("returns a copy, so callers cannot change the table", () => {
    defaultToneColors(true).ahead = "#000000"
    expect(defaultToneColors(true).ahead).toBe("#6ccb5f")
  })
})

describe("renderMenuBarWidgetPng", () => {
  type Draw = { text: string; fillStyle: string; font: string; y: number; baseline: string }

  /** Replaces canvas with a recording fake: every measure and fillText sees the current font/fill. */
  function fakeCanvas() {
    const measured: string[] = []
    const drawn: Draw[] = []
    const gradients: { stops: [number, string][] }[] = []
    const fillStyles: string[] = []
    const ctx = {
      font: "",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      textAlign: "left",
      textBaseline: "alphabetic",
      scale: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(() => {
        fillStyles.push(String(ctx.fillStyle))
      }),
      stroke: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      createLinearGradient: vi.fn(() => {
        const gradient = { stops: [] as [number, string][], addColorStop: (at: number, color: string) => gradient.stops.push([at, color]) }
        gradients.push(gradient)
        return gradient
      }),
      measureText(value: string) {
        measured.push(ctx.font)
        return { width: value.length * 6 }
      },
      fillText(value: string, _x: number, y: number) {
        drawn.push({ text: value, fillStyle: String(ctx.fillStyle), font: ctx.font, y, baseline: ctx.textBaseline })
      },
    }
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      (() => ctx) as unknown as HTMLCanvasElement["getContext"]
    )
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,QUJD")
    return { measured, drawn, ctx, gradients, fillStyles }
  }

  const demo = payload([
    provider(
      [item("Session", "13%/91%", { tone: "ahead" }), item("Weekly", "94%/61%", { tone: "behind" }), item("Extra", "5%", { tone: "on-track" }), item("Plain", "1%")],
      false
    ),
  ])
  // Text colors and tone modes are pinned (every tone and text part colored except labels) so the tests do not depend on the product defaults.
  const opts = {
    dark: true,
    backdrop: OFF,
    style: "stacked",
    textColors: { label: "mono", used: "color", expected: "color" },
    toneModes: { ahead: "color", onTrack: "color", behind: "color" },
  } as const

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns the base64 body of the PNG", async () => {
    fakeCanvas()
    await expect(renderMenuBarWidgetPng(demo, opts)).resolves.toBe("QUJD")
  })

  it("renderMenuBarWidgetRgba returns the raw pixels as base64 with the canvas size", async () => {
    const { ctx } = fakeCanvas()
    const data = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8])
    ;(ctx as unknown as { getImageData: unknown }).getImageData = vi.fn(() => ({ data }))
    const image = await renderMenuBarWidgetRgba(demo, opts)
    expect(image).not.toBeNull()
    expect(image!.rgba).toBe(btoa(String.fromCharCode(1, 2, 3, 4, 5, 6, 7, 8)))
    expect(image!.width).toBeGreaterThan(0)
    expect(image!.height).toBe(M.height * MENU_BAR_RENDER_SCALE)
  })

  it("uses the built-in tone colors by default", async () => {
    const { drawn } = fakeCanvas()
    await renderMenuBarWidgetPng(demo, opts)
    const fill = (text: string) => drawn.find((d) => d.text === text)!.fillStyle
    expect(fill("13")).toBe("#6ccb5f")
    expect(fill("5")).toBe("#fce100")
    expect(fill("94")).toBe("#ff6251")
    // Neutral tone keeps the content color.
    expect(fill("1")).toBe("rgba(255,255,255,1)")
  })

  it("custom tone colors override the built-ins in dark and light mode and on every background", async () => {
    const colors = { ahead: "#00ff00", onTrack: "#0000ff", behind: "#ff00ff" }
    const backdrops = [OFF, bd(), bd({ color: "#ffffff", opacity: 95, glass: 0 }), bd({ opacity: 10, glass: 100 })]
    for (const dark of [true, false]) {
      for (const [index, backdrop] of backdrops.entries()) {
        const { drawn } = fakeCanvas()
        await renderMenuBarWidgetPng(demo, { ...opts, dark, backdrop, colors })
        const fill = (text: string) => drawn.find((d) => d.text === text)!.fillStyle
        expect([fill("13"), fill("5"), fill("94")], `${dark} ${index}`).toEqual([
          "#00ff00",
          "#0000ff",
          "#ff00ff",
        ])
        vi.restoreAllMocks()
      }
    }
  })

  it("only overrides the tones that have a custom color", async () => {
    const { drawn } = fakeCanvas()
    await renderMenuBarWidgetPng(demo, { ...opts, dark: false, colors: { behind: "#123456" } })
    const fill = (text: string) => drawn.find((d) => d.text === text)!.fillStyle
    expect(fill("94")).toBe("#123456")
    expect(fill("13")).toBe("#107c10")
    expect(fill("5")).toBe("#9d5d00")
  })

  it("draws the /expected part in the same tone color at 60% alpha", async () => {
    const { drawn } = fakeCanvas()
    await renderMenuBarWidgetPng(demo, opts)
    const fill = (text: string) => drawn.find((d) => d.text === text)!.fillStyle
    expect(fill("/91")).toBe("rgba(108,203,95,0.6)")
    expect(fill("/61")).toBe("rgba(255,98,81,0.6)")
    const custom = fakeCanvas()
    await renderMenuBarWidgetPng(demo, { ...opts, colors: { ahead: "#00ff00" } })
    expect(custom.drawn.find((d) => d.text === "/91")!.fillStyle).toBe("rgba(0,255,0,0.6)")
  })

  it("draws labels at fg alpha 0.62 and on an alphabetic baseline shared by used and /expected", async () => {
    const { drawn, ctx } = fakeCanvas()
    await renderMenuBarWidgetPng(demo, opts)
    expect(drawn.find((d) => d.text === "Session")!.fillStyle).toBe("rgba(255,255,255,0.62)")
    expect(drawn.every((d) => d.baseline === "alphabetic")).toBe(true)
    expect(ctx.textBaseline).toBe("alphabetic")
    expect(drawn.find((d) => d.text === "13")!.y).toBe(drawn.find((d) => d.text === "/91")!.y)
    expect(drawn.find((d) => d.text === "Session")!.y).toBe(drawn.find((d) => d.text === "13")!.y)
  })

  describe("backdrop", () => {
    it("draws nothing behind the content when disabled", async () => {
      const { ctx, gradients } = fakeCanvas()
      await renderMenuBarWidgetPng(demo, opts)
      expect(ctx.roundRect).not.toHaveBeenCalled()
      expect(ctx.fill).not.toHaveBeenCalled()
      expect(ctx.stroke).not.toHaveBeenCalled()
      expect(gradients).toHaveLength(0)
    })

    it("fills a full-height 7pt card with the color at opacity and nothing else at glass 0 (blur is never drawn)", async () => {
      const { ctx, gradients, fillStyles } = fakeCanvas()
      await renderMenuBarWidgetPng(demo, { ...opts, backdrop: bd({ glass: 0, blur: 100 }) })
      expect(fillStyles).toEqual(["rgba(28,28,30,0.6)"])
      expect(ctx.roundRect).toHaveBeenCalledTimes(1)
      expect(ctx.roundRect).toHaveBeenCalledWith(0, 0, expect.any(Number), 22, 7)
      expect(ctx.stroke).not.toHaveBeenCalled()
      expect(ctx.moveTo).not.toHaveBeenCalled()
      expect(gradients).toHaveLength(0)
    })

    it("uses the custom color and the light auto color", async () => {
      const custom = fakeCanvas()
      await renderMenuBarWidgetPng(demo, { ...opts, backdrop: bd({ color: "#336699", opacity: 80, glass: 0 }) })
      expect(custom.fillStyles).toEqual(["rgba(51,102,153,0.8)"])
      vi.restoreAllMocks()
      const light = fakeCanvas()
      await renderMenuBarWidgetPng(demo, { ...opts, dark: false, backdrop: bd({ glass: 0, opacity: 92 }) })
      expect(light.fillStyles).toEqual(["rgba(255,255,255,0.92)"])
    })

    it("glass > 0 adds the top sheen, the specular rim and the bottom shade scaled by glass", async () => {
      const { ctx, gradients, fillStyles } = fakeCanvas()
      await renderMenuBarWidgetPng(demo, { ...opts, backdrop: bd({ glass: 100 }) })
      // card fill, then the sheen (a gradient fill)
      expect(ctx.fill).toHaveBeenCalledTimes(2)
      expect(fillStyles[0]).toBe("rgba(28,28,30,0.6)")
      expect(gradients).toHaveLength(2)
      expect(gradients[0].stops).toEqual([
        [0, "rgba(255,255,255,0.2)"],
        [0.6, "rgba(255,255,255,0)"],
        [1, "rgba(255,255,255,0)"],
      ])
      expect(gradients[1].stops).toEqual([
        [0, "rgba(255,255,255,0.65)"],
        [1, "rgba(255,255,255,0.1)"],
      ])
      expect(ctx.createLinearGradient).toHaveBeenNthCalledWith(1, 0, 0, 0, 22)
      const [x0, y0, x1, y1] = vi.mocked(ctx.createLinearGradient).mock.calls[1] as unknown as number[]
      expect([x0, y0, y1]).toEqual([0, 0, 22])
      expect(x1).toBeGreaterThan(22)
      // rim (1pt inset 0.5) + shade line at height - 1.5 between the corner radii
      expect(ctx.roundRect).toHaveBeenLastCalledWith(0.5, 0.5, expect.any(Number), 21, 6.5)
      expect(ctx.stroke).toHaveBeenCalledTimes(2)
      expect(ctx.moveTo).toHaveBeenCalledWith(7, 20.5)
      expect(ctx.lineTo).toHaveBeenCalledWith(expect.any(Number), 20.5)
    })

    it("scales the glass effects by the glass value", async () => {
      const { gradients } = fakeCanvas()
      await renderMenuBarWidgetPng(demo, { ...opts, backdrop: bd({ glass: 50 }) })
      expect(gradients[0].stops[0]).toEqual([0, "rgba(255,255,255,0.1)"])
      expect(gradients[1].stops).toEqual([
        [0, "rgba(255,255,255,0.325)"],
        [1, "rgba(255,255,255,0.05)"],
      ])
    })

    it("content contrasts with the card: light card on a dark bar → black content and light-mode tones", async () => {
      const { drawn } = fakeCanvas()
      await renderMenuBarWidgetPng(demo, { ...opts, backdrop: bd({ color: "#ffffff", opacity: 95, glass: 0 }) })
      const fill = (text: string) => drawn.find((d) => d.text === text)!.fillStyle
      expect(fill("Session")).toBe("rgba(0,0,0,0.62)")
      expect(fill("13")).toBe("#107c10")
      expect(fill("94")).toBe("#c42b1c")
    })

    it("content follows the menu bar below opacity 45", async () => {
      const { drawn } = fakeCanvas()
      await renderMenuBarWidgetPng(demo, { ...opts, backdrop: bd({ color: "#ffffff", opacity: 30, glass: 0 }) })
      const fill = (text: string) => drawn.find((d) => d.text === text)!.fillStyle
      expect(fill("Session")).toBe("rgba(255,255,255,0.62)")
      expect(fill("13")).toBe("#6ccb5f")
    })

    it("custom tone colors and text modes still apply on a contrasting card", async () => {
      const { drawn } = fakeCanvas()
      await renderMenuBarWidgetPng(demo, {
        ...opts,
        backdrop: bd({ color: "#ffffff", opacity: 95, glass: 0 }),
        colors: { ahead: "#00ff00" },
        textColors: { label: "mono", used: "mono", expected: "color" },
      })
      const fill = (text: string) => drawn.find((d) => d.text === text)!.fillStyle
      expect(fill("13")).toBe("rgba(0,0,0,1)")
      expect(fill("/91")).toBe("rgba(0,255,0,0.6)")
    })
  })

  describe("textColors", () => {
    const fills = async (textColors: Parameters<typeof renderMenuBarWidgetPng>[1]["textColors"], extra = {}) => {
      const { drawn } = fakeCanvas()
      await renderMenuBarWidgetPng(demo, { ...opts, textColors, ...extra })
      vi.restoreAllMocks()
      return (text: string) => drawn.find((d) => d.text === text)!.fillStyle
    }

    it("defaults to mono labels and expected with colored used (ahead is mono by default, so a colored row is checked)", async () => {
      const fill = await fills(undefined)
      expect(fill("Session")).toBe("rgba(255,255,255,0.62)")
      expect(fill("94")).toBe("#ff6251")
      expect(fill("/61")).toBe("rgba(255,255,255,0.55)")
      expect(fill("5")).toBe("#fce100")
    })

    it("color label uses the row tone at 0.85 alpha and falls back to fg for neutral rows", async () => {
      const fill = await fills({ label: "color", used: "color", expected: "color" })
      expect(fill("Session")).toBe("rgba(108,203,95,0.85)")
      expect(fill("Weekly")).toBe("rgba(255,98,81,0.85)")
      expect(fill("Plain")).toBe("rgba(255,255,255,0.62)")
      const custom = await fills({ label: "color", used: "color", expected: "color" }, { colors: { ahead: "#00ff00" } })
      expect(custom("Session")).toBe("rgba(0,255,0,0.85)")
    })

    it("mono used is fg at full alpha, also for values without a slash", async () => {
      const fill = await fills({ label: "mono", used: "mono", expected: "color" })
      expect(fill("13")).toBe("rgba(255,255,255,1)")
      expect(fill("5")).toBe("rgba(255,255,255,1)")
      expect(fill("/91")).toBe("rgba(108,203,95,0.6)")
    })

    it("mono expected is fg at 0.55", async () => {
      const fill = await fills({ label: "mono", used: "color", expected: "mono" })
      expect(fill("/91")).toBe("rgba(255,255,255,0.55)")
      expect(fill("/61")).toBe("rgba(255,255,255,0.55)")
      expect(fill("13")).toBe("#6ccb5f")
    })

    it("everything mono draws all text in the content color", async () => {
      const fill = await fills({ label: "mono", used: "mono", expected: "mono" }, { dark: false })
      expect(fill("Session")).toBe("rgba(0,0,0,0.62)")
      expect(fill("13")).toBe("rgba(0,0,0,1)")
      expect(fill("/91")).toBe("rgba(0,0,0,0.55)")
    })

    it("a colored non-slash value follows used, not expected", async () => {
      const fill = await fills({ label: "mono", used: "color", expected: "mono" })
      expect(fill("5")).toBe("#fce100")
    })
  })

  describe("toneModes", () => {
    const allColor = { label: "color", used: "color", expected: "color" } as const
    const fills = async (
      toneModes: Parameters<typeof renderMenuBarWidgetPng>[1]["toneModes"],
      textColors: Parameters<typeof renderMenuBarWidgetPng>[1]["textColors"] = allColor
    ) => {
      const { drawn } = fakeCanvas()
      await renderMenuBarWidgetPng(demo, { ...opts, textColors, toneModes })
      vi.restoreAllMocks()
      return (text: string) => drawn.find((d) => d.text === text)!.fillStyle
    }

    it("defaults to ahead in mono and on-track and behind in color", async () => {
      const fill = await fills(undefined)
      expect(fill("13")).toBe("rgba(255,255,255,1)")
      expect(fill("5")).toBe("#fce100")
      expect(fill("94")).toBe("#ff6251")
    })

    it("a mono tone overrides colored text parts with the mono styling", async () => {
      const fill = await fills({ ahead: "mono", onTrack: "color", behind: "color" })
      // ahead row: label, used and expected all mono
      expect(fill("Session")).toBe("rgba(255,255,255,0.62)")
      expect(fill("13")).toBe("rgba(255,255,255,1)")
      expect(fill("/91")).toBe("rgba(255,255,255,0.55)")
      // other tones keep their colors
      expect(fill("94")).toBe("#ff6251")
      expect(fill("5")).toBe("#fce100")
      expect(fill("Weekly")).toBe("rgba(255,98,81,0.85)")
    })

    it("a color tone with a mono text part stays mono for that part", async () => {
      const fill = await fills(
        { ahead: "color", onTrack: "color", behind: "color" },
        { label: "mono", used: "mono", expected: "color" }
      )
      expect(fill("13")).toBe("rgba(255,255,255,1)")
      expect(fill("/91")).toBe("rgba(108,203,95,0.6)")
      expect(fill("Session")).toBe("rgba(255,255,255,0.62)")
    })

    it("leaves neutral text unchanged when every tone is mono", async () => {
      const fill = await fills({ ahead: "mono", onTrack: "mono", behind: "mono" })
      expect(fill("Plain")).toBe("rgba(255,255,255,0.62)")
      expect(fill("94")).toBe("rgba(255,255,255,1)")
      expect(fill("/61")).toBe("rgba(255,255,255,0.55)")
    })
  })

  it("measures and draws with the system font", async () => {
    const { measured, drawn } = fakeCanvas()
    await renderMenuBarWidgetPng(demo, opts)
    expect(measured.length).toBeGreaterThan(0)
    for (const font of [...measured, ...drawn.map((d) => d.font)]) {
      expect(font.endsWith(MENU_BAR_FONT_FAMILY)).toBe(true)
    }
    expect(MENU_BAR_FONT_FAMILY).toBe(
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'
    )
  })
})
