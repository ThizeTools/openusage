import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  keyChangeHandlers: {} as Record<string, (value: unknown) => void>,
  eventHandlers: {} as Record<string, (event: { payload: unknown }) => void>,
  isTauriMock: vi.fn(() => true),
}))

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: state.isTauriMock,
}))

vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, cb: (event: { payload: unknown }) => void) => {
    state.eventHandlers[name] = cb
    return () => {
      delete state.eventHandlers[name]
    }
  },
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

import { useSettingsStoreSync } from "@/hooks/app/use-settings-store-sync"

const pluginsMeta = [
  {
    id: "codex",
    name: "Codex",
    iconUrl: "codex.svg",
    lines: [],
    primaryCandidates: [],
  },
  {
    id: "claude",
    name: "Claude",
    iconUrl: "claude.svg",
    lines: [],
    primaryCandidates: [],
  },
]

function makeArgs() {
  return {
    pluginsMeta,
    setPluginSettings: vi.fn(),
    setMenubarIconStyle: vi.fn(),
    setThemeMode: vi.fn(),
    setResetTimerDisplayMode: vi.fn(),
    setAutoUpdateInterval: vi.fn(),
    setLoadingForPlugins: vi.fn(),
    setErrorForPlugins: vi.fn(),
    startBatch: vi.fn().mockResolvedValue(["codex"]),
    scheduleTrayIconUpdate: vi.fn(),
  }
}

describe("useSettingsStoreSync", () => {
  beforeEach(() => {
    state.keyChangeHandlers = {}
    state.eventHandlers = {}
    state.isTauriMock.mockReset().mockReturnValue(true)
  })

  it("refreshes enabled providers after a settings-window plugin change", async () => {
    const args = makeArgs()
    renderHook(() => useSettingsStoreSync(args))

    await waitFor(() =>
      expect(state.eventHandlers["settings:plugins-changed"]).toBeDefined()
    )
    act(() => {
      state.eventHandlers["settings:plugins-changed"]({
        payload: { order: ["codex", "claude"], disabled: ["claude"] },
      })
    })

    expect(args.setPluginSettings).toHaveBeenCalledWith({
      order: ["codex", "claude"],
      disabled: ["claude"],
    })
    expect(args.setLoadingForPlugins).toHaveBeenCalledWith(["codex"])
    expect(args.startBatch).toHaveBeenCalledWith(["codex"])
    expect(args.scheduleTrayIconUpdate).toHaveBeenCalledWith("settings", 0)
  })

  it("applies auto refresh interval changes from the settings window", async () => {
    const args = makeArgs()
    renderHook(() => useSettingsStoreSync(args))

    await waitFor(() =>
      expect(state.eventHandlers["settings:auto-update-interval-changed"]).toBeDefined()
    )
    act(() => {
      state.eventHandlers["settings:auto-update-interval-changed"]({ payload: 30 })
    })

    expect(args.setAutoUpdateInterval).toHaveBeenCalledWith(30)
  })

  it("reports a provider refresh failure", async () => {
    const args = makeArgs()
    const error = new Error("probe failed")
    args.startBatch.mockRejectedValueOnce(error)
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    renderHook(() => useSettingsStoreSync(args))

    await waitFor(() =>
      expect(state.eventHandlers["settings:plugins-changed"]).toBeDefined()
    )
    act(() => {
      state.eventHandlers["settings:plugins-changed"]({
        payload: { order: ["codex", "claude"], disabled: ["claude"] },
      })
    })

    await waitFor(() => {
      expect(args.setErrorForPlugins).toHaveBeenCalledWith(
        ["codex"],
        "Failed to start probe"
      )
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to refresh providers after settings change:",
        error
      )
    })
    errorSpy.mockRestore()
  })
})
