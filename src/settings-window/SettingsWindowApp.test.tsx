import { act, render, screen, waitFor, within } from "@testing-library/react"
import type { ReactNode } from "react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({
  keyChangeHandlers: {} as Record<string, (value: unknown) => void>,
  eventHandlers: {} as Record<string, (event: { payload: unknown }) => void>,
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(() => true),
  minimizeMock: vi.fn(),
  toggleMaximizeMock: vi.fn(),
  closeMock: vi.fn(),
  autostartEnableMock: vi.fn(),
  autostartDisableMock: vi.fn(),
  autostartIsEnabledMock: vi.fn(),
  loadPluginSettingsMock: vi.fn(),
  savePluginSettingsMock: vi.fn(),
  loadAutoUpdateIntervalMock: vi.fn(),
  saveAutoUpdateIntervalMock: vi.fn(),
  loadThemeModeMock: vi.fn(),
  saveThemeModeMock: vi.fn(),
  loadResetTimerDisplayModeMock: vi.fn(),
  saveResetTimerDisplayModeMock: vi.fn(),
  loadGlobalShortcutMock: vi.fn(),
  saveGlobalShortcutMock: vi.fn(),
  loadStatsShortcutMock: vi.fn(),
  saveStatsShortcutMock: vi.fn(),
  loadStartOnLoginMock: vi.fn(),
  saveStartOnLoginMock: vi.fn(),
  loadWidgetLayoutMock: vi.fn(),
  saveWidgetLayoutMock: vi.fn(),
  loadWidgetVisibleMock: vi.fn(),
  loadWidgetProviderIdsMock: vi.fn(),
  saveWidgetProviderIdsMock: vi.fn(),
  loadWidgetMetricMock: vi.fn(),
  saveWidgetMetricMock: vi.fn(),
  loadWidgetZoomMock: vi.fn(),
  saveWidgetZoomMock: vi.fn(),
}))

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd?: (event: any) => void }) => {
    void onDragEnd
    return <div>{children}</div>
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

vi.mock("@tauri-apps/api/core", () => ({
  invoke: state.invokeMock,
  isTauri: state.isTauriMock,
}))

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: state.minimizeMock,
    toggleMaximize: state.toggleMaximizeMock,
    close: state.closeMock,
  }),
}))

vi.mock("@tauri-apps/plugin-autostart", () => ({
  enable: state.autostartEnableMock,
  disable: state.autostartDisableMock,
  isEnabled: state.autostartIsEnabledMock,
}))

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    async onKeyChange(key: string, cb: (value: unknown) => void) {
      state.keyChangeHandlers[key] = cb
      return () => {
        delete state.keyChangeHandlers[key]
      }
    }
  },
}))

vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, cb: (event: { payload: unknown }) => void) => {
    state.eventHandlers[name] = cb
    return () => {
      delete state.eventHandlers[name]
    }
  },
  emit: vi.fn(async () => {}),
}))

vi.mock("@/hooks/app/use-settings-theme", () => ({
  useSettingsTheme: () => {},
}))

vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings")
  return {
    ...actual,
    loadPluginSettings: state.loadPluginSettingsMock,
    savePluginSettings: state.savePluginSettingsMock,
    loadAutoUpdateInterval: state.loadAutoUpdateIntervalMock,
    saveAutoUpdateInterval: state.saveAutoUpdateIntervalMock,
    loadThemeMode: state.loadThemeModeMock,
    saveThemeMode: state.saveThemeModeMock,
    loadResetTimerDisplayMode: state.loadResetTimerDisplayModeMock,
    saveResetTimerDisplayMode: state.saveResetTimerDisplayModeMock,
    loadGlobalShortcut: state.loadGlobalShortcutMock,
    saveGlobalShortcut: state.saveGlobalShortcutMock,
    loadStatsShortcut: state.loadStatsShortcutMock,
    saveStatsShortcut: state.saveStatsShortcutMock,
    loadStartOnLogin: state.loadStartOnLoginMock,
    saveStartOnLogin: state.saveStartOnLoginMock,
    loadWidgetLayout: state.loadWidgetLayoutMock,
    saveWidgetLayout: state.saveWidgetLayoutMock,
    loadWidgetVisible: state.loadWidgetVisibleMock,
    loadWidgetProviderIds: state.loadWidgetProviderIdsMock,
    saveWidgetProviderIds: state.saveWidgetProviderIdsMock,
    loadWidgetMetric: state.loadWidgetMetricMock,
    saveWidgetMetric: state.saveWidgetMetricMock,
    loadWidgetZoom: state.loadWidgetZoomMock,
    saveWidgetZoom: state.saveWidgetZoomMock,
  }
})

import { WIDGET_METRIC_SUGESTAO } from "@/lib/settings"
import { SettingsWindowApp } from "@/settings-window/SettingsWindowApp"

const openTab = (name: "General" | "Plugins" | "Widget" | "Shortcuts") =>
  userEvent.click(screen.getByRole("tab", { name }))

describe("SettingsWindowApp", () => {
  beforeEach(() => {
    state.keyChangeHandlers = {}
    state.eventHandlers = {}
    state.invokeMock.mockReset()
    state.isTauriMock.mockReset()
    state.isTauriMock.mockReturnValue(true)
    state.minimizeMock.mockReset()
    state.toggleMaximizeMock.mockReset()
    state.closeMock.mockReset()
    state.autostartEnableMock.mockReset()
    state.autostartDisableMock.mockReset()
    state.autostartIsEnabledMock.mockReset()
    state.loadPluginSettingsMock.mockReset()
    state.savePluginSettingsMock.mockReset()
    state.loadAutoUpdateIntervalMock.mockReset()
    state.saveAutoUpdateIntervalMock.mockReset()
    state.loadThemeModeMock.mockReset()
    state.saveThemeModeMock.mockReset()
    state.loadResetTimerDisplayModeMock.mockReset()
    state.saveResetTimerDisplayModeMock.mockReset()
    state.loadGlobalShortcutMock.mockReset()
    state.saveGlobalShortcutMock.mockReset()
    state.loadStatsShortcutMock.mockReset()
    state.saveStatsShortcutMock.mockReset()
    state.loadStartOnLoginMock.mockReset()
    state.saveStartOnLoginMock.mockReset()
    state.loadWidgetLayoutMock.mockReset()
    state.saveWidgetLayoutMock.mockReset()
    state.loadWidgetVisibleMock.mockReset()
    state.loadWidgetProviderIdsMock.mockReset()
    state.saveWidgetProviderIdsMock.mockReset()
    state.loadWidgetMetricMock.mockReset()
    state.saveWidgetMetricMock.mockReset()
    state.loadWidgetZoomMock.mockReset()
    state.saveWidgetZoomMock.mockReset()

    state.autostartEnableMock.mockResolvedValue(undefined)
    state.autostartDisableMock.mockResolvedValue(undefined)
    state.autostartIsEnabledMock.mockResolvedValue(false)
    state.savePluginSettingsMock.mockResolvedValue(undefined)
    state.saveAutoUpdateIntervalMock.mockResolvedValue(undefined)
    state.saveThemeModeMock.mockResolvedValue(undefined)
    state.saveResetTimerDisplayModeMock.mockResolvedValue(undefined)
    state.saveGlobalShortcutMock.mockResolvedValue(undefined)
    state.saveStatsShortcutMock.mockResolvedValue(undefined)
    state.saveStartOnLoginMock.mockResolvedValue(undefined)
    state.saveWidgetLayoutMock.mockResolvedValue(undefined)
    state.saveWidgetProviderIdsMock.mockResolvedValue(undefined)
    state.saveWidgetMetricMock.mockResolvedValue(undefined)
    state.saveWidgetZoomMock.mockResolvedValue(undefined)

    state.loadPluginSettingsMock.mockResolvedValue({ order: ["a", "b"], disabled: [] })
    state.loadAutoUpdateIntervalMock.mockResolvedValue(15)
    state.loadThemeModeMock.mockResolvedValue("system")
    state.loadResetTimerDisplayModeMock.mockResolvedValue("relative")
    state.loadGlobalShortcutMock.mockResolvedValue(null)
    state.loadStatsShortcutMock.mockResolvedValue(null)
    state.loadStartOnLoginMock.mockResolvedValue(false)
    state.loadWidgetLayoutMock.mockResolvedValue("vertical")
    state.loadWidgetVisibleMock.mockResolvedValue(false)
    state.loadWidgetProviderIdsMock.mockResolvedValue(null)
    state.loadWidgetMetricMock.mockResolvedValue(null)
    state.loadWidgetZoomMock.mockResolvedValue(1)

    state.invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "list_plugins") {
        return [
          {
            id: "a",
            name: "Alpha",
            iconUrl: "i",
            brandColor: undefined,
            lines: [{ type: "progress", label: "Weekly", scope: "overview" }],
            primaryCandidates: ["Weekly"],
          },
          { id: "b", name: "Beta", iconUrl: "i", lines: [], primaryCandidates: [] },
        ]
      }
      return null
    })
  })

  it("renders the title bar and key section headings", async () => {
    render(<SettingsWindowApp />)
    expect(await screen.findByText("OpenUsage Settings")).toBeInTheDocument()
    expect(await screen.findByText("Reset Timers")).toBeInTheDocument()
    expect(screen.queryByText("Usage Mode")).not.toBeInTheDocument()
    await openTab("Widget")
    expect(await screen.findByText("Floating Widget")).toBeInTheDocument()
  })

  it("saves the theme mode when selecting Dark", async () => {
    render(<SettingsWindowApp />)
    await userEvent.click(await screen.findByRole("radio", { name: "Dark" }))
    expect(state.saveThemeModeMock).toHaveBeenCalledWith("dark")
  })

  it("persists and re-probes when toggling a plugin", async () => {
    render(<SettingsWindowApp />)
    // Wait for bootstrap to finish so the Plugins list is populated.
    await screen.findByRole("tab", { name: "Plugins" })
    await openTab("Plugins")
    await screen.findByText("Alpha")
    state.invokeMock.mockClear()
    state.savePluginSettingsMock.mockClear()
    const checkboxes = await screen.findAllByRole("checkbox")
    await userEvent.click(checkboxes[checkboxes.length - 1])
    await waitFor(() => expect(state.savePluginSettingsMock).toHaveBeenCalled())
    await waitFor(() =>
      expect(state.invokeMock).toHaveBeenCalledWith("start_probe_batch", expect.anything())
    )
  })

  it("saves the widget metric and switches it to auto", async () => {
    render(<SettingsWindowApp />)
    await screen.findByRole("tab", { name: "Widget" })
    await openTab("Widget")
    await userEvent.click(await screen.findByRole("radio", { name: "Weekly" }))
    expect(state.saveWidgetMetricMock).toHaveBeenCalledWith("Weekly")

    await userEvent.click(await screen.findByRole("radio", { name: "Auto" }))
    expect(state.saveWidgetMetricMock).toHaveBeenCalledWith(WIDGET_METRIC_SUGESTAO)
  })

  it("renders the stats shortcut section", async () => {
    render(<SettingsWindowApp />)
    await screen.findByRole("tab", { name: "Shortcuts" })
    await openTab("Shortcuts")
    expect(await screen.findByText("Stats Shortcut")).toBeInTheDocument()
    expect(await screen.findByText("Show or hide the stats popup")).toBeInTheDocument()
  })

  it("invokes set_widget_visible when toggling the floating widget", async () => {
    render(<SettingsWindowApp />)
    await screen.findByRole("tab", { name: "Widget" })
    await openTab("Widget")
    await screen.findByText("Floating Widget")
    await userEvent.click(await screen.findByText("Show floating widget"))
    await waitFor(() =>
      expect(state.invokeMock).toHaveBeenCalledWith("set_widget_visible", { visible: true })
    )
  })

  it("updates the layout radio when the widget changes it via double-click", async () => {
    render(<SettingsWindowApp />)
    await screen.findByRole("tab", { name: "Widget" })
    await openTab("Widget")
    expect(await screen.findByRole("radio", { name: "Vertical" })).toHaveAttribute(
      "aria-checked",
      "true"
    )
    await waitFor(() => expect(state.keyChangeHandlers["widgetLayout"]).toBeDefined())
    act(() => state.keyChangeHandlers["widgetLayout"]("horizontal"))
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Horizontal" })).toHaveAttribute(
        "aria-checked",
        "true"
      )
    )
  })

  it("updates the visibility checkbox when the widget is toggled elsewhere", async () => {
    render(<SettingsWindowApp />)
    await screen.findByRole("tab", { name: "Widget" })
    await openTab("Widget")
    const label = (await screen.findByText("Show floating widget")).closest("label")!
    expect(within(label).getByRole("checkbox")).toHaveAttribute("aria-checked", "false")
    await waitFor(() => expect(state.eventHandlers["widget:visibility"]).toBeDefined())
    act(() => state.eventHandlers["widget:visibility"]({ payload: true }))
    await waitFor(() =>
      expect(within(label).getByRole("checkbox")).toHaveAttribute("aria-checked", "true")
    )
  })
})
