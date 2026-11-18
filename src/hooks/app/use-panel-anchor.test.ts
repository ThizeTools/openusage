import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  isTauri: true,
  mac: false,
  listenMock: vi.fn(),
  handler: null as ((event: { payload: unknown }) => void) | null,
  unlistenMock: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => state.isTauri }))
vi.mock("@tauri-apps/api/event", () => ({ listen: state.listenMock }))
vi.mock("@/lib/platform", () => ({ isMacPlatform: () => state.mac }))

import { defaultPanelAnchor, usePanelAnchor } from "@/hooks/app/use-panel-anchor"

describe("usePanelAnchor", () => {
  beforeEach(() => {
    state.isTauri = true
    state.mac = false
    state.handler = null
    state.unlistenMock.mockReset()
    state.listenMock.mockReset()
    state.listenMock.mockImplementation(async (_event: string, cb: (event: { payload: unknown }) => void) => {
      state.handler = cb
      return state.unlistenMock
    })
  })

  it("defaults to top on macOS and bottom elsewhere", () => {
    state.mac = true
    expect(defaultPanelAnchor()).toBe("top")
    expect(renderHook(() => usePanelAnchor()).result.current).toBe("top")

    state.mac = false
    expect(defaultPanelAnchor()).toBe("bottom")
    expect(renderHook(() => usePanelAnchor()).result.current).toBe("bottom")
  })

  it("follows panel:anchor events and ignores unknown payloads", async () => {
    const { result } = renderHook(() => usePanelAnchor())
    await waitFor(() => expect(state.handler).not.toBeNull())
    expect(state.listenMock).toHaveBeenCalledWith("panel:anchor", expect.any(Function))

    act(() => state.handler!({ payload: "top" }))
    expect(result.current).toBe("top")
    act(() => state.handler!({ payload: "left" }))
    expect(result.current).toBe("top")
    act(() => state.handler!({ payload: "bottom" }))
    expect(result.current).toBe("bottom")
  })

  it("stops listening on unmount", async () => {
    const { unmount } = renderHook(() => usePanelAnchor())
    await waitFor(() => expect(state.handler).not.toBeNull())
    await act(async () => {})
    unmount()
    expect(state.unlistenMock).toHaveBeenCalledTimes(1)
  })

  it("does not listen outside Tauri", () => {
    state.isTauri = false
    renderHook(() => usePanelAnchor())
    expect(state.listenMock).not.toHaveBeenCalled()
  })
})
