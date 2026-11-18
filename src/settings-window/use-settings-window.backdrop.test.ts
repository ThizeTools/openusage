import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ saveMock: vi.fn() }))

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(), emit: vi.fn() }))
vi.mock("@tauri-apps/plugin-autostart", () => ({ enable: vi.fn(), disable: vi.fn(), isEnabled: vi.fn() }))
vi.mock("@tauri-apps/plugin-store", () => ({ LazyStore: class {} }))
vi.mock("@/lib/settings", async () => ({
  ...(await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings")),
  saveMenuBarWidgetBackdrop: state.saveMock,
}))

import { useSettingsWindow } from "@/settings-window/use-settings-window"
import { DEFAULT_MENU_BAR_WIDGET_BACKDROP } from "@/lib/settings"

describe("useSettingsWindow background backdrop", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    state.saveMock.mockReset()
    state.saveMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("starts with the default backdrop", () => {
    const { result } = renderHook(() => useSettingsWindow())
    expect(result.current.menuBarWidgetBackdrop).toEqual(DEFAULT_MENU_BAR_WIDGET_BACKDROP)
  })

  it("updates the state immediately and saves once, 150 ms after the last change", () => {
    const { result } = renderHook(() => useSettingsWindow())
    const next = (opacity: number) => ({ ...DEFAULT_MENU_BAR_WIDGET_BACKDROP, opacity })

    act(() => result.current.handleMenuBarWidgetBackdropChange(next(70)))
    expect(result.current.menuBarWidgetBackdrop.opacity).toBe(70)
    act(() => vi.advanceTimersByTime(100))
    act(() => result.current.handleMenuBarWidgetBackdropChange(next(80)))
    expect(result.current.menuBarWidgetBackdrop.opacity).toBe(80)
    act(() => vi.advanceTimersByTime(149))
    expect(state.saveMock).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(state.saveMock).toHaveBeenCalledTimes(1)
    expect(state.saveMock).toHaveBeenCalledWith(next(80))
  })

  it("flushes a pending save when the window closes", () => {
    const { result, unmount } = renderHook(() => useSettingsWindow())
    const backdrop = { ...DEFAULT_MENU_BAR_WIDGET_BACKDROP, enabled: false }
    act(() => result.current.handleMenuBarWidgetBackdropChange(backdrop))
    unmount()
    expect(state.saveMock).toHaveBeenCalledWith(backdrop)
  })
})
