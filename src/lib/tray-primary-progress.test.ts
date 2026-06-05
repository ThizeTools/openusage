import { describe, expect, it } from "vitest"

import { getTrayPrimaryBars } from "@/lib/tray-primary-progress"

describe("getTrayPrimaryBars", () => {
  it("returns empty when settings missing", () => {
    const bars = getTrayPrimaryBars({
      pluginsMeta: [],
      pluginSettings: null,
      pluginStates: {},
    })
    expect(bars).toEqual([])
  })

  it("keeps plugin order, filters disabled, limits to 4", () => {
    const pluginsMeta = ["a", "b", "c", "d", "e"].map((id) => ({
      id,
      name: id.toUpperCase(),
      iconUrl: "",
      primaryCandidates: ["Usage"],
      lines: [],
    }))

    const bars = getTrayPrimaryBars({
      pluginsMeta,
      pluginSettings: { order: ["a", "b", "c", "d", "e"], disabled: ["c"] },
      pluginStates: {},
    })

    expect(bars.map((b) => b.id)).toEqual(["a", "b", "d", "e"])
  })

  it("can target a specific plugin id for tray rendering", () => {
    const bars = getTrayPrimaryBars({
      pluginsMeta: [
        {
          id: "a",
          name: "A",
          iconUrl: "",
          primaryCandidates: ["Session"],
          lines: [],
        },
        {
          id: "b",
          name: "B",
          iconUrl: "",
          primaryCandidates: ["Session"],
          lines: [],
        },
      ],
      pluginSettings: { order: ["a", "b"], disabled: [] },
      pluginStates: {
        b: {
          data: {
            providerId: "b",
            displayName: "B",
            iconUrl: "",
            lines: [
              {
                type: "progress",
                label: "Session",
                used: 25,
                limit: 100,
                format: { kind: "percent" },
              },
            ],
          },
          loading: false,
          error: null,
        },
      },
      pluginId: "b",
    })

    expect(bars).toEqual([{ id: "b", label: "Session", fraction: 0.25, used: 25, usedFraction: 0.25, expectedFraction: undefined }])
  })

  it("includes plugins with primary candidates even when no data (fraction undefined)", () => {
    const bars = getTrayPrimaryBars({
      pluginsMeta: [
        {
          id: "a",
          name: "A",
          iconUrl: "",
          primaryCandidates: ["Session"],
          lines: [],
        },
      ],
      pluginSettings: { order: ["a"], disabled: [] },
      pluginStates: { a: { data: null, loading: false, error: null } },
    })
    expect(bars).toEqual([{ id: "a", label: undefined, fraction: undefined, usedFraction: undefined, expectedFraction: undefined }])
  })

  it("computes fraction from matching progress label and clamps 0..1", () => {
    const bars = getTrayPrimaryBars({
      pluginsMeta: [
        {
          id: "a",
          name: "A",
          iconUrl: "",
          primaryCandidates: ["Plan usage"],
          lines: [],
        },
      ],
      pluginSettings: { order: ["a"], disabled: [] },
      pluginStates: {
        a: {
          data: {
            providerId: "a",
            displayName: "A",
            iconUrl: "",
            lines: [
              {
                type: "progress",
                label: "Plan usage",
                used: 150,
                limit: 100,
                format: { kind: "dollars" },
              },
            ],
          },
          loading: false,
          error: null,
        },
      },
    })

    expect(bars).toEqual([{ id: "a", label: "Plan usage", fraction: 1, used: 150, usedFraction: 1, expectedFraction: undefined }])
  })

  it("does not compute fraction when limit is 0", () => {
    const bars = getTrayPrimaryBars({
      pluginsMeta: [
        {
          id: "a",
          name: "A",
          iconUrl: "",
          primaryCandidates: ["Plan usage"],
          lines: [],
        },
      ],
      pluginSettings: { order: ["a"], disabled: [] },
      pluginStates: {
        a: {
          data: {
            providerId: "a",
            displayName: "A",
            iconUrl: "",
            lines: [
              {
                type: "progress",
                label: "Plan usage",
                used: 10,
                limit: 0,
                format: { kind: "percent" },
              },
            ],
          },
          loading: false,
          error: null,
        },
      },
    })
    expect(bars).toEqual([{ id: "a", label: undefined, fraction: undefined, usedFraction: undefined, expectedFraction: undefined }])
  })

  it("exposes used and expected fractions when pace context exists", () => {
    const nowMs = Date.parse("2026-02-02T12:00:00.000Z")
    const bars = getTrayPrimaryBars({
      nowMs,
      pluginsMeta: [
        {
          id: "a",
          name: "A",
          iconUrl: "",
          primaryCandidates: ["Session"],
          lines: [],
        },
      ],
      pluginSettings: { order: ["a"], disabled: [] },
      pluginStates: {
        a: {
          data: {
            providerId: "a",
            displayName: "A",
            iconUrl: "",
            lines: [
              {
                type: "progress",
                label: "Session",
                used: 90,
                limit: 100,
                format: { kind: "percent" },
                resetsAt: "2026-02-03T00:00:00.000Z",
                periodDurationMs: 24 * 60 * 60 * 1000,
              },
            ],
          },
          loading: false,
          error: null,
        },
      },
    })
    expect(bars).toEqual([{ id: "a", label: "Session", fraction: 0.9, used: 90, usedFraction: 0.9, expectedFraction: 0.5 }])
  })

  it("picks first available candidate from primaryCandidates", () => {
    const bars = getTrayPrimaryBars({
      pluginsMeta: [
        {
          id: "a",
          name: "A",
          iconUrl: "",
          primaryCandidates: ["Credits", "Plan usage"], // Credits first, Plan usage fallback
          lines: [],
        },
      ],
      pluginSettings: { order: ["a"], disabled: [] },
      pluginStates: {
        a: {
          data: {
            providerId: "a",
            displayName: "A",
            iconUrl: "",
            lines: [
              // Only Plan usage available, Credits missing
              {
                type: "progress",
                label: "Plan usage",
                used: 50,
                limit: 100,
                format: { kind: "dollars" },
              },
            ],
          },
          loading: false,
          error: null,
        },
      },
    })
    expect(bars).toEqual([{ id: "a", label: "Plan usage", fraction: 0.5, used: 50, usedFraction: 0.5, expectedFraction: undefined }])
  })

  it("uses first candidate when both are available", () => {
    const bars = getTrayPrimaryBars({
      pluginsMeta: [
        {
          id: "a",
          name: "A",
          iconUrl: "",
          primaryCandidates: ["Credits", "Plan usage"],
          lines: [],
        },
      ],
      pluginSettings: { order: ["a"], disabled: [] },
      pluginStates: {
        a: {
          data: {
            providerId: "a",
            displayName: "A",
            iconUrl: "",
            lines: [
              {
                type: "progress",
                label: "Credits",
                used: 20,
                limit: 100,
                format: { kind: "dollars" },
              },
              {
                type: "progress",
                label: "Plan usage",
                used: 80,
                limit: 100,
                format: { kind: "dollars" },
              },
            ],
          },
          loading: false,
          error: null,
        },
      },
    })
    // Should use Credits (20/100 = 0.2), not Plan usage (80/100 = 0.8)
    expect(bars).toEqual([{ id: "a", label: "Credits", fraction: 0.2, used: 20, usedFraction: 0.2, expectedFraction: undefined }])
  })

  it("uses preferred labels before overview labels", () => {
    const bars = getTrayPrimaryBars({
      pluginsMeta: [
        {
          id: "a",
          name: "A",
          iconUrl: "",
          primaryCandidates: ["Session"],
          lines: [
            { type: "progress", label: "Session", scope: "overview" },
            { type: "progress", label: "Total usage", scope: "overview" },
          ],
        },
      ],
      pluginSettings: { order: ["a"], disabled: [] },
      pluginStates: {
        a: {
          data: {
            providerId: "a",
            displayName: "A",
            iconUrl: "",
            lines: [
              {
                type: "progress",
                label: "Session",
                used: 25,
                limit: 100,
                format: { kind: "percent" },
              },
              {
                type: "progress",
                label: "Total usage",
                used: 80,
                limit: 100,
                format: { kind: "percent" },
              },
            ],
          },
          loading: false,
          error: null,
        },
      },
      preferredLabels: ["Total usage", "Session"],
    })

    expect(bars).toEqual([{ id: "a", label: "Total usage", fraction: 0.8, used: 80, usedFraction: 0.8, expectedFraction: undefined }])
  })

  it("falls back to primary candidates when preferred labels are unavailable", () => {
    const bars = getTrayPrimaryBars({
      pluginsMeta: [
        {
          id: "a",
          name: "A",
          iconUrl: "",
          primaryCandidates: ["Session"],
          lines: [
            { type: "progress", label: "Session", scope: "overview" },
            { type: "progress", label: "Weekly", scope: "overview" },
          ],
        },
      ],
      pluginSettings: { order: ["a"], disabled: [] },
      pluginStates: {
        a: {
          data: {
            providerId: "a",
            displayName: "A",
            iconUrl: "",
            lines: [
              {
                type: "progress",
                label: "Session",
                used: 25,
                limit: 100,
                format: { kind: "percent" },
              },
            ],
          },
          loading: false,
          error: null,
        },
      },
      preferredLabels: ["Weekly"],
    })

    expect(bars).toEqual([{ id: "a", label: "Session", fraction: 0.25, used: 25, usedFraction: 0.25, expectedFraction: undefined }])
  })

  it("can limit matches to preferred labels only", () => {
    const bars = getTrayPrimaryBars({
      pluginsMeta: [
        {
          id: "a",
          name: "A",
          iconUrl: "",
          primaryCandidates: ["Session"],
          lines: [
            { type: "progress", label: "Session", scope: "overview" },
            { type: "progress", label: "Weekly", scope: "overview" },
          ],
        },
      ],
      pluginSettings: { order: ["a"], disabled: [] },
      pluginStates: {
        a: {
          data: {
            providerId: "a",
            displayName: "A",
            iconUrl: "",
            lines: [
              {
                type: "progress",
                label: "Session",
                used: 25,
                limit: 100,
                format: { kind: "percent" },
              },
            ],
          },
          loading: false,
          error: null,
        },
      },
      preferredLabels: ["Weekly"],
      preferredLabelsOnly: true,
    })

    expect(bars).toEqual([{ id: "a", label: undefined, fraction: undefined, usedFraction: undefined, expectedFraction: undefined }])
  })

  it("can return multiple preferred matches per plugin", () => {
    const bars = getTrayPrimaryBars({
      pluginsMeta: [
        {
          id: "codex",
          name: "Codex",
          iconUrl: "",
          primaryCandidates: ["Session"],
          lines: [
            { type: "progress", label: "Session", scope: "overview" },
            { type: "progress", label: "Weekly", scope: "overview" },
          ],
        },
      ],
      pluginSettings: { order: ["codex"], disabled: [] },
      pluginStates: {
        codex: {
          data: {
            providerId: "codex",
            displayName: "Codex",
            iconUrl: "",
            lines: [
              { type: "progress", label: "Session", used: 75, limit: 100, format: { kind: "percent" } },
              { type: "progress", label: "Weekly", used: 20, limit: 100, format: { kind: "percent" } },
            ],
          },
          loading: false,
          error: null,
        },
      },
      preferredLabels: ["Total usage", "Session", "Weekly"],
      includeAllMatches: true,
    })

    expect(bars).toEqual([
      { id: "codex", label: "Session", fraction: 0.75, used: 75, usedFraction: 0.75, expectedFraction: undefined },
      { id: "codex", label: "Weekly", fraction: 0.2, used: 20, usedFraction: 0.2, expectedFraction: undefined },
    ])
  })

  it("skips plugins with empty primaryCandidates", () => {
    const bars = getTrayPrimaryBars({
      pluginsMeta: [
        {
          id: "a",
          name: "A",
          iconUrl: "",
          primaryCandidates: [],
          lines: [],
        },
      ],
      pluginSettings: { order: ["a"], disabled: [] },
      pluginStates: {},
    })
    expect(bars).toEqual([])
  })

  it("handles Claude fallback from Session to Weekly to Extra usage spent", () => {
    const pluginsMeta = [
      {
        id: "claude",
        name: "Claude",
        iconUrl: "",
        primaryCandidates: ["Session", "Weekly", "Extra usage spent"],
        lines: [],
      },
    ]

    const runTest = (
      lines: Array<{
        type: "progress"
        label: string
        used: number
        limit: number
        format: { kind: "dollars" | "percent" }
      }>
    ) => {
      return getTrayPrimaryBars({
        displayMode: "used",
        pluginsMeta,
        pluginSettings: { order: ["claude"], disabled: [] },
        pluginStates: {
          claude: {
            data: {
              providerId: "claude",
              displayName: "Claude",
              iconUrl: "",
              lines,
            },
            loading: false,
            error: null,
          },
        },
      })
    }

    // Case 1: Only Extra usage spent is available (e.g. Claude Enterprise/Team account overage)
    expect(
      runTest([
        {
          type: "progress",
          label: "Extra usage spent",
          used: 30,
          limit: 100,
          format: { kind: "dollars" },
        },
      ])
    ).toMatchObject([{ id: "claude", fraction: 0.3 }])

    // Case 2: Weekly is available (but Session is not)
    expect(
      runTest([
        {
          type: "progress",
          label: "Weekly",
          used: 40,
          limit: 100,
          format: { kind: "percent" },
        },
        {
          type: "progress",
          label: "Extra usage spent",
          used: 30,
          limit: 100,
          format: { kind: "dollars" },
        },
      ])
    ).toMatchObject([{ id: "claude", fraction: 0.4 }])

    // Case 3: Session is available alongside Weekly and Extra usage spent (Session should win)
    expect(
      runTest([
        {
          type: "progress",
          label: "Session",
          used: 50,
          limit: 100,
          format: { kind: "percent" },
        },
        {
          type: "progress",
          label: "Weekly",
          used: 40,
          limit: 100,
          format: { kind: "percent" },
        },
        {
          type: "progress",
          label: "Extra usage spent",
          used: 30,
          limit: 100,
          format: { kind: "dollars" },
        },
      ])
    ).toMatchObject([{ id: "claude", fraction: 0.5 }])
  })
})

