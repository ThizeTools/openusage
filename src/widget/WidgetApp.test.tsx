import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WidgetApp } from "@/widget/WidgetApp"

const state = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(() => true),
  emitMock: vi.fn(),
  outerPositionMock: vi.fn(),
  setSizeMock: vi.fn(),
  toggleLayoutMock: vi.fn(),
  widgetData: {
    rows: [] as Array<{
      id: string
      name: string
      iconUrl: string
      brandColor?: string
      fraction: number | null
      tone: "ahead" | "on-track" | "behind" | "neutral"
    }>,
    layout: "horizontal" as "vertical" | "horizontal",
    zoom: 1,
    setWidgetZoomMock: vi.fn(),
    ready: true,
  },
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: state.invokeMock,
  isTauri: state.isTauriMock,
}))

vi.mock("@tauri-apps/api/event", () => ({
  emit: state.emitMock,
}))

vi.mock("@tauri-apps/api/window", () => ({
  PhysicalSize: class PhysicalSize {
    width: number
    height: number
    constructor(width: number, height: number) {
      this.width = width
      this.height = height
    }
  },
  getCurrentWindow: () => ({
    outerPosition: state.outerPositionMock,
    setSize: state.setSizeMock,
  }),
}))

vi.mock("@/hooks/use-dark-mode", () => ({
  useDarkMode: () => false,
}))

vi.mock("@/widget/use-widget-data", () => ({
  useWidgetData: () => ({
    ...state.widgetData,
    setWidgetZoom: state.widgetData.setWidgetZoomMock,
    toggleLayout: state.toggleLayoutMock,
  }),
}))

class ResizeObserverStub {
  cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("WidgetApp drag", () => {
  afterEach(() => {
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 })
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    state.invokeMock.mockReset().mockResolvedValue(undefined)
    state.isTauriMock.mockReset().mockReturnValue(true)
    state.emitMock.mockReset()
    state.outerPositionMock.mockReset().mockResolvedValue({ x: 100, y: 200 })
    state.setSizeMock.mockReset().mockResolvedValue(undefined)
    state.toggleLayoutMock.mockReset()
    state.widgetData.rows = []
    state.widgetData.layout = "horizontal"
    state.widgetData.ready = true
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    })
  })

  it("drags via move_widget_to using the DPR snapshotted on pointerdown", async () => {
    const originalDpr = window.devicePixelRatio
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1.5 })
    render(<WidgetApp />)
    const root = screen.getByTitle("Double-click to switch layout · Scroll to zoom")

    fireEvent.pointerDown(root, { button: 0, pointerId: 1, screenX: 10, screenY: 20 })
    await waitFor(() => expect(state.outerPositionMock).toHaveBeenCalled())
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 })
    fireEvent.pointerMove(root, { pointerId: 1, buttons: 1, screenX: 30, screenY: 50 })

    await waitFor(() =>
      expect(state.invokeMock).toHaveBeenCalledWith("move_widget_to", { x: 130, y: 245 })
    )
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: originalDpr })
  })

  it("clears stale drag state on buttonless pointermove", async () => {
    render(<WidgetApp />)
    const root = screen.getByTitle("Double-click to switch layout · Scroll to zoom")
    fireEvent.pointerDown(root, { button: 0, pointerId: 1, screenX: 10, screenY: 20 })
    await waitFor(() => expect(state.outerPositionMock).toHaveBeenCalled())

    fireEvent.pointerMove(root, { pointerId: 1, buttons: 0, screenX: 100, screenY: 100 })
    fireEvent.pointerMove(root, { pointerId: 1, buttons: 0, screenX: 200, screenY: 200 })

    expect(state.invokeMock).not.toHaveBeenCalledWith("move_widget_to", expect.anything())
  })

  it("does not toggle layout when a drag forms part of a double click", async () => {
    render(<WidgetApp />)
    const root = screen.getByTitle("Double-click to switch layout · Scroll to zoom")
    fireEvent.pointerDown(root, { button: 0, pointerId: 1, screenX: 10, screenY: 20 })
    await waitFor(() => expect(state.outerPositionMock).toHaveBeenCalled())
    fireEvent.pointerMove(root, { pointerId: 1, buttons: 1, screenX: 20, screenY: 20 })
    fireEvent.pointerUp(root, { pointerId: 1 })
    fireEvent.doubleClick(root)

    expect(state.toggleLayoutMock).not.toHaveBeenCalled()
  })

  it("sizes from fractional border-box dimensions and then recovers off-screen placement", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 348.4,
      height: 24.4,
      top: 0,
      right: 348.4,
      bottom: 24.4,
      left: 0,
      toJSON: () => {},
    })
    render(<WidgetApp />)

    await waitFor(() => expect(state.setSizeMock).toHaveBeenCalled())
    expect(state.setSizeMock.mock.calls[0][0]).toMatchObject({ width: 349, height: 25 })
    expect(state.invokeMock).toHaveBeenCalledWith("bring_widget_on_screen")
  })

  it("uses horizontal dividers for horizontal rows", () => {
    state.widgetData.rows = [{ id: "claude", name: "Claude", iconUrl: "claude.svg", fraction: 0.5, tone: "neutral" }]
    state.widgetData.layout = "horizontal"
    render(<WidgetApp />)

    expect(screen.getByTestId("widget-row").parentElement).toHaveClass("divide-x", "divide-border")
  })

  it("uses vertical dividers for vertical rows", () => {
    state.widgetData.rows = [{ id: "claude", name: "Claude", iconUrl: "claude.svg", fraction: 0.5, tone: "neutral" }]
    state.widgetData.layout = "vertical"
    render(<WidgetApp />)

    expect(screen.getByTestId("widget-row").parentElement).toHaveClass("divide-y", "divide-border")
  })

  it("does not force a minimum width in vertical layout", () => {
    state.widgetData.rows = [{ id: "claude", name: "Claude", iconUrl: "claude.svg", fraction: 0.5, tone: "neutral" }]
    state.widgetData.layout = "vertical"
    render(<WidgetApp />)

    const root = screen.getByTitle("Double-click to switch layout · Scroll to zoom")
    expect(root).toHaveStyle({ width: "max-content" })
    expect(root).not.toHaveStyle({ minWidth: "260px" })
  })

  it("adjusts zoom slowly on wheel", () => {
    state.widgetData.zoom = 1
    state.widgetData.setWidgetZoomMock.mockReset()
    render(<WidgetApp />)

    const root = screen.getByTitle("Double-click to switch layout · Scroll to zoom")
    fireEvent.wheel(root, { deltaY: -100 })

    expect(state.widgetData.setWidgetZoomMock).toHaveBeenCalledTimes(1)
    const next = state.widgetData.setWidgetZoomMock.mock.calls[0][0] as number
    expect(next).toBeGreaterThan(1)
    expect(next).toBeLessThan(1.1)
  })
})
