import { describe, expect, it } from "vitest"
import { buildMenuBarBackdrop, buildTaskbarPayload } from "@/lib/taskbar-payload"
import { formatAvailableAt } from "@/lib/widget-format"
import type { WidgetRow } from "@/lib/widget-rows"

function makeRow(overrides: Partial<WidgetRow> = {}): WidgetRow {
  return {
    id: "claude",
    name: "Claude",
    iconUrl: "data:image/svg+xml;base64,ABC",
    brandColor: "#d97757",
    fraction: 0.25,
    expectedFraction: null,
    tone: "ahead",
    ...overrides,
  }
}

describe("buildTaskbarPayload", () => {
  it("shows the availability time for a limited provider", () => {
    const limitedUntilMs = Date.now() + 3 * 60 * 60 * 1000
    const payload = buildTaskbarPayload([makeRow({ limitedUntilMs, tone: "behind" })])

    expect(payload.providers[0]?.items).toEqual([
      { label: "", value: formatAvailableAt(limitedUntilMs), tone: "neutral" },
    ])
  })

  it("emits one item per metric when metrics are present", () => {
    const payload = buildTaskbarPayload([
      makeRow({
        metrics: [
          { label: "Session", fraction: 0.42, expectedFraction: 0.3, tone: "behind" },
          { label: "Weekly", fraction: 0.1, tone: "ahead" },
        ],
      }),
    ])

    expect(payload.providers[0]?.items).toEqual([
      { label: "Session", value: "42%/30%", tone: "behind" },
      { label: "Weekly", value: "10%", tone: "ahead" },
    ])
  })

  it("shows a neutral dash when the fraction is unknown", () => {
    const payload = buildTaskbarPayload([makeRow({ fraction: null, tone: "neutral" })])

    expect(payload.providers[0]?.items).toEqual([{ label: "", value: "—", tone: "neutral" }])
  })

  it("shows the single fraction with pace expectation and row tone", () => {
    const payload = buildTaskbarPayload([makeRow({ fraction: 0.5, expectedFraction: 0.25, tone: "on-track" })])

    expect(payload.providers[0]?.items).toEqual([
      { label: "", value: "50%/25%", tone: "on-track" },
    ])
  })

  it("builds the tooltip with a title line and one line per row", () => {
    const limitedUntilMs = Date.now() + 3 * 60 * 60 * 1000
    const payload = buildTaskbarPayload([
      makeRow({ id: "claude", name: "Claude", fraction: 0.25 }),
      makeRow({
        id: "codex",
        name: "Codex",
        fraction: null,
        metrics: [
          { label: "Session", fraction: 0.4, tone: "ahead" },
          { label: "Weekly", fraction: 0.6, tone: "on-track" },
        ],
      }),
      makeRow({ id: "cursor", name: "Cursor", fraction: 0.9, limitedUntilMs, tone: "behind" }),
    ])

    expect(payload.tooltip).toBe(
      [
        "OpenUsage",
        "Claude: 25%",
        "Codex: Session 40% · Weekly 60%",
        `Cursor: limit reached — available ${formatAvailableAt(limitedUntilMs)}`,
      ].join("\n")
    )
  })

  it("keeps provider ids and icon urls for the icon mask step", () => {
    const payload = buildTaskbarPayload([makeRow({ id: "claude", iconUrl: "data:image/svg+xml;base64,XYZ" })])

    expect(payload.providers[0]).toMatchObject({
      id: "claude",
      brandColor: "#d97757",
      iconUrl: "data:image/svg+xml;base64,XYZ",
    })
  })
})

describe("buildMenuBarBackdrop", () => {
  const backdrop = { enabled: true, color: "auto" as const, opacity: 60, glass: 40, blur: 50 }
  const size = { width: 120.5, height: 22 }

  it("requests a native blur of blur / 100 under the image rect", () => {
    expect(buildMenuBarBackdrop(backdrop, size, 7)).toEqual({ blur: 0.5, radius: 7, widthPt: 120.5, heightPt: 22 })
    expect(buildMenuBarBackdrop({ ...backdrop, blur: 100 }, size, 7)?.blur).toBe(1)
  })

  it("is null when the background is disabled", () => {
    expect(buildMenuBarBackdrop({ ...backdrop, enabled: false }, size, 7)).toBeNull()
  })

  it("is null when blur is 0", () => {
    expect(buildMenuBarBackdrop({ ...backdrop, blur: 0 }, size, 7)).toBeNull()
  })

  it("is null when the image size is unknown", () => {
    expect(buildMenuBarBackdrop(backdrop, null, 7)).toBeNull()
  })
})
