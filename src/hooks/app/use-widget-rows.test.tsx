import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWidgetRows } from "@/hooks/app/use-widget-rows"

const state = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(async () => () => {}),
  onKeyChangeMock: vi.fn(async () => () => {}),
  loadPluginSettingsMock: vi.fn(),
  loadWidgetProviderIdsMock: vi.fn(),
  loadWidgetProviderMetricsMock: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: state.invokeMock,
  isTauri: () => true
}))

vi.mock("@tauri-apps/api/event", () => ({
  listen: state.listenMock
}))

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class LazyStore {
    onKeyChange = state.onKeyChangeMock
  }
}))

vi.mock("@/hooks/use-now-ticker", () => ({
  useNowTicker: () => Date.now()
}))

vi.mock("@/lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings")>()
  return {
    ...actual,
    loadPluginSettings: state.loadPluginSettingsMock,
    loadWidgetProviderIds: state.loadWidgetProviderIdsMock,
    loadWidgetProviderMetrics: state.loadWidgetProviderMetricsMock,
  }
})

const pluginMeta = {
  id: "claude",
  name: "Claude",
  iconUrl: "claude.svg",
  lines: [{ type: "progress" as const, label: "Session", scope: "overview" as const }],
  primaryCandidates: ["Session"]
}

const cachedOutput = {
  providerId: "claude",
  displayName: "Claude",
  iconUrl: "claude.svg",
  lines: [
    {
      type: "progress" as const,
      label: "Session",
      used: 25,
      limit: 100,
      format: { kind: "percent" as const }
    }
  ]
}

describe("useWidgetRows", () => {
  beforeEach(() => {
    state.invokeMock.mockReset().mockImplementation((command: string) => {
      if (command === "list_plugins") return Promise.resolve([pluginMeta])
      if (command === "get_cached_probe_outputs") return Promise.resolve([cachedOutput])
      return Promise.reject(new Error(`Unexpected command: ${command}`))
    })
    state.listenMock.mockClear()
    state.onKeyChangeMock.mockClear()
    state.loadPluginSettingsMock.mockReset().mockResolvedValue({
      order: ["claude"],
      disabled: []
    })
    state.loadWidgetProviderIdsMock.mockReset().mockResolvedValue(null)
    state.loadWidgetProviderMetricsMock.mockReset().mockResolvedValue({})
  })

  it("reloads the plugin list when accounts change and shows the new account row", async () => {
    const accountMeta = { ...pluginMeta, id: "claude@acc2", name: "Claude · work" }
    const accountOutput = { ...cachedOutput, providerId: "claude@acc2", displayName: "Claude · work" }
    let plugins = [pluginMeta]
    let onAccountsChanged: (() => void) | undefined
    state.listenMock.mockImplementation(async (name: string, cb: () => void) => {
      if (name === "accounts:changed") onAccountsChanged = cb
      return () => {}
    })
    state.invokeMock.mockImplementation((command: string) => {
      if (command === "list_plugins") return Promise.resolve(plugins)
      if (command === "get_cached_probe_outputs") return Promise.resolve([cachedOutput, accountOutput])
      return Promise.reject(new Error(`Unexpected command: ${command}`))
    })

    try {
      const { result } = renderHook(() => useWidgetRows())
      await waitFor(() => expect(result.current.rows.some((row) => row.id === "claude")).toBe(true))
      expect(result.current.rows.some((row) => row.id === "claude@acc2")).toBe(false)
      expect(result.current.claudeAccountCount).toBe(0)

      plugins = [pluginMeta, accountMeta]
      await waitFor(() => expect(onAccountsChanged).toBeDefined())
      act(() => onAccountsChanged?.())

      await waitFor(() => expect(result.current.rows.some((row) => row.id === "claude@acc2")).toBe(true))
      expect(result.current.claudeAccountCount).toBe(1)
      const listCalls = state.invokeMock.mock.calls.filter(([command]) => command === "list_plugins")
      expect(listCalls).toHaveLength(2)
      expect(state.invokeMock).not.toHaveBeenCalledWith("start_probe_batch", expect.anything())
    } finally {
      state.listenMock.mockImplementation(async () => () => {})
    }
  })

  it("hydrates shared results without starting a duplicate provider batch", async () => {
    state.loadWidgetProviderMetricsMock.mockRejectedValueOnce(new Error("store unavailable"))
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    const { result } = renderHook(() => useWidgetRows())

    await waitFor(() => expect(result.current.rows[0]?.name).toBe("Claude"))

    expect(state.invokeMock).toHaveBeenCalledWith("get_cached_probe_outputs")
    expect(state.invokeMock).not.toHaveBeenCalledWith("start_probe_batch", expect.anything())
    expect(consoleError).toHaveBeenCalledWith("Failed to load widget provider metrics:", expect.any(Error))
    consoleError.mockRestore()
  })
})
