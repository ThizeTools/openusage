import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  isTauri: true,
  mac: true,
  systemDark: false,
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  unlistenMock: vi.fn(),
  handler: null as ((event: { payload: unknown }) => void) | null,
}))

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => state.isTauri, invoke: state.invokeMock }))
vi.mock("@tauri-apps/api/event", () => ({ listen: state.listenMock }))
vi.mock("@/lib/platform", () => ({ usesRenderedWidget: () => state.mac }))
vi.mock("@/hooks/use-system-dark", () => ({ useSystemDark: () => state.systemDark }))

import { useMenuBarDark } from "@/hooks/app/use-menu-bar-dark"

describe("useMenuBarDark", () => {
  beforeEach(() => {
    state.isTauri = true
    state.mac = true
    state.systemDark = false
    state.handler = null
    state.invokeMock.mockReset()
    state.unlistenMock.mockReset()
    state.listenMock.mockReset()
    state.invokeMock.mockResolvedValue("dark")
    state.listenMock.mockImplementation(async (_event: string, cb: (event: { payload: unknown }) => void) => {
      state.handler = cb
      return state.unlistenMock
    })
  })

  it("starts from the native appearance, not the system scheme", async () => {
    const { result } = renderHook(() => useMenuBarDark())
    await waitFor(() => expect(result.current).toBe(true))
    expect(state.invokeMock).toHaveBeenCalledWith("menu_bar_appearance")
  })

  it("reads a light menu bar over a dark system scheme", async () => {
    state.systemDark = true
    state.invokeMock.mockResolvedValue("light")
    const { result } = renderHook(() => useMenuBarDark())
    await waitFor(() => expect(result.current).toBe(false))
  })

  it("follows menubar:appearance events", async () => {
    const { result } = renderHook(() => useMenuBarDark())
    await waitFor(() => expect(result.current).toBe(true))
    expect(state.listenMock).toHaveBeenCalledWith("menubar:appearance", expect.any(Function))
    act(() => state.handler?.({ payload: "light" }))
    expect(result.current).toBe(false)
    act(() => state.handler?.({ payload: "dark" }))
    expect(result.current).toBe(true)
    act(() => state.handler?.({ payload: "weird" }))
    expect(result.current).toBe(true)
  })

  it("an event that arrives before the initial answer wins", async () => {
    let resolveInvoke: (value: unknown) => void = () => {}
    state.invokeMock.mockReturnValue(new Promise((resolve) => (resolveInvoke = resolve)))
    const { result } = renderHook(() => useMenuBarDark())
    await waitFor(() => expect(state.handler).not.toBeNull())
    act(() => state.handler?.({ payload: "light" }))
    await act(async () => resolveInvoke("dark"))
    expect(result.current).toBe(false)
  })

  it("falls back to the system scheme when the native value is null or the call fails", async () => {
    state.systemDark = true
    state.invokeMock.mockResolvedValue(null)
    const first = renderHook(() => useMenuBarDark())
    await waitFor(() => expect(state.invokeMock).toHaveBeenCalled())
    expect(first.result.current).toBe(true)

    state.invokeMock.mockRejectedValue(new Error("boom"))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    state.systemDark = false
    const second = renderHook(() => useMenuBarDark())
    await waitFor(() => expect(errorSpy).toHaveBeenCalled())
    expect(second.result.current).toBe(false)
    errorSpy.mockRestore()
  })

  it("uses the system scheme without calling native outside macOS/Windows or Tauri", () => {
    state.mac = false
    state.systemDark = true
    expect(renderHook(() => useMenuBarDark()).result.current).toBe(true)
    state.mac = true
    state.isTauri = false
    state.systemDark = false
    expect(renderHook(() => useMenuBarDark()).result.current).toBe(false)
    expect(state.invokeMock).not.toHaveBeenCalled()
    expect(state.listenMock).not.toHaveBeenCalled()
  })

  it("stops listening on unmount", async () => {
    const { unmount } = renderHook(() => useMenuBarDark())
    await waitFor(() => expect(state.handler).not.toBeNull())
    await Promise.resolve()
    unmount()
    expect(state.unlistenMock).toHaveBeenCalled()
  })
})
