import { cleanup, render, screen } from "@testing-library/react"
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
import type { PluginMeta } from "@/lib/plugin-types"

function progressMeta(id: string, name: string, labels: string[]): PluginMeta {
  return {
    id,
    name,
    iconUrl: `${id}.svg`,
    lines: labels.map((label) => ({ type: "progress" as const, label, scope: "overview" as const })),
    primaryCandidates: labels,
  }
}

const defaultProps = {
  plugins: [
    { id: "a", name: "Alpha", enabled: true },
    { id: "b", name: "Beta", enabled: true },
  ],
  pluginsMeta: [
    progressMeta("a", "Alpha", ["Session", "Weekly", "Sonnet"]),
    progressMeta("b", "Beta", ["Extra"]),
  ],
  onReorder: vi.fn(),
  onToggle: vi.fn(),
  themeMode: "system" as const,
  onThemeModeChange: vi.fn(),
  resetTimerDisplayMode: "relative" as const,
  onResetTimerDisplayModeChange: vi.fn(),
  statsShortcut: null,
  onStatsShortcutChange: vi.fn(),
  startOnLogin: false,
  onStartOnLoginChange: vi.fn(),
  widgetVisible: false,
  onWidgetVisibleChange: vi.fn(),
  widgetProviderIds: null,
  onWidgetProviderIdsChange: vi.fn(),
  widgetProviderMetrics: {},
  onWidgetProviderMetricsChange: vi.fn(),
  menuBarWidgetBackdrop: { enabled: true, color: "auto" as const, opacity: 60, glass: 40, blur: 50 },
  onMenuBarWidgetBackdropChange: vi.fn(),
  menuBarWidgetStyle: "stacked",
  onMenuBarWidgetStyleChange: vi.fn(),
  menuBarWidgetColors: {},
  onMenuBarWidgetColorsChange: vi.fn(),
  menuBarWidgetTextColors: { label: "mono", used: "color", expected: "color" },
  onMenuBarWidgetTextColorsChange: vi.fn(),
  menuBarWidgetToneModes: { ahead: "color", onTrack: "color", behind: "color" },
  onMenuBarWidgetToneModesChange: vi.fn(),
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

  it("shows the fixed auto refresh schedule without interval buttons", () => {
    render(<SettingsPage {...defaultProps} />)
    expect(screen.getByText("Auto Refresh")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Every 5 minutes. Providers that rate-limit OpenUsage are retried later automatically; use Refresh to update now."
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole("radiogroup", { name: "Auto-update interval" })).not.toBeInTheDocument()
    for (const label of ["1 min", "5 min", "15 min", "30 min"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
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

  it("toggles taskbar widget providers separately from enabled plugins", async () => {
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

  it("renders the global shortcut section", async () => {
    render(<SettingsPage {...defaultProps} />)
    await openTab("Shortcuts")
    expect(screen.getByText("Global Shortcut")).toBeInTheDocument()
    expect(screen.getByText("Show or hide the stats panel from anywhere")).toBeInTheDocument()
  })

  it("shows each enabled provider's metrics in the widget tab", async () => {
    render(<SettingsPage {...defaultProps} widgetProviderIds={["a"]} />)
    await openTab("Widget")
    expect(screen.getByText("Choose which providers and metrics appear on the taskbar.")).toBeInTheDocument()
    expect(screen.getByLabelText("Session")).toBeInTheDocument()
    expect(screen.getByLabelText("Extra")).toBeInTheDocument()
  })

  it("saves the metric selection for a provider from the widget tab", async () => {
    const onWidgetProviderMetricsChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        widgetProviderIds={["a"]}
        onWidgetProviderMetricsChange={onWidgetProviderMetricsChange}
      />
    )
    await openTab("Widget")
    await userEvent.click(screen.getByLabelText("Sonnet"))
    expect(onWidgetProviderMetricsChange).toHaveBeenCalledWith({ a: ["Session", "Weekly", "Sonnet"] })
  })

  it("does not change metrics of a provider that is hidden from the widget", async () => {
    const onWidgetProviderMetricsChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        widgetProviderIds={["a"]}
        onWidgetProviderMetricsChange={onWidgetProviderMetricsChange}
      />
    )
    await openTab("Widget")
    await userEvent.click(screen.getByLabelText("Extra"))
    expect(onWidgetProviderMetricsChange).not.toHaveBeenCalled()
  })
})
