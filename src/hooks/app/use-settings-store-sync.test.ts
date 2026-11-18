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
    setLoadingForPlugins: vi.fn(),
    setErrorForPlugins: vi.fn(),
    startBatch: vi.fn().mockResolvedValue(["codex"]),
    selectDueProviders: vi.fn((ids: string[]) => ids),
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

  it("only probes the providers the refresh policy considers due", async () => {
    const args = makeArgs()
    args.selectDueProviders.mockImplementation((ids: string[]) =>
      ids.filter((id) => id !== "codex")
    )
    renderHook(() => useSettingsStoreSync(args))

    await waitFor(() =>
      expect(state.eventHandlers["settings:plugins-changed"]).toBeDefined()
    )
    act(() => {
      state.eventHandlers["settings:plugins-changed"]({
        payload: { order: ["codex", "claude"], disabled: [] },
      })
    })

    expect(args.selectDueProviders).toHaveBeenCalledWith(["codex", "claude"])
    expect(args.setLoadingForPlugins).toHaveBeenCalledWith(["claude"])
    expect(args.startBatch).toHaveBeenCalledWith(["claude"])
  })

  it("does not probe when every enabled provider is fresh or backed off", async () => {
    const args = makeArgs()
    args.selectDueProviders.mockReturnValue([])
    renderHook(() => useSettingsStoreSync(args))

    await waitFor(() =>
      expect(state.eventHandlers["settings:plugins-changed"]).toBeDefined()
    )
    act(() => {
      state.eventHandlers["settings:plugins-changed"]({
        payload: { order: ["codex", "claude"], disabled: [] },
      })
    })

    expect(args.setLoadingForPlugins).not.toHaveBeenCalled()
    expect(args.startBatch).not.toHaveBeenCalled()
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
