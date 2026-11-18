import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { saveStartOnLoginMock } = vi.hoisted(() => ({
  saveStartOnLoginMock: vi.fn(),
}))

vi.mock("@/lib/settings", () => ({
  saveStartOnLogin: saveStartOnLoginMock,
}))

import { useSettingsSystemActions } from "@/hooks/app/use-settings-system-actions"

describe("useSettingsSystemActions", () => {
  beforeEach(() => {
    saveStartOnLoginMock.mockReset()
    saveStartOnLoginMock.mockResolvedValue(undefined)
  })

  it("updates start-on-login settings", () => {
    const setStartOnLogin = vi.fn()
    const applyStartOnLogin = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() =>
      useSettingsSystemActions({
        setStartOnLogin,
        applyStartOnLogin,
      })
    )

    act(() => {
      result.current.handleStartOnLoginChange(true)
    })

    expect(setStartOnLogin).toHaveBeenCalledWith(true)
    expect(saveStartOnLoginMock).toHaveBeenCalledWith(true)
    expect(applyStartOnLogin).toHaveBeenCalledWith(true)
  })

  it("logs persistence/update failures", async () => {
    const startOnLoginSaveError = new Error("start on login save failed")
    const startOnLoginApplyError = new Error("start on login apply failed")
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    saveStartOnLoginMock.mockRejectedValueOnce(startOnLoginSaveError)
    const applyStartOnLogin = vi.fn().mockRejectedValueOnce(startOnLoginApplyError)

    const { result } = renderHook(() =>
      useSettingsSystemActions({
        setStartOnLogin: vi.fn(),
        applyStartOnLogin,
      })
    )

    act(() => {
      result.current.handleStartOnLoginChange(false)
    })

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith("Failed to save start on login:", startOnLoginSaveError)
      expect(errorSpy).toHaveBeenCalledWith("Failed to update start on login:", startOnLoginApplyError)
    })

    errorSpy.mockRestore()
  })
})
