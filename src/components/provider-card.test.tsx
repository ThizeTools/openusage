import { fireEvent, render, screen, within } from "@testing-library/react"
import type { ReactNode } from "react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { openUrl } from "@tauri-apps/plugin-opener"
import { ProviderCard } from "@/components/provider-card"
import { groupLinesByType } from "@/lib/group-lines-by-type"
import { formatResetTooltipText } from "@/lib/reset-tooltip"
import { REFRESH_COOLDOWN_MS } from "@/lib/settings"
import { formatFixedPrecisionNumber } from "@/lib/utils"

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({
    children,
    render,
    ...props
  }: {
    children: ReactNode
    render?: ((props: Record<string, unknown>) => ReactNode) | ReactNode
  }) => {
    if (typeof render === "function") {
      return render({ ...props, children })
    }
    if (render) return render
    return <div {...props}>{children}</div>
  },
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

function formatMonthDay(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date)
}

describe("ProviderCard", () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.mocked(openUrl).mockClear()
  })

  it("renders error state with retry", async () => {
    const onRetry = vi.fn()
    render(
      <ProviderCard
        name="Test"
        error="Nope"
        onRetry={onRetry}
      />
    )
    expect(screen.getByText("Nope")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("renders loading skeleton", () => {
    render(
      <ProviderCard
        name="Test"
        loading
        skeletonLines={[
          { type: "text", label: "One", scope: "overview" },
          { type: "badge", label: "Two", scope: "overview" },
        ]}
      />
    )
    expect(screen.getByText("One")).toBeInTheDocument()
    expect(screen.getByText("Two")).toBeInTheDocument()
  })

  it("shows loading spinner when retry is enabled", () => {
    const { container } = render(
      <ProviderCard
        name="Loading"
        loading
        onRetry={() => {}}
      />
    )
    expect(container.querySelector("svg.animate-spin")).toBeTruthy()
  })

  it("renders metric lines + progress formats", () => {
    render(
      <ProviderCard
        name="Metrics"
        lines={[
          { type: "text", label: "Label", value: "Value" },
          { type: "badge", label: "Plan", text: "Pro" },
          { type: "progress", label: "Percent", used: 32.4, limit: 100, format: { kind: "percent" } },
          { type: "progress", label: "Dollars", used: 12.34, limit: 100, format: { kind: "dollars" } },
          { type: "progress", label: "Credits", used: 342, limit: 1000, format: { kind: "count", suffix: "credits" } },
          { type: "unknown", label: "Ignored" } as any,
        ]}
      />
    )
    expect(screen.getByText("Label")).toBeInTheDocument()
    expect(screen.getByText("Pro")).toBeInTheDocument()
    expect(screen.getByText("Used 32% · Left 68%")).toBeInTheDocument()
    expect(screen.getByText("Used $12.34 · Left $87.66")).toBeInTheDocument()
    expect(screen.getByText("Used 342 credits · Left 658 credits")).toBeInTheDocument()
  })

  it("renders quick links and opens URL", async () => {
    render(
      <ProviderCard
        name="Links"
        links={[
          { label: "Status", url: "https://status.example.com" },
          { label: "Billing", url: "https://example.com/billing" },
        ]}
      />
    )

    await userEvent.click(screen.getByRole("button", { name: /status/i }))
    expect(openUrl).toHaveBeenCalledWith("https://status.example.com")
    expect(screen.getByRole("button", { name: /billing/i })).toBeInTheDocument()
  })

  it("hides invalid links", () => {
    render(
      <ProviderCard
        name="Links"
        links={[
          { label: " ", url: "https://status.example.com" },
          { label: "Dashboard", url: "ftp://example.com" },
          { label: "Status", url: "https://status.example.com" },
        ]}
      />
    )

    expect(screen.getByRole("button", { name: /status/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /dashboard/i })).toBeNull()
  })

  it("shows cooldown hint", () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-02T00:00:00.000Z")
    vi.setSystemTime(now)
    const lastManualRefreshAt = now.getTime() - (REFRESH_COOLDOWN_MS - 65_000)
    render(
      <ProviderCard
        name="Cooldown"
        lastManualRefreshAt={lastManualRefreshAt}
        onRetry={() => {}}
      />
    )
    expect(screen.getByText("Available in 1m 5s")).toBeInTheDocument()
  })

  it("shows seconds-only cooldown", () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-02T00:00:00.000Z")
    vi.setSystemTime(now)
    const lastManualRefreshAt = now.getTime() - (REFRESH_COOLDOWN_MS - 30_000)
    render(
      <ProviderCard
        name="Cooldown"
        lastManualRefreshAt={lastManualRefreshAt}
        onRetry={() => {}}
      />
    )
    expect(screen.getByText("Available in 30s")).toBeInTheDocument()
    vi.useRealTimers()
  })

  it("formats fixed-precision numbers with trailing zeros", () => {
    expect(formatFixedPrecisionNumber(Number.NaN)).toBe("0")
    expect(formatFixedPrecisionNumber(5)).toBe("5")
    expect(formatFixedPrecisionNumber(5.129)).toBe("5.13")
    expect(formatFixedPrecisionNumber(5.1)).toBe("5.10")
    expect(formatFixedPrecisionNumber(5.5)).toBe("5.50")
    expect(formatFixedPrecisionNumber(1000)).toBe("1,000")
    expect(formatFixedPrecisionNumber(10000)).toBe("10,000")
    expect(formatFixedPrecisionNumber(1234567.89)).toBe("1,234,567.89")
  })

  it("fills the bar with the used fraction", () => {
    render(
      <ProviderCard
        name="Used"
        lines={[
          { type: "progress", label: "Session", used: 42, limit: 100, format: { kind: "percent" } },
        ]}
      />
    )
    expect(screen.getByText("Used 42% · Left 58%")).toBeInTheDocument()
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42")
  })

  it("shows drift and expected metrics for reset-aware lines", () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-02T12:00:00.000Z")
    vi.setSystemTime(now)
    render(
      <ProviderCard
        name="Drift"
        lines={[
          {
            type: "progress",
            label: "Daily",
            used: 60,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: "2026-02-03T00:00:00.000Z",
            periodDurationMs: 24 * 60 * 60 * 1000,
          },
        ]}
      />
    )
    // Half the period elapsed → expected 50%, drift +10%.
    expect(screen.getByText("Used 60% · Left 40% · Drift +10% · Expected 50%")).toBeInTheDocument()
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60")
    vi.useRealTimers()
  })

  it("shows negative drift when under the expected pace", () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-02T12:00:00.000Z")
    vi.setSystemTime(now)
    render(
      <ProviderCard
        name="Under"
        lines={[
          {
            type: "progress",
            label: "Daily",
            used: 30,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: "2026-02-03T00:00:00.000Z",
            periodDurationMs: 24 * 60 * 60 * 1000,
          },
        ]}
      />
    )
    expect(screen.getByText("Used 30% · Left 70% · Drift -20% · Expected 50%")).toBeInTheDocument()
    vi.useRealTimers()
  })

  it("positions the expected marker at the elapsed fraction", () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-02T18:00:00.000Z")
    vi.setSystemTime(now)
    render(
      <ProviderCard
        name="Marker"
        lines={[
          {
            type: "progress",
            label: "Weekly",
            used: 30,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: "2026-02-03T00:00:00.000Z",
            periodDurationMs: 24 * 60 * 60 * 1000,
          },
        ]}
      />
    )
    const marker = document.querySelector<HTMLElement>('[data-slot="progress-marker"]')
    expect(marker).toBeTruthy()
    expect(marker?.style.left).toBe("75%")
    vi.useRealTimers()
  })

  it("shows resets secondary text when resetsAt is present", () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-02T00:00:00.000Z")
    vi.setSystemTime(now)
    render(
      <ProviderCard
        name="Resets"
        lines={[
          {
            type: "progress",
            label: "Monthly",
            used: 12.34,
            limit: 100,
            format: { kind: "dollars" },
            resetsAt: "2026-02-02T01:05:00.000Z",
          },
        ]}
      />
    )
    expect(screen.getByText("Resets in 1h 5m")).toBeInTheDocument()
    expect(
      screen.getByText(
        formatResetTooltipText({
          nowMs: now.getTime(),
          resetsAtIso: "2026-02-02T01:05:00.000Z",
          visibleMode: "relative",
        })!
      )
    ).toBeInTheDocument()
    vi.useRealTimers()
  })

  it("does not render reset tooltip for invalid reset timestamps", () => {
    render(
      <ProviderCard
        name="Resets"
        lines={[
          {
            type: "progress",
            label: "Invalid",
            used: 10,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: "not-a-date",
          },
        ]}
      />
    )

    expect(screen.getByText("100% cap")).toBeInTheDocument()
    expect(screen.queryByText(/^Next reset:/)).not.toBeInTheDocument()
  })

  it("shows 'Resets soon' when reset is under 5 minutes away", () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-02T00:00:00.000Z")
    vi.setSystemTime(now)
    render(
      <ProviderCard
        name="Resets"
        lines={[
          {
            type: "progress",
            label: "Short",
            used: 10,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: "2026-02-02T00:04:59.000Z",
          },
        ]}
      />
    )
    expect(screen.getByText("Resets soon")).toBeInTheDocument()
    vi.useRealTimers()
  })

  it("keeps standard reset text at exactly 5 minutes", () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-02T00:00:00.000Z")
    vi.setSystemTime(now)
    render(
      <ProviderCard
        name="Resets"
        lines={[
          {
            type: "progress",
            label: "Boundary",
            used: 10,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: "2026-02-02T00:05:00.000Z",
          },
        ]}
      />
    )
    expect(screen.getByText("Resets in 5m")).toBeInTheDocument()
    vi.useRealTimers()
  })

  it("shows 'Resets soon' for stale reset timestamps in relative mode", () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-02T00:06:00.000Z")
    vi.setSystemTime(now)
    render(
      <ProviderCard
        name="Resets"
        lines={[
          {
            type: "progress",
            label: "Stale Relative",
            used: 10,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: "2026-02-02T00:05:00.000Z",
          },
        ]}
      />
    )
    expect(screen.getAllByText("Resets soon")).toHaveLength(2)
    vi.useRealTimers()
  })

  it("shows 'Resets soon' for stale reset timestamps in absolute mode", () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-02T00:06:00.000Z")
    vi.setSystemTime(now)
    render(
      <ProviderCard
        name="Resets"
        resetTimerDisplayMode="absolute"
        lines={[
          {
            type: "progress",
            label: "Stale Absolute",
            used: 10,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: "2026-02-02T00:05:00.000Z",
          },
        ]}
      />
    )
    expect(screen.getAllByText("Resets soon")).toHaveLength(2)
    vi.useRealTimers()
  })

  it("toggles reset timer display mode from reset label", async () => {
    vi.useFakeTimers()
    const now = new Date(2026, 1, 2, 0, 0, 0)
    vi.setSystemTime(now)
    const onToggle = vi.fn()
    const resetsAt = new Date(2026, 1, 2, 1, 5, 0).toISOString()
    render(
      <ProviderCard
        name="Resets"
        resetTimerDisplayMode="absolute"
        onResetTimerDisplayModeToggle={onToggle}
        lines={[
          {
            type: "progress",
            label: "Monthly",
            used: 12.34,
            limit: 100,
            format: { kind: "dollars" },
            resetsAt,
          },
        ]}
      />
    )
    const resetButton = screen.getByRole("button", { name: /^Resets today at / })
    expect(resetButton).toBeInTheDocument()
    expect(
      screen.getByText(
        formatResetTooltipText({
          nowMs: now.getTime(),
          resetsAtIso: resetsAt,
          visibleMode: "absolute",
        })!
      )
    ).toBeInTheDocument()
    fireEvent.click(resetButton)
    expect(onToggle).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it("shows tomorrow context for absolute reset labels", () => {
    vi.useFakeTimers()
    const now = new Date(2026, 1, 2, 20, 0, 0)
    const resetsAt = new Date(2026, 1, 3, 9, 30, 0)
    vi.setSystemTime(now)
    render(
      <ProviderCard
        name="Resets"
        resetTimerDisplayMode="absolute"
        lines={[
          {
            type: "progress",
            label: "Daily",
            used: 10,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: resetsAt.toISOString(),
          },
        ]}
      />
    )
    expect(screen.getByText(/^Resets tomorrow at /)).toBeInTheDocument()
    vi.useRealTimers()
  })

  it("shows short date context for absolute labels within a week", () => {
    vi.useFakeTimers()
    const now = new Date(2026, 1, 2, 10, 0, 0)
    const resetsAt = new Date(2026, 1, 5, 16, 0, 0)
    vi.setSystemTime(now)
    const dateText = formatMonthDay(resetsAt)
    render(
      <ProviderCard
        name="Resets"
        resetTimerDisplayMode="absolute"
        lines={[
          {
            type: "progress",
            label: "Weekly",
            used: 10,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: resetsAt.toISOString(),
          },
        ]}
      />
    )
    expect(
      screen.getByText((content) => content.startsWith(`Resets ${dateText} at `))
    ).toBeInTheDocument()
    vi.useRealTimers()
  })

  it("shows short date context for absolute labels beyond a week", () => {
    vi.useFakeTimers()
    const now = new Date(2026, 1, 2, 10, 0, 0)
    const resetsAt = new Date(2026, 1, 20, 16, 0, 0)
    vi.setSystemTime(now)
    const dateText = formatMonthDay(resetsAt)
    render(
      <ProviderCard
        name="Resets"
        resetTimerDisplayMode="absolute"
        lines={[
          {
            type: "progress",
            label: "Monthly",
            used: 10,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: resetsAt.toISOString(),
          },
        ]}
      />
    )
    expect(
      screen.getByText((content) => content.startsWith(`Resets ${dateText} at `))
    ).toBeInTheDocument()
    vi.useRealTimers()
  })

  it("shows pace indicators for ahead, on-track, and behind", () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-02T12:00:00.000Z")
    vi.setSystemTime(now)
    render(
      <ProviderCard
        name="Pace"
        lines={[
          {
            type: "progress",
            label: "Ahead",
            used: 30,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: "2026-02-03T00:00:00.000Z",
            periodDurationMs: 24 * 60 * 60 * 1000,
          },
          {
            type: "progress",
            label: "On Track",
            used: 45,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: "2026-02-03T00:00:00.000Z",
            periodDurationMs: 24 * 60 * 60 * 1000,
          },
          {
            type: "progress",
            label: "Behind",
            used: 60,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: "2026-02-03T00:00:00.000Z",
            periodDurationMs: 24 * 60 * 60 * 1000,
          },
        ]}
      />
    )
    expect(screen.getByLabelText("Plenty of room")).toBeInTheDocument()
    expect(screen.getByLabelText("Right on target")).toBeInTheDocument()
    expect(screen.getByLabelText("Will run out")).toBeInTheDocument()
    expect(screen.getByText("60% used at reset")).toBeInTheDocument()
    expect(screen.getByText("90% used at reset")).toBeInTheDocument()
    expect(screen.getByText("Limit in 8h 0m")).toBeInTheDocument()

    // Expected marker is always visible when the period is known.
    const markers = document.querySelectorAll<HTMLElement>('[data-slot="progress-marker"]')
    expect(markers).toHaveLength(3)
    for (const marker of markers) {
      expect(marker.style.left).toBe("50%")
      expect(marker).toHaveClass("bg-muted-foreground")
    }
    vi.useRealTimers()
  })

  it("shows over-limit now detail when already at or above 100%", () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-02T12:00:00.000Z")
    vi.setSystemTime(now)
    render(
      <ProviderCard
        name="Pace"
        lines={[
          {
            type: "progress",
            label: "Behind",
            used: 120,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: "2026-02-03T00:00:00.000Z",
            periodDurationMs: 24 * 60 * 60 * 1000,
          },
        ]}
      />
    )
    expect(screen.getByLabelText("Limit reached")).toBeInTheDocument()
    expect(screen.getByText("Limit reached")).toBeInTheDocument()
    expect(screen.queryByText(/in deficit/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/runs out in/i)).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it("hides tiny positive deficit text that would round to zero", () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-02T12:00:00.000Z")
    vi.setSystemTime(now)
    render(
      <ProviderCard
        name="Pace"
        lines={[
          {
            type: "progress",
            label: "Behind",
            used: 50.3,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: "2026-02-03T00:00:00.000Z",
            periodDurationMs: 24 * 60 * 60 * 1000,
          },
        ]}
      />
    )
    expect(screen.getByLabelText("Will run out")).toBeInTheDocument()
    expect(screen.getByText(/^Runs out in /)).toBeInTheDocument()
    expect(screen.queryByText("0% in deficit")).not.toBeInTheDocument()
    expect(screen.queryByText("0% short")).not.toBeInTheDocument()
    expect(screen.queryByText(/in deficit/i)).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it("keeps status-only tooltip when pace projection is not yet available", () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-02T00:45:00.000Z")
    vi.setSystemTime(now)
    render(
      <ProviderCard
        name="Pace"
        lines={[
          {
            type: "progress",
            label: "Ahead",
            used: 0,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: "2026-02-03T00:00:00.000Z",
            periodDurationMs: 24 * 60 * 60 * 1000,
          },
        ]}
      />
    )
    expect(screen.getByText("Plenty of room")).toBeInTheDocument()
    expect(screen.queryByText(/at reset/)).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it("keeps the expected marker even when pace is unavailable early in period", () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-02T00:45:00.000Z")
    vi.setSystemTime(now)
    render(
      <ProviderCard
        name="Pace"
        lines={[
          {
            type: "progress",
            label: "Early",
            used: 10,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: "2026-02-03T00:00:00.000Z",
            periodDurationMs: 24 * 60 * 60 * 1000,
          },
        ]}
      />
    )
    // Pace dot needs ≥5% of the period, but the expected marker always shows.
    expect(screen.queryByLabelText("Plenty of room")).not.toBeInTheDocument()
    const marker = document.querySelector<HTMLElement>('[data-slot="progress-marker"]')
    expect(marker).toBeTruthy()
    expect(marker?.style.left).toBe("3.125%")
    vi.useRealTimers()
  })

  it("fires retry from header button", () => {
    const onRetry = vi.fn()
    const { container } = render(
      <ProviderCard
        name="Retry"
        onRetry={onRetry}
        lines={[{ type: "text", label: "Label", value: "Value" }]}
      />
    )
    const buttons = Array.from(container.querySelectorAll("button"))
    const iconButton = buttons.find((button) => button.textContent === "")
    expect(iconButton).toBeTruthy()
    if (iconButton) {
      iconButton.focus()
      iconButton.click()
    }
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("renders refresh button when cooldown expired", () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-02T00:00:00.000Z")
    vi.setSystemTime(now)
    const lastManualRefreshAt = now.getTime() - (REFRESH_COOLDOWN_MS + 1000)
    const onRetry = vi.fn()
    const { container } = render(
      <ProviderCard
        name="Retry"
        onRetry={onRetry}
        lastManualRefreshAt={lastManualRefreshAt}
        lines={[{ type: "text", label: "Label", value: "Value" }]}
      />
    )
    const buttons = Array.from(container.querySelectorAll("button"))
    const iconButton = buttons.find((button) => button.textContent === "")
    expect(iconButton).toBeTruthy()
    iconButton?.click()
    expect(onRetry).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it("cleans up cooldown timers on unmount", () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-02T00:00:00.000Z")
    vi.setSystemTime(now)
    const lastManualRefreshAt = now.getTime() - (REFRESH_COOLDOWN_MS - 1000)
    const clearIntervalSpy = vi.spyOn(global, "clearInterval")
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout")
    const { unmount } = render(
      <ProviderCard
        name="Cooldown"
        lastManualRefreshAt={lastManualRefreshAt}
        onRetry={() => {}}
      />
    )
    unmount()
    expect(clearIntervalSpy).toHaveBeenCalled()
    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearIntervalSpy.mockRestore()
    clearTimeoutSpy.mockRestore()
    vi.useRealTimers()
  })

  it("omits separator when disabled", () => {
    const { container } = render(
      <ProviderCard
        name="NoSep"
        showSeparator={false}
        lines={[{ type: "text", label: "Label", value: "Value" }]}
      />
    )
    expect(within(container).queryAllByRole("separator")).toHaveLength(0)
  })

  it("filters lines by scope=overview", () => {
    render(
      <ProviderCard
        name="Filtered"
        scopeFilter="overview"
        skeletonLines={[
          { type: "text", label: "Primary", scope: "overview" },
          { type: "text", label: "Secondary", scope: "detail" },
        ]}
        lines={[
          { type: "text", label: "Primary", value: "Shown" },
          { type: "text", label: "Secondary", value: "Hidden" },
        ]}
      />
    )
    expect(screen.getByText("Primary")).toBeInTheDocument()
    expect(screen.getByText("Shown")).toBeInTheDocument()
    expect(screen.queryByText("Secondary")).not.toBeInTheDocument()
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument()
  })

  it("shows all lines when scopeFilter=all", () => {
    render(
      <ProviderCard
        name="All"
        scopeFilter="all"
        skeletonLines={[
          { type: "text", label: "Primary", scope: "overview" },
          { type: "text", label: "Secondary", scope: "detail" },
        ]}
        lines={[
          { type: "text", label: "Primary", value: "One" },
          { type: "text", label: "Secondary", value: "Two" },
        ]}
      />
    )
    expect(screen.getByText("Primary")).toBeInTheDocument()
    expect(screen.getByText("One")).toBeInTheDocument()
    expect(screen.getByText("Secondary")).toBeInTheDocument()
    expect(screen.getByText("Two")).toBeInTheDocument()
  })

  it("filters skeleton lines during loading", () => {
    render(
      <ProviderCard
        name="Loading"
        loading
        scopeFilter="overview"
        skeletonLines={[
          { type: "progress", label: "Session", scope: "overview" },
          { type: "progress", label: "Extra", scope: "detail" },
        ]}
      />
    )
    expect(screen.getByText("Session")).toBeInTheDocument()
    expect(screen.queryByText("Extra")).not.toBeInTheDocument()
  })

  it("keeps stale data visible while loading (stale-while-revalidate)", () => {
    render(
      <ProviderCard
        name="SWR"
        loading
        lastUpdatedAt={Date.now() - 60_000}
        lines={[
          { type: "text", label: "Label", value: "Value" },
          { type: "progress", label: "Session", used: 32, limit: 100, format: { kind: "percent" } },
        ]}
        skeletonLines={[
          { type: "text", label: "Label", scope: "overview" },
          { type: "progress", label: "Session", scope: "overview" },
        ]}
      />
    )
    // Real data stays on screen — no skeleton swap
    expect(screen.getByText("Value")).toBeInTheDocument()
    expect(screen.getByText("Used 32% · Left 68%")).toBeInTheDocument()
    // Progress bar shows shimmer overlay
    expect(document.querySelector('[data-slot="progress-refreshing"]')).toBeTruthy()
  })

  it("skips skeleton on refresh when lastUpdatedAt set even if filtered lines are empty", () => {
    render(
      <ProviderCard
        name="FilteredEmpty"
        loading
        lastUpdatedAt={Date.now() - 60_000}
        scopeFilter="overview"
        skeletonLines={[
          { type: "progress", label: "Session", scope: "overview" },
        ]}
        lines={[
          { type: "text", label: "DetailOnly", value: "Hidden" },
        ]}
      />
    )
    // skeleton label for "Session" should not render because we have prior data (lastUpdatedAt set)
    expect(screen.queryByText("Session")).toBeNull()
    // and the detail-scoped line stays filtered out
    expect(screen.queryByText("DetailOnly")).toBeNull()
  })

  it("renders skeleton on first load when no stale data exists", () => {
    render(
      <ProviderCard
        name="Cold"
        loading
        skeletonLines={[{ type: "progress", label: "Session", scope: "overview" }]}
      />
    )
    expect(screen.getByText("Session")).toBeInTheDocument()
    expect(document.querySelector('[data-slot="progress-refreshing"]')).toBeNull()
  })

  it("shows inline warning with stale data on refresh error", () => {
    render(
      <ProviderCard
        name="StaleErr"
        error="Couldn't update data. Try again?"
        lastUpdatedAt={Date.now() - 60_000}
        lines={[
          { type: "progress", label: "Session", used: 40, limit: 100, format: { kind: "percent" } },
        ]}
      />
    )
    // Stale data still visible
    expect(screen.getByText("Used 40% · Left 60%")).toBeInTheDocument()
    // Inline warning shown (not the full PluginError alert) — error text appears
    // in both the trigger and the tooltip content via our mocked Tooltip
    expect(screen.getAllByText("Couldn't update data. Try again?").length).toBeGreaterThan(0)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("shows full PluginError when errored without stale data", () => {
    render(
      <ProviderCard
        name="ColdErr"
        error="Nope"
        onRetry={() => {}}
      />
    )
    expect(screen.getByRole("alert")).toBeInTheDocument()
    expect(screen.getByText("Nope")).toBeInTheDocument()
  })

  it("shows relative last-updated timestamp in retry tooltip", () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-02T00:05:00.000Z")
    vi.setSystemTime(now)
    render(
      <ProviderCard
        name="Updated"
        onRetry={() => {}}
        lastUpdatedAt={now.getTime() - 120_000}
        lines={[{ type: "text", label: "Label", value: "Value" }]}
      />
    )
    expect(screen.getByText(/Updated 2m ago/)).toBeInTheDocument()
    vi.useRealTimers()
  })

  it("shows 'just now' for very recent last-updated timestamps", () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-02T00:05:00.000Z")
    vi.setSystemTime(now)
    render(
      <ProviderCard
        name="Fresh"
        onRetry={() => {}}
        lastUpdatedAt={now.getTime() - 5_000}
        lines={[{ type: "text", label: "Label", value: "Value" }]}
      />
    )
    expect(screen.getByText(/Updated just now/)).toBeInTheDocument()
    vi.useRealTimers()
  })

  it("clamps negative time deltas to 'just now' (clock skew)", () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-02T00:05:00.000Z")
    vi.setSystemTime(now)
    render(
      <ProviderCard
        name="Skew"
        onRetry={() => {}}
        lastUpdatedAt={now.getTime() + 60_000}
        lines={[{ type: "text", label: "Label", value: "Value" }]}
      />
    )
    expect(screen.getByText(/Updated just now/)).toBeInTheDocument()
    vi.useRealTimers()
  })

  it("omits retry tooltip content when lastUpdatedAt is null", () => {
    render(
      <ProviderCard
        name="NoTimestamp"
        onRetry={() => {}}
        lines={[{ type: "text", label: "Label", value: "Value" }]}
      />
    )
    expect(screen.queryByText(/Updated/)).toBeNull()
  })
})

describe("groupLinesByType", () => {
  it("returns empty array for empty input", () => {
    expect(groupLinesByType([])).toEqual([])
  })

  it("groups consecutive text lines together", () => {
    const lines = [
      { type: "text" as const, label: "Today", value: "$0.00" },
      { type: "text" as const, label: "Yesterday", value: "$1.00" },
      { type: "text" as const, label: "Last 30 Days", value: "$5.00" },
    ]
    const groups = groupLinesByType(lines)
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe("text")
    expect(groups[0].lines).toHaveLength(3)
  })

  it("keeps non-text lines as separate 'other' entries", () => {
    const lines = [
      { type: "progress" as const, label: "Session", used: 50, limit: 100, format: { kind: "percent" as const } },
      { type: "progress" as const, label: "Weekly", used: 30, limit: 100, format: { kind: "percent" as const } },
    ]
    const groups = groupLinesByType(lines)
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe("other")
    expect(groups[0].lines).toHaveLength(2)
  })

  it("creates separate groups for alternating text and non-text lines", () => {
    const lines = [
      { type: "progress" as const, label: "Session", used: 50, limit: 100, format: { kind: "percent" as const } },
      { type: "text" as const, label: "Today", value: "$0.00" },
      { type: "text" as const, label: "Yesterday", value: "$1.00" },
      { type: "badge" as const, label: "Status", text: "OK" },
    ]
    const groups = groupLinesByType(lines)
    expect(groups).toHaveLength(3)
    expect(groups[0].kind).toBe("other")
    expect(groups[0].lines).toHaveLength(1)
    expect(groups[1].kind).toBe("text")
    expect(groups[1].lines).toHaveLength(2)
    expect(groups[2].kind).toBe("other")
    expect(groups[2].lines).toHaveLength(1)
  })
})
