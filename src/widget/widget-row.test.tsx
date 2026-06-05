import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { WidgetRowItem } from "@/widget/widget-row"
import { getTimeFormatter } from "@/lib/reset-tooltip"
import type { WidgetRow } from "@/lib/widget-rows"

const row: WidgetRow = {
  id: "claude",
  name: "Claude",
  iconUrl: "claude.svg",
  brandColor: "#d97706",
  fraction: 0.62,
  tone: "neutral",
}

describe("WidgetRowItem", () => {
  it("renders name, logo and a single percentage", () => {
    render(<WidgetRowItem row={row} layout="vertical" isDark={false} />)
    expect(screen.getByText("Claude")).toBeInTheDocument()
    const logo = screen.getByRole("img", { name: "Claude" })
    expect(logo).toHaveStyle({ maskImage: "url(claude.svg)" })
    expect(screen.getByText("62%")).toBeInTheDocument()
  })

  it("colors the value by pace tone (tray pattern)", () => {
    const { rerender } = render(
      <WidgetRowItem row={{ ...row, tone: "ahead" }} layout="vertical" isDark={false} />
    )
    expect(screen.getByText("62%")).toHaveClass("text-green-500")
    rerender(<WidgetRowItem row={{ ...row, tone: "on-track" }} layout="vertical" isDark={false} />)
    expect(screen.getByText("62%")).toHaveClass("text-yellow-500")
    rerender(<WidgetRowItem row={{ ...row, tone: "behind" }} layout="vertical" isDark={false} />)
    expect(screen.getByText("62%")).toHaveClass("text-red-500")
  })

  it("shows the availability time instead of the value when limited", () => {
    const limitedUntilMs = Date.now() + 2 * 60 * 60 * 1000 // later today (usually)
    render(
      <WidgetRowItem
        row={{ ...row, tone: "behind", limitedUntilMs }}
        layout="vertical"
        isDark={false}
      />
    )
    const timeText = getTimeFormatter().format(limitedUntilMs)
    const value = screen.getByText((text) => text.includes(timeText))
    expect(value).toHaveClass("text-red-500")
    expect(screen.queryByText("62%")).not.toBeInTheDocument()
    expect(screen.getByTestId("widget-row")).toHaveAttribute(
      "title",
      expect.stringContaining("Limit reached")
    )
  })

  it("renders both layouts and a dash when no data", () => {
    const empty: WidgetRow = { ...row, fraction: null }
    const { rerender } = render(<WidgetRowItem row={empty} layout="vertical" isDark={false} />)
    expect(screen.getByText("—")).toBeInTheDocument()

    rerender(<WidgetRowItem row={row} layout="horizontal" isDark={true} />)
    expect(screen.getByTestId("widget-row")).toBeInTheDocument()
    expect(screen.getByText("62%")).toBeInTheDocument()
  })

  it("renders labeled values per metric in multi-metric modes", () => {
    const multi: WidgetRow = {
      ...row,
      metrics: [
        { label: "Weekly", fraction: 0.25, expectedFraction: 0.5, tone: "ahead" },
        { label: "Session", fraction: 0.8, expectedFraction: 0.75, tone: "behind" },
      ],
    }
    render(<WidgetRowItem row={multi} layout="vertical" isDark={false} />)
    expect(screen.getByText("Weekly")).toBeInTheDocument()
    expect(screen.getByText("25%/50%")).toHaveClass("text-green-500")
    expect(screen.getByText("Session")).toBeInTheDocument()
    expect(screen.getByText("80%/75%")).toHaveClass("text-red-500")
    // The single-value span is replaced by the metric list.
    expect(screen.queryByText("62%")).not.toBeInTheDocument()
  })

  it("shows expected value inline for single value", () => {
    render(
      <WidgetRowItem
        row={{ ...row, expectedFraction: 0.42 }}
        layout="vertical"
        isDark={false}
      />
    )
    expect(screen.getByText("62%/42%")).toBeInTheDocument()
  })

  it("shows expected value inline for metric values", () => {
    render(
      <WidgetRowItem
        row={{
          ...row,
          metrics: [{ label: "Weekly", fraction: 0.25, expectedFraction: 0.5, tone: "ahead" }],
        }}
        layout="vertical"
        isDark={false}
      />
    )
    expect(screen.getByText("25%/50%")).toBeInTheDocument()
  })

  it("hides percent signs for auto metric values", () => {
    render(
      <WidgetRowItem
        row={{
          ...row,
          metrics: [
            {
              label: "Weekly",
              fraction: 0.25,
              expectedFraction: 0.5,
              hidePercentSign: true,
              tone: "ahead",
            },
          ],
        }}
        layout="vertical"
        isDark={false}
      />
    )
    expect(screen.getByText("25/50")).toBeInTheDocument()
    expect(screen.queryByText("25%/50%")).not.toBeInTheDocument()
  })

  it("does not show expected value when expected fraction is missing", () => {
    render(<WidgetRowItem row={row} layout="vertical" isDark={false} />)
    expect(screen.getByText("62%")).toBeInTheDocument()
    expect(screen.queryByText("62%/")).not.toBeInTheDocument()
  })

  it("keeps vertical metrics on the provider row", () => {
    const multi: WidgetRow = {
      ...row,
      metrics: [{ label: "Weekly", fraction: 0.25, tone: "ahead" }],
    }
    render(<WidgetRowItem row={multi} layout="vertical" isDark={false} />)
    expect(screen.getByText("Claude").parentElement).toHaveClass("flex", "items-center")
    expect(screen.getByTestId("metric-list")).toHaveClass("flex-row", "items-center")
  })

  it("renders metric dividers only between metrics", () => {
    const multi: WidgetRow = {
      ...row,
      metrics: [
        { label: "Session", fraction: 0.25, tone: "ahead" },
        { label: "Weekly", fraction: 0.5, tone: "neutral" },
        { label: "Spark", fraction: 0.75, tone: "behind" },
      ],
    }
    render(<WidgetRowItem row={multi} layout="horizontal" isDark={false} />)
    expect(screen.getAllByTestId("metric-divider")).toHaveLength(2)
  })

  it("limited state wins over the metric list and expected indicator", () => {
    const limitedUntilMs = Date.now() + 2 * 60 * 60 * 1000
    render(
      <WidgetRowItem
        row={{
          ...row,
          tone: "behind",
          limitedUntilMs,
          expectedFraction: 0.5,
          metrics: [{ label: "Weekly", fraction: 1, expectedFraction: 0.5, tone: "behind" }],
        }}
        layout="vertical"
        isDark={false}
      />
    )
    expect(screen.queryByText("Weekly")).not.toBeInTheDocument()
    expect(screen.queryByText("100%/50%")).not.toBeInTheDocument()
    const timeText = getTimeFormatter().format(limitedUntilMs)
    expect(screen.getByText((text) => text.includes(timeText))).toBeInTheDocument()
  })
})
