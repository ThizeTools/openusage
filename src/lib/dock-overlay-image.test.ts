import { describe, expect, it } from "vitest"
import {
  dockToneColor,
  renderDockOverlayPng,
  dockTextFills,
  selectDockMetrics,
  shortLabel,
  valueRuns,
} from "@/lib/dock-overlay-image"
import { defaultToneColors } from "@/lib/menubar-widget-image"
import type { TaskbarProvider } from "@/lib/taskbar-payload"

const allColor = { ahead: "color", onTrack: "color", behind: "color" } as const

describe("dockToneColor", () => {
  it("uses the built-in dark color for a color tone", () => {
    expect(dockToneColor("behind", {}, allColor)).toBe(defaultToneColors(true).behind)
  })

  it("prefers a custom color", () => {
    expect(dockToneColor("on-track", { onTrack: "#123456" }, allColor)).toBe("#123456")
  })

  it("is neutral for mono tones, neutral and unknown tones", () => {
    expect(dockToneColor("ahead", {}, { ...allColor, ahead: "mono" })).toBe("#f2f2f2")
    expect(dockToneColor("neutral", {}, allColor)).toBe("#f2f2f2")
    expect(dockToneColor("weird", {}, allColor)).toBe("#f2f2f2")
  })
})

describe("selectDockMetrics", () => {
  const provider = (items: TaskbarProvider["items"]): TaskbarProvider => ({ id: "claude", items })

  it("takes the first two items with a finite fraction and rounds them", () => {
    const metrics = selectDockMetrics(
      provider([
        { label: "", value: "—", tone: "neutral", fraction: null },
        { label: "Session", value: "", tone: "ahead", fraction: 0.184, expectedFraction: 0.305 },
        { label: "Weekly", value: "", tone: "behind", fraction: 0.5, expectedFraction: null },
        { label: "Extra", value: "", tone: "behind", fraction: 0.9 },
      ])
    )
    expect(metrics.map((m) => [m.label, m.used, m.expected])).toEqual([
      ["Session", 18, 31],
      ["Weekly", 50, null],
    ])
  })

  it("is empty without numeric fractions", () => {
    expect(selectDockMetrics(provider([{ label: "", value: "—", tone: "neutral" }]))).toEqual([])
    expect(selectDockMetrics(provider([{ label: "A", value: "", tone: "ahead", fraction: NaN }]))).toEqual([])
  })
})

describe("value text and labels", () => {
  it("splits used and expected into two runs", () => {
    expect(valueRuns({ used: 42, expected: 38 })).toEqual([
      { text: "42", weight: 700, scale: 1, alpha: 1 },
      { text: "/38", weight: 500, scale: 0.82, alpha: 0.6 },
    ])
  })

  it("draws used% in one run without an expected value", () => {
    expect(valueRuns({ used: 42, expected: null })).toEqual([{ text: "42%", weight: 700, scale: 1, alpha: 1 }])
  })

  it("shortens labels to one uppercase letter", () => {
    expect(shortLabel("Session")).toBe("S")
    expect(shortLabel("weekly")).toBe("W")
    expect(shortLabel("")).toBe("")
  })
})

describe("renderDockOverlayPng", () => {
  it("returns null when there is nothing to draw", async () => {
    const png = await renderDockOverlayPng({ id: "claude", items: [] }, { colors: {}, toneModes: allColor })
    expect(png).toBeNull()
  })

  it("returns null when the canvas has no 2d context", async () => {
    const provider: TaskbarProvider = {
      id: "claude",
      items: [{ label: "Session", value: "", tone: "ahead", fraction: 0.2 }],
    }
    const png = await renderDockOverlayPng(provider, { colors: {}, toneModes: allColor })
    expect(png).toBeNull()
  })
})

describe("dockTextFills", () => {
  it("colors only the parts set to color, with the menu bar alphas", () => {
    expect(dockTextFills("#ff6251", { label: "mono", used: "color", expected: "mono" })).toEqual({
      label: "rgba(255,255,255,0.6)",
      used: "rgba(255,98,81,1)",
      expected: "rgba(255,255,255,0.55)",
    })
    expect(dockTextFills("#ff6251", { label: "color", used: "color", expected: "color" })).toEqual({
      label: "rgba(255,98,81,0.85)",
      used: "rgba(255,98,81,1)",
      expected: "rgba(255,98,81,0.6)",
    })
  })
  it("keeps every part white when the tone is mono", () => {
    expect(dockTextFills("#f2f2f2", { label: "color", used: "color", expected: "color" })).toEqual({
      label: "rgba(255,255,255,0.6)",
      used: "rgba(255,255,255,1)",
      expected: "rgba(255,255,255,0.55)",
    })
  })
})
