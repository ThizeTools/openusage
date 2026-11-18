import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PluginState } from "@/hooks/app/types"
import { REFRESH_INTERVAL_MS, type RefreshBackoff } from "@/lib/refresh-policy"

const { getEnabledPluginIdsMock } = vi.hoisted(() => ({
  getEnabledPluginIdsMock: vi.fn(),
}))

vi.mock("@/lib/settings", () => ({
  getEnabledPluginIds: getEnabledPluginIdsMock,
}))

import { useProbeAutoUpdate } from "@/hooks/app/use-probe-auto-update"

const T0 = 10_000

function state(overrides: Partial<PluginState> = {}): PluginState {
  return {
    data: null,
    loading: false,
    error: null,
    lastManualRefreshAt: null,
    lastUpdatedAt: null,
    ...overrides,
  }
}

function setup({
  order,
  states = {},
  backoffs = {},
  startBatch = vi.fn().mockResolvedValue(undefined),
}: {
  order: string[] | null
  states?: Record<string, PluginState>
  backoffs?: Record<string, RefreshBackoff>
  startBatch?: ReturnType<typeof vi.fn>
}) {
  const pluginStatesRef = { current: states }
  const backoffsRef = { current: backoffs }
  const setLoadingForPlugins = vi.fn()
  const setErrorForPlugins = vi.fn()
  const hook = renderHook(
    ({ settings }: { settings: { order: string[]; disabled: string[] } | null }) =>
      useProbeAutoUpdate({
        pluginSettings: settings,
        pluginStatesRef,
        backoffsRef,
        setLoadingForPlugins,
        setErrorForPlugins,
        startBatch,
      }),
    { initialProps: { settings: order ? { order, disabled: [] } : null } }
  )
  return { ...hook, pluginStatesRef, backoffsRef, setLoadingForPlugins, setErrorForPlugins, startBatch }
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe("useProbeAutoUpdate", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    getEnabledPluginIdsMock.mockReset()
    getEnabledPluginIdsMock.mockImplementation((settings: { order: string[]; disabled: string[] }) =>
      settings.order.filter((id) => !settings.disabled.includes(id))
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("stays paused when plugin settings are missing", async () => {
    const { result, startBatch } = setup({ order: null })

    await advance(REFRESH_INTERVAL_MS * 2)

    expect(result.current.autoUpdateNextAt).toBeNull()
    expect(startBatch).not.toHaveBeenCalled()
  })

  it("stays paused when no provider is enabled", () => {
    getEnabledPluginIdsMock.mockReturnValue([])
    const { result } = setup({ order: ["codex"] })

    expect(result.current.autoUpdateNextAt).toBeNull()
  })

  it("counts down to a fixed 5-minute pass from launch", () => {
    const { result } = setup({ order: ["codex"] })

    expect(result.current.autoUpdateNextAt).toBe(T0 + 5 * 60_000)
  })

  it("probes providers with no reading on the first pass and schedules the next 5 minutes after it", async () => {
    const { result, startBatch, setLoadingForPlugins } = setup({ order: ["a", "b"] })

    await advance(REFRESH_INTERVAL_MS)

    expect(setLoadingForPlugins).toHaveBeenCalledWith(["a", "b"])
    expect(startBatch).toHaveBeenCalledWith(["a", "b"])
    expect(startBatch).toHaveBeenCalledTimes(1)
    expect(result.current.autoUpdateNextAt).toBe(T0 + 2 * REFRESH_INTERVAL_MS)

    await advance(REFRESH_INTERVAL_MS)
    expect(startBatch).toHaveBeenCalledTimes(2)
  })

  it("skips providers whose last successful refresh is under 5 minutes old (cache hit)", async () => {
    const { startBatch, setLoadingForPlugins } = setup({
      order: ["fresh", "stale"],
      states: {
        fresh: state({ lastUpdatedAt: T0 + 60_000 }),
        stale: state({ lastUpdatedAt: T0 }),
      },
    })

    await advance(REFRESH_INTERVAL_MS)

    expect(setLoadingForPlugins).toHaveBeenCalledWith(["stale"])
    expect(startBatch).toHaveBeenCalledWith(["stale"])
  })

  it("skips providers held by a backoff and probes them once it ends", async () => {
    const { startBatch } = setup({
      order: ["held", "free"],
      backoffs: {
        held: { failures: 1, retryAt: T0 + REFRESH_INTERVAL_MS + 1, providerAsked: false },
      },
    })

    await advance(REFRESH_INTERVAL_MS)
    expect(startBatch).toHaveBeenLastCalledWith(["free"])

    await advance(REFRESH_INTERVAL_MS)
    expect(startBatch).toHaveBeenLastCalledWith(["held", "free"])
  })

  it("skips providers that are still loading", async () => {
    const { startBatch, setLoadingForPlugins } = setup({
      order: ["slow", "idle"],
      states: { slow: state({ loading: true }) },
    })

    await advance(REFRESH_INTERVAL_MS)

    expect(setLoadingForPlugins).toHaveBeenCalledWith(["idle"])
    expect(startBatch).toHaveBeenCalledWith(["idle"])
  })

  it("starts no batch but keeps the schedule when every provider is skipped", async () => {
    const { result, startBatch, setLoadingForPlugins } = setup({
      order: ["slow"],
      states: { slow: state({ loading: true }) },
    })

    await advance(REFRESH_INTERVAL_MS)

    expect(startBatch).not.toHaveBeenCalled()
    expect(setLoadingForPlugins).not.toHaveBeenCalled()
    expect(result.current.autoUpdateNextAt).toBe(T0 + 2 * REFRESH_INTERVAL_MS)
  })

  it("waits for the pass to finish before counting the next 5 minutes", async () => {
    const pluginStatesRef = { current: {} as Record<string, PluginState> }
    const startBatch = vi.fn().mockImplementation(async () => {
      pluginStatesRef.current = { a: state({ loading: true }) }
      setTimeout(() => {
        pluginStatesRef.current = { a: state({ lastUpdatedAt: Date.now() }) }
      }, 20_000)
    })
    const { result } = renderHook(() =>
      useProbeAutoUpdate({
        pluginSettings: { order: ["a"], disabled: [] },
        pluginStatesRef,
        backoffsRef: { current: {} },
        setLoadingForPlugins: vi.fn(),
        setErrorForPlugins: vi.fn(),
        startBatch,
      })
    )
    expect(result.current.autoUpdateNextAt).toBe(T0 + REFRESH_INTERVAL_MS)

    await advance(REFRESH_INTERVAL_MS + 20_500)

    // The pass ended about 20s after it started; the next one is 5 minutes after that.
    const nextAt = result.current.autoUpdateNextAt
    expect(nextAt).toBeGreaterThanOrEqual(T0 + REFRESH_INTERVAL_MS + 20_000 + REFRESH_INTERVAL_MS)
    expect(nextAt).toBeLessThanOrEqual(T0 + REFRESH_INTERVAL_MS + 20_500 + REFRESH_INTERVAL_MS)
  })

  it("reports a failed batch start and still schedules the next pass", async () => {
    const failure = new Error("boom")
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { result, setErrorForPlugins } = setup({
      order: ["a"],
      startBatch: vi.fn().mockRejectedValue(failure),
    })

    await advance(REFRESH_INTERVAL_MS)

    expect(errorSpy).toHaveBeenCalledWith("Failed to start auto-update batch:", failure)
    expect(setErrorForPlugins).toHaveBeenCalledWith(["a"], "Failed to start probe")
    expect(result.current.autoUpdateNextAt).toBe(T0 + 2 * REFRESH_INTERVAL_MS)
  })

  it("does not restart the countdown when the settings object changes", async () => {
    const { result, rerender } = setup({ order: ["a"] })
    await advance(60_000)

    rerender({ settings: { order: ["a", "b"], disabled: [] } })

    expect(result.current.autoUpdateNextAt).toBe(T0 + REFRESH_INTERVAL_MS)
  })

  it("pauses when the last provider is disabled", () => {
    const { result, rerender } = setup({ order: ["a"] })
    expect(result.current.autoUpdateNextAt).not.toBeNull()

    rerender({ settings: { order: ["a"], disabled: ["a"] } })

    expect(result.current.autoUpdateNextAt).toBeNull()
  })

  it("stops its timer on unmount", async () => {
    const { unmount, startBatch } = setup({ order: ["a"] })
    unmount()

    await advance(REFRESH_INTERVAL_MS * 2)

    expect(startBatch).not.toHaveBeenCalled()
  })
})
