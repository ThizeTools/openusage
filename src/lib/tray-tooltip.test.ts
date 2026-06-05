import { describe, expect, it } from "vitest"
import { formatTrayPercentNumberText, formatTrayPercentText, formatTrayTooltip } from "./tray-tooltip"
import type { PluginMeta } from "./plugin-types"
import type { TrayPrimaryBar } from "./tray-primary-progress"

describe("tray-tooltip", () => {
  describe("formatTrayPercentText", () => {
    it("should format valid fractions", () => {
      expect(formatTrayPercentText(0.45)).toBe("45%")
      expect(formatTrayPercentText(0)).toBe("0%")
      expect(formatTrayPercentText(1)).toBe("100%")
    })

    it("should round fractions", () => {
      expect(formatTrayPercentText(0.456)).toBe("46%")
      expect(formatTrayPercentText(0.454)).toBe("45%")
    })

    it("should clamp fractions", () => {
      expect(formatTrayPercentText(-0.1)).toBe("0%")
      expect(formatTrayPercentText(1.1)).toBe("100%")
    })

    it("should handle undefined and NaN", () => {
      expect(formatTrayPercentText(undefined)).toBe("--%")
      expect(formatTrayPercentText(NaN)).toBe("--%")
    })
  })

  describe("formatTrayPercentNumberText", () => {
    it("should format valid fractions without percent sign", () => {
      expect(formatTrayPercentNumberText(0.45)).toBe("45")
      expect(formatTrayPercentNumberText(0)).toBe("0")
      expect(formatTrayPercentNumberText(1)).toBe("99")
    })

    it("should handle undefined and NaN without percent sign", () => {
      expect(formatTrayPercentNumberText(undefined)).toBe("--")
      expect(formatTrayPercentNumberText(NaN)).toBe("--")
    })
  })

  describe("formatTrayTooltip", () => {
    const mockMeta: PluginMeta[] = [
      { id: "p1", name: "Plugin 1", iconUrl: "", lines: [], links: [], primaryCandidates: [] },
      { id: "p2", name: "Plugin 2", iconUrl: "", lines: [], links: [], primaryCandidates: [] },
    ]

    it("should show app name when no bars", () => {
      expect(formatTrayTooltip([], mockMeta)).toBe("OpenUsage")
    })

    it("should list enabled plugins with percentages", () => {
      const bars: TrayPrimaryBar[] = [
        { id: "p1", label: "Session", fraction: 0.45, usedFraction: 0.45 },
        { id: "p2", label: "Weekly", fraction: 0.12, usedFraction: 0.12 },
      ]
      const tooltip = formatTrayTooltip(bars, mockMeta)
      expect(tooltip).toBe("OpenUsage\nPlugin 1: 45%h\nPlugin 2: 12%w")
    })

    it("should handle missing plugin metadata gracefully", () => {
      const bars: TrayPrimaryBar[] = [
        { id: "p1", label: "Session", fraction: 0.45, usedFraction: 0.45 },
        { id: "unknown", label: "Session", fraction: 0.5, usedFraction: 0.5 },
      ]
      const tooltip = formatTrayTooltip(bars, mockMeta)
      expect(tooltip).toBe("OpenUsage\nPlugin 1: 45%h")
    })

    it("should show --% for missing fractions", () => {
      const bars: TrayPrimaryBar[] = [
        { id: "p1", label: "Session", fraction: undefined },
      ]
      const tooltip = formatTrayTooltip(bars, mockMeta)
      expect(tooltip).toBe("OpenUsage\nPlugin 1: --%h")
    })

    it("should group plugin metrics on one compact line", () => {
      const bars: TrayPrimaryBar[] = [
        { id: "p1", label: "Weekly", fraction: 0.42, usedFraction: 0.42, expectedFraction: 0.4 },
        { id: "p1", label: "5h Rate Limit", fraction: 0.12, usedFraction: 0.12, expectedFraction: 0.1 },
        { id: "p2", label: "Monthly", fraction: 0.15, usedFraction: 0.15 },
      ]
      const tooltip = formatTrayTooltip(bars, mockMeta)
      expect(tooltip).toBe("OpenUsage\nPlugin 1: 42%w - 12%h\nPlugin 2: 15%m")
    })

    it("should keep long native tray tooltips under the Windows limit", () => {
      const bars: TrayPrimaryBar[] = Array.from({ length: 30 }, (_, index) => ({
        id: index % 2 === 0 ? "p1" : "p2",
        label: index % 3 === 0 ? "5h Rate Limit" : "Weekly",
        fraction: 0.1 + index / 100,
        usedFraction: 0.1 + index / 100,
        expectedFraction: 0.2,
      }))

      const tooltip = formatTrayTooltip(bars, mockMeta)
      expect(tooltip.length).toBeLessThanOrEqual(127)
      expect(tooltip).toContain("more")
    })
  })
})
