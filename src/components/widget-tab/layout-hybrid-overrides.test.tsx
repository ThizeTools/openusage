import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  mac: false,
  windows: false,
  stored: {} as Record<string, unknown>,
  saveMock: vi.fn(),
}))

vi.mock("@/lib/platform", async () => ({
  ...(await vi.importActual<typeof import("@/lib/platform")>("@/lib/platform")),
  isMacPlatform: () => state.mac,
  isWindowsPlatform: () => state.windows,
  widgetSurfaceName: () => (state.windows ? "taskbar" : "menu bar"),
}))
vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings")
  return {
    ...actual,
    loadSurfaceOverrides: async (surface: "menuBar" | "dock") => actual.parseSurfaceOverrides(state.stored[surface]),
    saveSurfaceOverrides: state.saveMock,
    loadDockOverlayStyle: async () => "off",
  }
})
vi.mock("@/lib/menubar-widget-image", async () => ({
  ...(await vi.importActual<typeof import("@/lib/menubar-widget-image")>("@/lib/menubar-widget-image")),
  renderMenuBarWidgetPng: vi.fn(async () => "AAAA"),
}))
vi.mock("@/lib/icon-mask", () => ({ getIconMask: vi.fn(async () => null) }))

import { LayoutHybrid } from "@/components/widget-tab/layout-hybrid"
import { makeWidgetTabModel } from "@/test/widget-tab-model"

const ownProviders = { providers: { providerIds: ["claude"], providerMetrics: {} } }
const ownColors = {
  colors: {
    colors: {},
    textColors: { label: "mono", used: "color", expected: "mono" },
    toneModes: { ahead: "mono", onTrack: "color", behind: "color" },
  },
}

beforeEach(() => {
  state.mac = false
  state.windows = false
  state.stored = {}
  state.saveMock.mockReset().mockResolvedValue(undefined)
})
afterEach(() => cleanup())

const openTab = (name: string) => userEvent.click(screen.getByRole("tab", { name }))
const note = () => screen.queryByTestId("override-note")

describe("LayoutHybrid overrides", () => {
  it("shows no note on Providers and Colors while nothing is overridden", async () => {
    state.mac = true
    render(<LayoutHybrid model={makeWidgetTabModel()} />)
    await openTab("Colors")
    expect(screen.getByTestId("widget-colors")).toBeInTheDocument()
    await Promise.resolve()
    expect(note()).toBeNull()
  })

  it("notes which surfaces use their own providers", async () => {
    state.mac = true
    state.stored = { menuBar: ownProviders }
    render(<LayoutHybrid model={makeWidgetTabModel()} />)
    await waitFor(() => expect(note()).toHaveTextContent("Menu Bar uses its own providers."))
    state.stored = { menuBar: ownProviders, dock: ownProviders }
    cleanup()
    render(<LayoutHybrid model={makeWidgetTabModel()} />)
    await waitFor(() => expect(note()).toHaveTextContent("Dock and Menu Bar use their own providers."))
  })

  it("notes which surfaces use their own colors", async () => {
    state.mac = true
    state.stored = { dock: ownColors, menuBar: ownColors }
    render(<LayoutHybrid model={makeWidgetTabModel()} />)
    await openTab("Colors")
    await waitFor(() => expect(note()).toHaveTextContent("Dock and Menu Bar use their own colors."))
  })

  it("does not mention the providers note on the Colors tab", async () => {
    state.mac = true
    state.stored = { dock: ownProviders }
    render(<LayoutHybrid model={makeWidgetTabModel()} />)
    await waitFor(() => expect(note()).toHaveTextContent("Dock uses its own providers."))
    await openTab("Colors")
    await Promise.resolve()
    expect(note()).toBeNull()
  })

  it("on Windows names only the Taskbar", async () => {
    state.windows = true
    state.stored = { menuBar: ownColors, dock: ownColors }
    render(<LayoutHybrid model={makeWidgetTabModel()} />)
    await openTab("Colors")
    await waitFor(() => expect(note()).toHaveTextContent("Taskbar uses its own colors."))
  })

  it("Menu Bar pane ends with the overrides card, saved per surface", async () => {
    state.mac = true
    render(<LayoutHybrid model={makeWidgetTabModel()} />)
    await openTab("Menu Bar")
    expect(screen.getByTestId("surface-overrides-menuBar")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("switch", { name: "Own providers" }))
    expect(state.saveMock).toHaveBeenLastCalledWith("menuBar", {
      colors: null,
      providers: { providerIds: null, providerMetrics: {} },
    })
  })

  it("Dock pane has its own overrides card, and its preview follows the override", async () => {
    state.mac = true
    state.stored = { dock: ownProviders }
    render(<LayoutHybrid model={makeWidgetTabModel()} />)
    await openTab("Dock")
    expect(screen.getByTestId("surface-overrides-dock")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId("dock-tile-codex")).toBeNull())
    expect(screen.getByTestId("dock-tile-claude")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("switch", { name: "Own colors" }))
    expect(state.saveMock).toHaveBeenLastCalledWith("dock", expect.objectContaining({ colors: expect.any(Object) }))
  })
})
