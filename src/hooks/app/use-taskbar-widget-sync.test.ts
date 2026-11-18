import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  mac: false,
  windows: false,
  invokeMock: vi.fn(),
  pngMock: vi.fn(),
  rgbaMock: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: state.invokeMock }))
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    onKeyChange = vi.fn(async () => () => {})
  },
}))
vi.mock("@/lib/platform", () => ({
  isMacPlatform: () => state.mac,
  isWindowsPlatform: () => state.windows,
  usesRenderedWidget: () => state.mac || state.windows,
}))
vi.mock("@/hooks/app/use-menu-bar-dark", () => ({ useMenuBarDark: () => true }))
vi.mock("@/hooks/app/use-widget-rows", () => ({
  useWidgetRows: () => [
    {
      id: "claude",
      name: "Claude",
      iconUrl: "claude.svg",
      brandColor: "#DE7356",
      fraction: 0.4,
      expectedFraction: 0.3,
      tone: "on-track",
      metrics: [{ label: "Session", fraction: 0.4, expectedFraction: 0.3, tone: "on-track" }],
    },
  ],
}))
vi.mock("@/lib/icon-mask", () => ({ getIconMask: vi.fn(async () => null) }))
vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings")
  return {
    ...actual,
    loadMenuBarWidgetBackdrop: vi.fn(async () => actual.DEFAULT_MENU_BAR_WIDGET_BACKDROP),
    loadMenuBarWidgetStyle: vi.fn(async () => "stacked"),
    loadMenuBarWidgetColors: vi.fn(async () => ({})),
    loadMenuBarWidgetTextColors: vi.fn(async () => actual.DEFAULT_MENU_BAR_WIDGET_TEXT_COLORS),
    loadMenuBarWidgetToneModes: vi.fn(async () => actual.DEFAULT_MENU_BAR_WIDGET_TONE_MODES),
  }
})
vi.mock("@/lib/menubar-widget-image", async () => ({
  ...(await vi.importActual<typeof import("@/lib/menubar-widget-image")>("@/lib/menubar-widget-image")),
  renderMenuBarWidgetPng: state.pngMock,
  renderMenuBarWidgetRgba: state.rgbaMock,
}))

import { useTaskbarWidgetSync } from "@/hooks/app/use-taskbar-widget-sync"

describe("useTaskbarWidgetSync", () => {
  beforeEach(() => {
    state.mac = false
    state.windows = false
    state.invokeMock.mockReset()
    state.invokeMock.mockResolvedValue(undefined)
    state.pngMock.mockReset()
    state.pngMock.mockResolvedValue("PNG")
    state.rgbaMock.mockReset()
    state.rgbaMock.mockResolvedValue({ width: 3, height: 66, rgba: "AAAA" })
  })

  const sentPayload = () => {
    const call = state.invokeMock.mock.calls.find(([cmd]) => cmd === "taskbar_widget_update")
    return call?.[1].payload as Record<string, unknown> | undefined
  }

  it("on Windows sends the rendered RGBA widget and no menu bar image", async () => {
    state.windows = true
    renderHook(() => useTaskbarWidgetSync())
    await waitFor(() => expect(sentPayload()).toBeDefined())
    expect(sentPayload()?.widgetImage).toEqual({ width: 3, height: 66, rgba: "AAAA" })
    expect(sentPayload()?.menuBarImage).toBeUndefined()
    expect(state.rgbaMock).toHaveBeenCalled()
    expect(state.pngMock).not.toHaveBeenCalled()
  })

  it("on macOS keeps sending the PNG and the backdrop", async () => {
    state.mac = true
    renderHook(() => useTaskbarWidgetSync())
    await waitFor(() => expect(sentPayload()).toBeDefined())
    expect(sentPayload()?.menuBarImage).toBe("PNG")
    expect(sentPayload()?.widgetImage).toBeUndefined()
    expect(state.rgbaMock).not.toHaveBeenCalled()
  })

  it("falls back to the native layout (no image) when the render fails", async () => {
    state.windows = true
    state.rgbaMock.mockRejectedValue(new Error("no canvas"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    renderHook(() => useTaskbarWidgetSync())
    await waitFor(() => expect(sentPayload()).toBeDefined())
    expect(sentPayload()?.widgetImage).toBeNull()
  })
})
