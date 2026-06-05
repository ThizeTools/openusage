import { describe, expect, it } from "vitest"
import { buildWidgetRows } from "@/lib/widget-rows"
import type { PluginMeta, PluginOutput } from "@/lib/plugin-types"
import type { PluginState } from "@/hooks/app/types"
import type { PluginSettings } from "@/lib/settings"

function meta(id: string, labels: string[], name = id): PluginMeta {
  return {
    id,
    name,
    iconUrl: `${id}.svg`,
    brandColor: "#abcdef",
    lines: labels.map((label) => ({ type: "progress", label, scope: "overview" })),
    primaryCandidates: labels,
  }
}

function state(
  providerId: string,
  lines: { label: string; used: number; limit: number; resetsAt?: string; periodDurationMs?: number }[]
): PluginState {
  const data: PluginOutput = {
    providerId,
    displayName: providerId,
    iconUrl: `${providerId}.svg`,
    lines: lines.map((l) => ({
      type: "progress",
      label: l.label,
      used: l.used,
      limit: l.limit,
      format: { kind: "percent" },
      resetsAt: l.resetsAt,
      periodDurationMs: l.periodDurationMs,
    })),
  }
  return { data, loading: false, error: null, lastManualRefreshAt: null, lastUpdatedAt: null }
}

const settings = (order: string[], disabled: string[] = []): PluginSettings => ({ order, disabled })

describe("buildWidgetRows", () => {
  it("returns empty when settings missing", () => {
    expect(buildWidgetRows({ pluginsMeta: [], pluginSettings: null, pluginStates: {} })).toEqual([])
  })

  it("shows the used fraction of the primary bar per provider", () => {
    const rows = buildWidgetRows({
      pluginsMeta: [meta("claude", ["Weekly", "Session"], "Claude")],
      pluginSettings: settings(["claude"]),
      pluginStates: {
        claude: state("claude", [
          { label: "Weekly", used: 25, limit: 100 },
          { label: "Session", used: 1, limit: 100 },
        ]),
      },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: "claude", name: "Claude", iconUrl: "claude.svg" })
    // Primary candidate is the first match → Weekly 25/100.
    expect(rows[0].fraction).toBeCloseTo(0.25, 4)
    expect(rows[0].tone).toBe("neutral")
  })

  it("colors by pace (on-track)", () => {
    const periodMs = 7 * 24 * 60 * 60 * 1000
    const nowMs = 1_000_000_000_000
    const resetsAt = new Date(nowMs + periodMs / 2).toISOString()
    const rows = buildWidgetRows({
      pluginsMeta: [meta("claude", ["Weekly"])],
      pluginSettings: settings(["claude"]),
      pluginStates: {
        claude: state("claude", [
          { label: "Weekly", used: 45, limit: 100, resetsAt, periodDurationMs: periodMs },
        ]),
      },
      nowMs,
    })
    // used/expected = 0.45/0.5 = 0.9 → on-track
    expect(rows[0].fraction).toBeCloseTo(0.45, 4)
    expect(rows[0].tone).toBe("on-track")
  })

  it("colors by pace (ahead)", () => {
    const periodMs = 7 * 24 * 60 * 60 * 1000
    const nowMs = 1_000_000_000_000
    const resetsAt = new Date(nowMs + periodMs / 2).toISOString()
    const rows = buildWidgetRows({
      pluginsMeta: [meta("claude", ["Weekly"])],
      pluginSettings: settings(["claude"]),
      pluginStates: {
        claude: state("claude", [
          { label: "Weekly", used: 40, limit: 100, resetsAt, periodDurationMs: periodMs },
        ]),
      },
      nowMs,
    })
    expect(rows[0].tone).toBe("ahead") // used/expected = 0.8 → ahead
  })

  it("excludes disabled plugins and keeps order", () => {
    const rows = buildWidgetRows({
      pluginsMeta: [meta("a", ["Weekly"]), meta("b", ["Weekly"]), meta("c", ["Weekly"])],
      pluginSettings: settings(["c", "a", "b"], ["a"]),
      pluginStates: {
        b: state("b", [{ label: "Weekly", used: 1, limit: 10 }]),
        c: state("c", [{ label: "Weekly", used: 1, limit: 10 }]),
      },
    })
    expect(rows.map((r) => r.id)).toEqual(["c", "b"])
  })

  it("filters providers by widgetProviderIds without disabling them globally", () => {
    const rows = buildWidgetRows({
      pluginsMeta: [meta("a", ["Weekly"]), meta("b", ["Weekly"]), meta("c", ["Weekly"])],
      pluginSettings: settings(["a", "b", "c"]),
      pluginStates: {
        a: state("a", [{ label: "Weekly", used: 1, limit: 10 }]),
        b: state("b", [{ label: "Weekly", used: 2, limit: 10 }]),
        c: state("c", [{ label: "Weekly", used: 3, limit: 10 }]),
      },
      widgetProviderIds: ["b"],
    })
    expect(rows.map((r) => r.id)).toEqual(["b"])
  })

  it("returns null fraction when data is missing", () => {
    const rows = buildWidgetRows({
      pluginsMeta: [meta("claude", ["Weekly"])],
      pluginSettings: settings(["claude"]),
      pluginStates: {},
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].fraction).toBeNull()
    expect(rows[0].limitedUntilMs).toBeUndefined()
  })

  it("flags the provider as limited when a non-shown metric hits its limit", () => {
    const nowMs = 1_000_000_000_000
    const sessionResetsAt = new Date(nowMs + 2 * 60 * 60 * 1000).toISOString()
    const rows = buildWidgetRows({
      pluginsMeta: [meta("claude", ["Weekly", "Session"])],
      pluginSettings: settings(["claude"]),
      pluginStates: {
        claude: state("claude", [
          // Widget shows Weekly (45%), but the 5h session is maxed out.
          { label: "Weekly", used: 45, limit: 100 },
          { label: "Session", used: 100, limit: 100, resetsAt: sessionResetsAt, periodDurationMs: 5 * 60 * 60 * 1000 },
        ]),
      },
      nowMs,
    })
    expect(rows[0].limitedUntilMs).toBe(Date.parse(sessionResetsAt))
    expect(rows[0].tone).toBe("behind")
    expect(rows[0].fraction).toBeCloseTo(0.45, 4)
  })

  it("uses the latest reset when several limits are reached", () => {
    const nowMs = 1_000_000_000_000
    const sessionResetsAt = new Date(nowMs + 2 * 60 * 60 * 1000).toISOString()
    const weeklyResetsAt = new Date(nowMs + 3 * 24 * 60 * 60 * 1000).toISOString()
    const rows = buildWidgetRows({
      pluginsMeta: [meta("claude", ["Weekly", "Session"])],
      pluginSettings: settings(["claude"]),
      pluginStates: {
        claude: state("claude", [
          { label: "Weekly", used: 100, limit: 100, resetsAt: weeklyResetsAt, periodDurationMs: 7 * 24 * 60 * 60 * 1000 },
          { label: "Session", used: 100, limit: 100, resetsAt: sessionResetsAt, periodDurationMs: 5 * 60 * 60 * 1000 },
        ]),
      },
      nowMs,
    })
    expect(rows[0].limitedUntilMs).toBe(Date.parse(weeklyResetsAt))
  })

  it("ignores reached limits whose reset is already in the past", () => {
    const nowMs = 1_000_000_000_000
    const pastResetsAt = new Date(nowMs - 60 * 1000).toISOString()
    const rows = buildWidgetRows({
      pluginsMeta: [meta("claude", ["Weekly"])],
      pluginSettings: settings(["claude"]),
      pluginStates: {
        claude: state("claude", [
          { label: "Weekly", used: 100, limit: 100, resetsAt: pastResetsAt, periodDurationMs: 7 * 24 * 60 * 60 * 1000 },
        ]),
      },
      nowMs,
    })
    expect(rows[0].limitedUntilMs).toBeUndefined()
  })
})
