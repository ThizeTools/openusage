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
})
