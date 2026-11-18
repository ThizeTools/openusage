import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { getEnabledPluginIdsMock } = vi.hoisted(() => ({
  getEnabledPluginIdsMock: vi.fn(),
}))

vi.mock("@/lib/settings", () => ({
  getEnabledPluginIds: getEnabledPluginIdsMock,
}))

import { useProbeRefreshActions } from "@/hooks/app/use-probe-refresh-actions"

describe("useProbeRefreshActions", () => {
  beforeEach(() => {
    getEnabledPluginIdsMock.mockReset()
    getEnabledPluginIdsMock.mockImplementation((settings: { order: string[]; disabled: string[] }) =>
      settings.order.filter((id) => !settings.disabled.includes(id))
    )
  })

  it("retries one plugin via manual refresh", () => {
    const manualRefreshIdsRef = { current: new Set<string>() }
    const startBatch = vi.fn().mockResolvedValue(undefined)
    const setLoadingForPlugins = vi.fn()

    const { result } = renderHook(() =>
      useProbeRefreshActions({
        pluginSettings: { order: ["codex"], disabled: [] },
        pluginStatesRef: { current: {} },
        manualRefreshIdsRef,
        backoffsRef: { current: {} },
        setLoadingForPlugins,
        setErrorForPlugins: vi.fn(),
        startBatch,
      })
    )

    act(() => {
      result.current.handleRetryPlugin("codex")
    })

    expect(setLoadingForPlugins).toHaveBeenCalledWith(["codex"])
    expect(startBatch).toHaveBeenCalledWith(["codex"])
    expect(manualRefreshIdsRef.current.has("codex")).toBe(true)
  })

  it("retries a plugin right after its previous manual refresh completed", () => {
    const manualRefreshIdsRef = { current: new Set<string>() }
    const startBatch = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() =>
      useProbeRefreshActions({
        pluginSettings: { order: ["codex"], disabled: [] },
        pluginStatesRef: {
          current: {
            codex: { data: null, loading: false, error: null, lastManualRefreshAt: Date.now(), lastUpdatedAt: null },
          },
        },
        manualRefreshIdsRef,
        backoffsRef: { current: {} },
        setLoadingForPlugins: vi.fn(),
        setErrorForPlugins: vi.fn(),
        startBatch,
      })
    )

    act(() => {
      result.current.handleRetryPlugin("codex")
    })

    expect(startBatch).toHaveBeenCalledWith(["codex"])
  })

  it("ignores retry while the plugin is loading or already refreshing manually", () => {
    const startBatch = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() =>
      useProbeRefreshActions({
        pluginSettings: { order: ["a", "b"], disabled: [] },
        pluginStatesRef: {
          current: {
            a: { data: null, loading: true, error: null, lastManualRefreshAt: null, lastUpdatedAt: null },
            b: { data: null, loading: false, error: null, lastManualRefreshAt: null, lastUpdatedAt: null },
          },
        },
        manualRefreshIdsRef: { current: new Set<string>(["b"]) },
        backoffsRef: { current: {} },
        setLoadingForPlugins: vi.fn(),
        setErrorForPlugins: vi.fn(),
        startBatch,
      })
    )

    act(() => {
      result.current.handleRetryPlugin("a")
      result.current.handleRetryPlugin("b")
    })

    expect(startBatch).not.toHaveBeenCalled()
  })

  it("filters out only loading or in-flight plugins for refresh-all", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000)
    const startBatch = vi.fn().mockResolvedValue(undefined)
    const setLoadingForPlugins = vi.fn()

    const { result } = renderHook(() =>
      useProbeRefreshActions({
        pluginSettings: { order: ["a", "b", "c", "d"], disabled: [] },
        pluginStatesRef: {
          current: {
            a: { data: null, loading: true, error: null, lastManualRefreshAt: null, lastUpdatedAt: null },
            b: { data: null, loading: false, error: null, lastManualRefreshAt: 999_999, lastUpdatedAt: null },
            c: { data: null, loading: false, error: null, lastManualRefreshAt: null, lastUpdatedAt: null },
            d: { data: null, loading: false, error: null, lastManualRefreshAt: null, lastUpdatedAt: null },
          },
        },
        manualRefreshIdsRef: { current: new Set<string>(["d"]) },
        backoffsRef: { current: {} },
        setLoadingForPlugins,
        setErrorForPlugins: vi.fn(),
        startBatch,
      })
    )

    act(() => {
      result.current.handleRefreshAll()
    })

    expect(setLoadingForPlugins).toHaveBeenCalledWith(["b", "c"])
    expect(startBatch).toHaveBeenCalledWith(["b", "c"])
    nowSpy.mockRestore()
  })

  it("returns early when settings are unavailable or no plugins are eligible", () => {
    const startBatch = vi.fn()

    const { result, rerender } = renderHook(
      ({ settings }: { settings: { order: string[]; disabled: string[] } | null }) =>
        useProbeRefreshActions({
          pluginSettings: settings,
          pluginStatesRef: {
            current: {
              codex: { data: null, loading: true, error: null, lastManualRefreshAt: null, lastUpdatedAt: null },
            },
          },
          manualRefreshIdsRef: { current: new Set<string>() },
          backoffsRef: { current: {} },
          setLoadingForPlugins: vi.fn(),
          setErrorForPlugins: vi.fn(),
          startBatch,
        }),
      { initialProps: { settings: null } }
    )

    act(() => {
      result.current.handleRefreshAll()
    })
    expect(startBatch).not.toHaveBeenCalled()

    getEnabledPluginIdsMock.mockReturnValueOnce([])
    rerender({ settings: { order: ["codex"], disabled: [] } })
    act(() => {
      result.current.handleRefreshAll()
    })
    expect(startBatch).not.toHaveBeenCalled()
  })

  it("cleans up manual refresh ids and sets errors when batch start fails", async () => {
    const failure = new Error("batch failed")
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const manualRefreshIdsRef = { current: new Set<string>() }
    const setErrorForPlugins = vi.fn()

    const { result } = renderHook(() =>
      useProbeRefreshActions({
        pluginSettings: { order: ["codex"], disabled: [] },
        pluginStatesRef: { current: {} },
        manualRefreshIdsRef,
        backoffsRef: { current: {} },
        setLoadingForPlugins: vi.fn(),
        setErrorForPlugins,
        startBatch: vi.fn().mockRejectedValueOnce(failure),
      })
    )

    act(() => {
      result.current.handleRetryPlugin("codex")
    })

    await waitFor(() => {
      expect(setErrorForPlugins).toHaveBeenCalledWith(["codex"], "Failed to start probe")
      expect(errorSpy).toHaveBeenCalledWith("Failed to retry plugin:", failure)
    })

    expect(manualRefreshIdsRef.current.has("codex")).toBe(false)
    errorSpy.mockRestore()
  })

  describe("refresh policy", () => {
    const T = 1_000_000
    const state = (overrides: Record<string, unknown> = {}) => ({
      data: null,
      loading: false,
      error: null,
      lastManualRefreshAt: null,
      lastUpdatedAt: null,
      ...overrides,
    })

    function setup(opts: {
      order: string[]
      states?: Record<string, ReturnType<typeof state>>
      backoffs?: Record<string, { failures: number; retryAt: number; providerAsked: boolean }>
    }) {
      vi.spyOn(Date, "now").mockReturnValue(T)
      const startBatch = vi.fn().mockResolvedValue(undefined)
      const hook = renderHook(() =>
        useProbeRefreshActions({
          pluginSettings: { order: opts.order, disabled: [] },
          pluginStatesRef: { current: opts.states ?? {} },
          manualRefreshIdsRef: { current: new Set<string>() },
          backoffsRef: { current: opts.backoffs ?? {} },
          setLoadingForPlugins: vi.fn(),
          setErrorForPlugins: vi.fn(),
          startBatch,
        })
      )
      return { ...hook, startBatch }
    }

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it("refreshes a fresh provider: a manual refresh ignores the cache age", () => {
      const { result, startBatch } = setup({
        order: ["codex"],
        states: { codex: state({ lastUpdatedAt: T - 1000 }) },
      })

      act(() => {
        result.current.handleRetryPlugin("codex")
      })

      expect(startBatch).toHaveBeenCalledWith(["codex"])
    })

    it("overrides a backoff the provider did not ask for", () => {
      const { result, startBatch } = setup({
        order: ["a", "b"],
        backoffs: {
          a: { failures: 3, retryAt: T + 600_000, providerAsked: false },
          b: { failures: 1, retryAt: T + 600_000, providerAsked: false },
        },
      })

      act(() => {
        result.current.handleRefreshAll()
      })

      expect(startBatch).toHaveBeenCalledWith(["a", "b"])
    })

    it("respects a backoff the provider asked for, until it ends", () => {
      const held = { failures: 1, retryAt: T + 60_000, providerAsked: true }
      const { result, startBatch } = setup({
        order: ["limited", "ok"],
        backoffs: { limited: held },
      })

      act(() => {
        result.current.handleRetryPlugin("limited")
      })
      expect(startBatch).not.toHaveBeenCalled()

      act(() => {
        result.current.handleRefreshAll()
      })
      expect(startBatch).toHaveBeenCalledWith(["ok"])
    })

    it("refreshes again once a provider-requested backoff has expired", () => {
      const { result, startBatch } = setup({
        order: ["limited"],
        backoffs: { limited: { failures: 1, retryAt: T - 1, providerAsked: true } },
      })

      act(() => {
        result.current.handleRetryPlugin("limited")
      })

      expect(startBatch).toHaveBeenCalledWith(["limited"])
    })
  })
})
