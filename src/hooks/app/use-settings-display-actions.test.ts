import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  saveResetTimerDisplayModeMock,
  saveThemeModeMock,
  invokeMock,
  isTauriMock,
} = vi.hoisted(() => ({
  saveThemeModeMock: vi.fn(),
  saveResetTimerDisplayModeMock: vi.fn(),
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}))

vi.mock("@/lib/settings", () => ({
  saveThemeMode: saveThemeModeMock,
  saveResetTimerDisplayMode: saveResetTimerDisplayModeMock,
  saveMenubarIconStyle: vi.fn().mockResolvedValue(undefined),
}))

import { useSettingsDisplayActions } from "@/hooks/app/use-settings-display-actions"

describe("useSettingsDisplayActions", () => {
  beforeEach(() => {
    saveThemeModeMock.mockReset()
    saveResetTimerDisplayModeMock.mockReset()
    invokeMock.mockReset()
    isTauriMock.mockReset()
    saveThemeModeMock.mockResolvedValue(undefined)
    saveResetTimerDisplayModeMock.mockResolvedValue(undefined)
    invokeMock.mockResolvedValue(undefined)
    isTauriMock.mockReturnValue(true)
  })

  it("toggles widget visibility", () => {
    const setWidgetVisible = vi.fn()

    const { result } = renderHook(() =>
      useSettingsDisplayActions({
        setThemeMode: vi.fn(),
        resetTimerDisplayMode: "relative",
        setResetTimerDisplayMode: vi.fn(),
        setMenubarIconStyle: vi.fn(),
        setWidgetVisible,
        scheduleTrayIconUpdate: vi.fn(),
      })
    )

    act(() => {
      result.current.handleWidgetVisibleChange(true)
    })

    expect(setWidgetVisible).toHaveBeenCalledWith(true)
    expect(invokeMock).toHaveBeenCalledWith("set_widget_visible", { visible: true })
  })

  it("applies display-related setting changes", () => {
    const setThemeMode = vi.fn()
    const setResetTimerDisplayMode = vi.fn()
    const scheduleTrayIconUpdate = vi.fn()

    const { result } = renderHook(() =>
      useSettingsDisplayActions({
        setThemeMode,
        resetTimerDisplayMode: "relative",
        setResetTimerDisplayMode,
        setMenubarIconStyle: vi.fn(),
        setWidgetVisible: vi.fn(),
        scheduleTrayIconUpdate,
      })
    )

    act(() => {
      result.current.handleThemeModeChange("dark")
      result.current.handleResetTimerDisplayModeChange("absolute")
    })

    expect(setThemeMode).toHaveBeenCalledWith("dark")
    expect(setResetTimerDisplayMode).toHaveBeenCalledWith("absolute")

    expect(saveThemeModeMock).toHaveBeenCalledWith("dark")
    expect(saveResetTimerDisplayModeMock).toHaveBeenCalledWith("absolute")
  })

  it("toggles reset timer mode in both directions", () => {
    const setResetTimerDisplayMode = vi.fn()

    const { result, rerender } = renderHook(
      ({ mode }: { mode: "relative" | "absolute" }) =>
        useSettingsDisplayActions({
          setThemeMode: vi.fn(),
          resetTimerDisplayMode: mode,
          setResetTimerDisplayMode,
          setMenubarIconStyle: vi.fn(),
          setWidgetVisible: vi.fn(),
          scheduleTrayIconUpdate: vi.fn(),
        }),
      { initialProps: { mode: "relative" as const } }
    )

    act(() => {
      result.current.handleResetTimerDisplayModeToggle()
    })
    expect(setResetTimerDisplayMode).toHaveBeenCalledWith("absolute")

    rerender({ mode: "absolute" })
    act(() => {
      result.current.handleResetTimerDisplayModeToggle()
    })
    expect(setResetTimerDisplayMode).toHaveBeenCalledWith("relative")
  })

  it("logs persistence failures", async () => {
    const themeError = new Error("theme failed")
    const resetError = new Error("reset failed")
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    saveThemeModeMock.mockRejectedValueOnce(themeError)
    saveResetTimerDisplayModeMock.mockRejectedValueOnce(resetError)

    const { result } = renderHook(() =>
      useSettingsDisplayActions({
        setThemeMode: vi.fn(),
        resetTimerDisplayMode: "relative",
        setResetTimerDisplayMode: vi.fn(),
        setMenubarIconStyle: vi.fn(),
        setWidgetVisible: vi.fn(),
        scheduleTrayIconUpdate: vi.fn(),
      })
    )

    act(() => {
      result.current.handleThemeModeChange("light")
      result.current.handleResetTimerDisplayModeChange("relative")
    })

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith("Failed to save theme mode:", themeError)
      expect(errorSpy).toHaveBeenCalledWith("Failed to save reset timer display mode:", resetError)
    })

    errorSpy.mockRestore()
  })
})
