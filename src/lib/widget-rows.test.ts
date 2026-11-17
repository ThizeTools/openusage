import { describe, expect, it } from "vitest"
import {
  buildWidgetRows,
  getDefaultProviderMetrics,
  getProviderMetricOptions,
} from "@/lib/widget-rows"
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

  it("shows the used fraction of the first shown metric per provider", () => {
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
    // Default claude selection is Session + Weekly; the first in plugin order is Weekly 25/100.
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
    expect(rows[0].metrics).toEqual([])
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
      widgetProviderMetrics: { claude: ["Weekly"] },
      nowMs,
    })
    expect(rows[0].limitedUntilMs).toBe(Date.parse(sessionResetsAt))
    expect(rows[0].tone).toBe("behind")
    expect(rows[0].fraction).toBeCloseTo(0.45, 4)
    expect(rows[0].metrics!.map((m) => m.label)).toEqual(["Weekly"])
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

  it("default metrics for an account instance use the base provider (Session + Weekly)", () => {
    const rows = buildWidgetRows({
      pluginsMeta: [meta("claude@1a2b3c4d", ["Session", "Weekly", "Sonnet"], "Claude · work")],
      pluginSettings: settings(["claude@1a2b3c4d"]),
      pluginStates: {
        "claude@1a2b3c4d": state("claude@1a2b3c4d", [
          { label: "Weekly", used: 25, limit: 100 },
          { label: "Session", used: 80, limit: 100 },
          { label: "Sonnet", used: 10, limit: 100 },
        ]),
      },
    })
    expect(rows[0].metrics!.map((m) => m.label)).toEqual(["Session", "Weekly"])
  })

  it("shows only the selected metrics, in plugin line order", () => {
    const rows = buildWidgetRows({
      pluginsMeta: [meta("claude", ["Session", "Weekly", "Sonnet"], "Claude")],
      pluginSettings: settings(["claude"]),
      pluginStates: {
        claude: state("claude", [
          { label: "Session", used: 80, limit: 100 },
          { label: "Weekly", used: 25, limit: 100 },
          { label: "Sonnet", used: 10, limit: 100 },
        ]),
      },
      // Selection order differs from the plugin's line order on purpose.
      widgetProviderMetrics: { claude: ["Sonnet", "Weekly"] },
    })
    expect(rows[0].metrics!.map((m) => m.label)).toEqual(["Weekly", "Sonnet"])
    expect(rows[0].metrics!.map((m) => m.fraction)).toEqual([0.25, 0.1])
    expect(rows[0].fraction).toBeCloseTo(0.25, 4)
  })

  it("a single selected metric is the only one shown", () => {
    const rows = buildWidgetRows({
      pluginsMeta: [meta("claude", ["Weekly", "Session"], "Claude")],
      pluginSettings: settings(["claude"]),
      pluginStates: {
        claude: state("claude", [
          { label: "Weekly", used: 25, limit: 100 },
          { label: "Session", used: 80, limit: 100 },
        ]),
      },
      widgetProviderMetrics: { claude: ["Session"] },
    })
    expect(rows[0].metrics!.map((m) => m.label)).toEqual(["Session"])
    expect(rows[0].fraction).toBeCloseTo(0.8, 4)
  })

  it("an empty selection hides the provider", () => {
    const rows = buildWidgetRows({
      pluginsMeta: [meta("claude", ["Weekly"]), meta("codex", ["Weekly"])],
      pluginSettings: settings(["claude", "codex"]),
      pluginStates: {
        claude: state("claude", [{ label: "Weekly", used: 1, limit: 10 }]),
        codex: state("codex", [{ label: "Weekly", used: 1, limit: 10 }]),
      },
      widgetProviderMetrics: { claude: [] },
    })
    expect(rows.map((r) => r.id)).toEqual(["codex"])
  })

  it("keeps a provider with a selection but no data as a dash row", () => {
    const rows = buildWidgetRows({
      pluginsMeta: [meta("claude", ["Weekly"])],
      pluginSettings: settings(["claude"]),
      pluginStates: {},
      widgetProviderMetrics: { claude: ["Weekly"] },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].fraction).toBeNull()
    expect(rows[0].metrics).toEqual([])
  })

  it("default metrics per known provider follow the suggestion list", () => {
    const rows = buildWidgetRows({
      pluginsMeta: [
        meta("codex", ["Session", "Weekly", "Spark", "Spark Weekly"], "Codex"),
        meta("claude", ["Session", "Weekly", "Extra"], "Claude"),
        meta("cursor", ["Total Usage", "Requests"], "Cursor"),
      ],
      pluginSettings: settings(["codex", "claude", "cursor"]),
      pluginStates: {
        codex: state("codex", [
          { label: "Session", used: 25, limit: 100 },
          { label: "Weekly", used: 50, limit: 100 },
          { label: "Spark", used: 10, limit: 100 },
          { label: "Spark Weekly", used: 20, limit: 100 },
        ]),
        claude: state("claude", [
          { label: "Session", used: 30, limit: 100 },
          { label: "Weekly", used: 40, limit: 100 },
          { label: "Extra", used: 90, limit: 100 },
        ]),
        cursor: state("cursor", [
          { label: "Total Usage", used: 60, limit: 100 },
          { label: "Requests", used: 70, limit: 100 },
        ]),
      },
    })

    expect(rows[0].metrics!.map((m) => m.label)).toEqual(["Session", "Weekly", "Spark", "Spark Weekly"])
    expect(rows[1].metrics!.map((m) => m.label)).toEqual(["Session", "Weekly"])
    expect(rows[2].metrics!.map((m) => m.label)).toEqual(["Total Usage"])
  })

  it("default metrics only include Spark metrics when Codex data has usage", () => {
    const rows = buildWidgetRows({
      pluginsMeta: [meta("codex", ["Session", "Weekly", "Spark", "Spark Weekly"], "Codex")],
      pluginSettings: settings(["codex"]),
      pluginStates: {
        codex: state("codex", [
          { label: "Session", used: 25, limit: 100 },
          { label: "Weekly", used: 50, limit: 100 },
          { label: "Spark", used: 0, limit: 100 },
          { label: "Spark Weekly", used: 0, limit: 100 },
        ]),
      },
    })

    expect(rows[0].metrics!.map((m) => m.label)).toEqual(["Session", "Weekly"])
  })

  it("default metrics for unknown providers are the first two primary candidates", () => {
    const other = { ...meta("other", ["A", "B", "C"], "Other"), primaryCandidates: ["C", "A", "B"] }
    expect(getDefaultProviderMetrics(other)).toEqual(["C", "A"])

    const rows = buildWidgetRows({
      pluginsMeta: [other],
      pluginSettings: settings(["other"]),
      pluginStates: {
        other: state("other", [
          { label: "A", used: 25, limit: 100 },
          { label: "B", used: 50, limit: 100 },
          { label: "C", used: 75, limit: 100 },
        ]),
      },
    })
    // Shown in plugin line order, not candidate order.
    expect(rows[0].metrics!.map((m) => m.label)).toEqual(["A", "C"])
  })

  it("default metrics fall back to the first two manifest progress lines", () => {
    const bare: PluginMeta = { ...meta("bare", ["X", "Y", "Z"]), primaryCandidates: [] }
    expect(getDefaultProviderMetrics(bare)).toEqual(["X", "Y"])
  })

  it("lists manifest progress labels once, in manifest order", () => {
    const withText: PluginMeta = {
      ...meta("p", []),
      lines: [
        { type: "progress", label: "A", scope: "overview" },
        { type: "text", label: "T", scope: "overview" },
        { type: "progress", label: "B", scope: "detail" },
        { type: "progress", label: "A", scope: "detail" },
      ],
    }
    expect(getProviderMetricOptions(withText)).toEqual(["A", "B"])
  })

  it("passes expected fraction through rows and metrics", () => {
    const periodMs = 7 * 24 * 60 * 60 * 1000
    const nowMs = 1_000_000_000_000
    const resetsAt = new Date(nowMs + periodMs / 2).toISOString()
    const rows = buildWidgetRows({
      pluginsMeta: [meta("claude", ["Weekly", "Session"], "Claude")],
      pluginSettings: settings(["claude"]),
      pluginStates: {
        claude: state("claude", [
          { label: "Weekly", used: 25, limit: 100, resetsAt, periodDurationMs: periodMs },
          { label: "Session", used: 80, limit: 100, resetsAt, periodDurationMs: periodMs },
        ]),
      },
      nowMs,
    })

    expect(rows[0].expectedFraction).toBeCloseTo(0.5, 4)
    expect(rows[0].metrics!.map((m) => m.expectedFraction)).toEqual([0.5, 0.5])
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
