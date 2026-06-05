import { cleanup, render, screen, within } from "@testing-library/react"
import type { ReactNode } from "react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

let latestOnDragEnd: ((event: any) => void) | undefined

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd?: (event: any) => void }) => {
    latestOnDragEnd = onDragEnd
    return <div data-testid="dnd-context">{children}</div>
  },
  closestCenter: vi.fn(),
  PointerSensor: class {},
  KeyboardSensor: class {},
  useSensor: vi.fn((_sensor: any, options?: any) => ({ sensor: _sensor, options })),
  useSensors: vi.fn((...sensors: any[]) => sensors),
}))

vi.mock("@dnd-kit/sortable", () => ({
  arrayMove: (items: any[], from: number, to: number) => {
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    return next
  },
  SortableContext: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: vi.fn(),
}))

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => "" } },
}))

import { SettingsPage } from "@/pages/settings"
import { WIDGET_METRIC_SUGESTAO } from "@/lib/settings"

const defaultProps = {
  plugins: [{ id: "a", name: "Alpha", enabled: true }],
  onReorder: vi.fn(),
  onToggle: vi.fn(),
  autoUpdateInterval: 15 as const,
  onAutoUpdateIntervalChange: vi.fn(),
  themeMode: "system" as const,
  onThemeModeChange: vi.fn(),
  resetTimerDisplayMode: "relative" as const,
  onResetTimerDisplayModeChange: vi.fn(),
  globalShortcut: null,
  onGlobalShortcutChange: vi.fn(),
  statsShortcut: null,
  onStatsShortcutChange: vi.fn(),
  startOnLogin: false,
  onStartOnLoginChange: vi.fn(),
  widgetLayout: "vertical" as const,
  onWidgetLayoutChange: vi.fn(),
  widgetVisible: false,
  onWidgetVisibleChange: vi.fn(),
  widgetProviderIds: null,
  onWidgetProviderIdsChange: vi.fn(),
  widgetMetric: null,
  onWidgetMetricChange: vi.fn(),
  widgetZoom: 1,
  onWidgetZoomChange: vi.fn(),
  availableMetrics: [] as string[],
}

afterEach(() => {
  cleanup()
})

const openTab = (name: "General" | "Shortcuts" | "Widget" | "Plugins") =>
  userEvent.click(screen.getByRole("tab", { name }))

describe("SettingsPage", () => {
  it("toggles plugins", async () => {
    const onToggle = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        plugins={[
          { id: "b", name: "Beta", enabled: false },
        ]}
        onToggle={onToggle}
      />
    )
    await openTab("Plugins")
    const checkboxes = screen.getAllByRole("checkbox")
    await userEvent.click(checkboxes[checkboxes.length - 1])
    expect(onToggle).toHaveBeenCalledWith("b")
  })

  it("reorders plugins on drag end", async () => {
    const onReorder = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        plugins={[
          { id: "a", name: "Alpha", enabled: true },
          { id: "b", name: "Beta", enabled: true },
        ]}
        onReorder={onReorder}
      />
    )
    await openTab("Plugins")
    latestOnDragEnd?.({ active: { id: "a" }, over: { id: "b" } })
    expect(onReorder).toHaveBeenCalledWith(["b", "a"])
  })

  it("ignores invalid drag end", async () => {
    const onReorder = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        onReorder={onReorder}
      />
    )
    await openTab("Plugins")
    latestOnDragEnd?.({ active: { id: "a" }, over: null })
    latestOnDragEnd?.({ active: { id: "a" }, over: { id: "a" } })
    expect(onReorder).not.toHaveBeenCalled()
  })

  it("updates auto-update interval", async () => {
    const onAutoUpdateIntervalChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        onAutoUpdateIntervalChange={onAutoUpdateIntervalChange}
      />
    )
    await userEvent.click(screen.getByText("30 min"))
    expect(onAutoUpdateIntervalChange).toHaveBeenCalledWith(30)
  })

  it("shows auto-update helper text", () => {
    render(<SettingsPage {...defaultProps} />)
    expect(screen.getByText("How obsessive are you")).toBeInTheDocument()
  })

  it("renders app theme section with theme options", () => {
    render(<SettingsPage {...defaultProps} />)
    expect(screen.getByText("App Theme")).toBeInTheDocument()
    expect(screen.getByText("How it looks around here")).toBeInTheDocument()
    expect(screen.getByText("System")).toBeInTheDocument()
    expect(screen.getByText("Light")).toBeInTheDocument()
    expect(screen.getByText("Dark")).toBeInTheDocument()
  })

  it("updates theme mode", async () => {
    const onThemeModeChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        onThemeModeChange={onThemeModeChange}
      />
    )
    await userEvent.click(screen.getByText("Dark"))
    expect(onThemeModeChange).toHaveBeenCalledWith("dark")
  })

  it("updates reset timer display mode", async () => {
    const onResetTimerDisplayModeChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        onResetTimerDisplayModeChange={onResetTimerDisplayModeChange}
      />
    )
    await userEvent.click(screen.getByRole("radio", { name: /Absolute/ }))
    expect(onResetTimerDisplayModeChange).toHaveBeenCalledWith("absolute")
  })

  it("does not render the removed usage mode section", () => {
    render(<SettingsPage {...defaultProps} />)
    expect(screen.queryByText("Usage Mode")).not.toBeInTheDocument()
  })

  it("renders reset timers section heading", () => {
    render(<SettingsPage {...defaultProps} />)
    expect(screen.getByText("Reset Timers")).toBeInTheDocument()
  })

  it("does not render manual time format controls", () => {
    render(<SettingsPage {...defaultProps} />)
    expect(screen.queryByText("Time Format")).not.toBeInTheDocument()
    expect(screen.queryByText("12-hour or 24-hour clock")).not.toBeInTheDocument()
    expect(screen.queryByRole("radio", { name: "12-hour" })).not.toBeInTheDocument()
    expect(screen.queryByRole("radio", { name: "24-hour" })).not.toBeInTheDocument()
  })

  it("does not render menubar icon section", () => {
    render(<SettingsPage {...defaultProps} />)
    expect(screen.queryByText("Menubar Icon")).not.toBeInTheDocument()
    expect(screen.queryByText("What shows in the menu bar")).not.toBeInTheDocument()
  })

  it("does not render removed bar icon controls", () => {
    render(<SettingsPage {...defaultProps} />)
    expect(screen.queryByText("Bar Icon")).not.toBeInTheDocument()
    expect(screen.queryByText("Show percentage")).not.toBeInTheDocument()
  })

  it("toggles start on login checkbox", async () => {
    const onStartOnLoginChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        onStartOnLoginChange={onStartOnLoginChange}
      />
    )
    await userEvent.click(screen.getByText("Start on login"))
    expect(onStartOnLoginChange).toHaveBeenCalledWith(true)
  })

  it("toggles floating widget providers separately from enabled plugins", async () => {
    const onWidgetProviderIdsChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        plugins={[
          { id: "a", name: "Alpha", enabled: true },
          { id: "b", name: "Beta", enabled: true },
        ]}
        widgetProviderIds={["a"]}
        onWidgetProviderIdsChange={onWidgetProviderIdsChange}
      />
    )

    await openTab("Widget")
    await userEvent.click(screen.getByLabelText("Beta"))
    expect(onWidgetProviderIdsChange).toHaveBeenCalledWith(["a", "b"])
  })

  it("renders the stats shortcut section", async () => {
    render(<SettingsPage {...defaultProps} />)
    await openTab("Shortcuts")
    expect(screen.getByText("Stats Shortcut")).toBeInTheDocument()
    expect(screen.getByText("Show or hide the stats popup")).toBeInTheDocument()
  })

  it("adjusts widget zoom from +/- controls", async () => {
    const onWidgetZoomChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        widgetZoom={1}
        onWidgetZoomChange={onWidgetZoomChange}
      />
    )
    await openTab("Widget")
    expect(screen.getByText("100%")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Increase widget zoom" }))
    expect(onWidgetZoomChange).toHaveBeenCalledWith(1.05)
    await userEvent.click(screen.getByRole("button", { name: "Decrease widget zoom" }))
    expect(onWidgetZoomChange).toHaveBeenCalledWith(0.95)
  })

  it("selects a widget metric", async () => {
    const onWidgetMetricChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        availableMetrics={["Weekly", "Total usage"]}
        onWidgetMetricChange={onWidgetMetricChange}
      />
    )
    await openTab("Widget")
    await userEvent.click(screen.getByRole("radio", { name: "Total usage" }))
    expect(onWidgetMetricChange).toHaveBeenCalledWith("Total usage")
  })

  it("selects auto widget metric", async () => {
    const onWidgetMetricChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        widgetMetric={WIDGET_METRIC_SUGESTAO}
        onWidgetMetricChange={onWidgetMetricChange}
      />
    )
    await openTab("Widget")
    expect(screen.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true")
    await userEvent.click(screen.getByRole("radio", { name: "Auto" }))
    expect(onWidgetMetricChange).toHaveBeenCalledWith(WIDGET_METRIC_SUGESTAO)
  })

  it("shows auto as the first widget metric option", async () => {
    render(<SettingsPage {...defaultProps} availableMetrics={["Weekly"]} />)
    await openTab("Widget")
    const group = screen.getByRole("radiogroup", { name: "Widget metric" })
    expect(within(group).getAllByRole("radio")[0]).toHaveAccessibleName("Auto")
  })
})
