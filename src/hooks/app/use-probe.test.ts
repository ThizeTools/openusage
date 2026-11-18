import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  loadRefreshBackoffsMock: vi.fn(),
  saveRefreshBackoffsMock: vi.fn(),
  startBatchMock: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: state.invokeMock,
  isTauri: () => true,
}))

vi.mock("@/lib/refresh-backoff-store", () => ({
  loadRefreshBackoffs: state.loadRefreshBackoffsMock,
  saveRefreshBackoffs: state.saveRefreshBackoffsMock,
}))

vi.mock("@/hooks/use-probe-events", () => ({
  useProbeEvents: () => ({ startBatch: state.startBatchMock }),
}))

vi.mock("@/lib/settings", () => ({
  getEnabledPluginIds: (settings: { order: string[]; disabled: string[] }) =>
    settings.order.filter((id) => !settings.disabled.includes(id)),
}))

import { useProbe } from "@/hooks/app/use-probe"

const NOW = 1_700_000_000_000
const MIN = 60_000

const cached = (providerId: string, fetchedAt?: number) => ({
  providerId,
  displayName: providerId,
  iconUrl: "icon",
  lines: [{ type: "text", label: "Session", value: "1" }],
  ...(fetchedAt === undefined ? {} : { fetchedAt }),
})

describe("useProbe launch", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    state.invokeMock.mockReset()
    state.loadRefreshBackoffsMock.mockReset().mockResolvedValue({})
    state.saveRefreshBackoffsMock.mockReset().mockResolvedValue(undefined)
    state.startBatchMock.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setup() {
    return renderHook(() =>
      useProbe({ pluginSettings: { order: ["claude", "codex", "cursor"], disabled: [] } })
    )
  }

  it("hydrates cached data and last-success times, then probes only stale or never-fetched providers", async () => {
    state.invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_cached_probe_outputs") {
        return [
          cached("claude", NOW - MIN), // fresh
          cached("codex", NOW - 10 * MIN), // stale
        ]
      }
      throw new Error(`Unexpected command: ${command}`)
    })
    const { result } = setup()

    await act(async () => {
      await result.current.hydrateProbeState()
    })

    expect(result.current.pluginStates.claude.lastUpdatedAt).toBe(NOW - MIN)
    expect(result.current.pluginStates.claude.data).not.toBeNull()
    expect(result.current.pluginStates.codex.lastUpdatedAt).toBe(NOW - 10 * MIN)
    expect(result.current.selectDueProviders(["claude", "codex", "cursor"])).toEqual([
      "codex",
      "cursor",
    ])
  })

  it("does not probe a provider that was rate limited before the restart", async () => {
    state.invokeMock.mockResolvedValue([cached("claude", NOW - 20 * MIN)])
    state.loadRefreshBackoffsMock.mockResolvedValue({
      claude: {
        failures: 1,
        retryAt: NOW + 3 * MIN,
        providerAsked: true,
        message: "Claude asked OpenUsage to wait. Retrying at 3:45 PM.",
      },
    })
    const { result } = setup()

    await act(async () => {
      await result.current.hydrateProbeState()
    })

    // Stale data, but the provider asked us to wait.
    expect(result.current.selectDueProviders(["claude"])).toEqual([])
    expect(result.current.pluginStates.claude.notice).toContain("asked OpenUsage to wait")
    expect(result.current.pluginStates.claude.data).not.toBeNull()

    // Once the retry time passes, it is probed again.
    vi.setSystemTime(NOW + 3 * MIN + 1)
    expect(result.current.selectDueProviders(["claude"])).toEqual(["claude"])
  })

  it("ignores backoffs that expired while the app was closed", async () => {
    state.invokeMock.mockResolvedValue([])
    state.loadRefreshBackoffsMock.mockResolvedValue({
      claude: { failures: 1, retryAt: NOW - 1, providerAsked: true, message: "old" },
    })
    const { result } = setup()

    await act(async () => {
      await result.current.hydrateProbeState()
    })

    expect(result.current.selectDueProviders(["claude"])).toEqual(["claude"])
    expect(result.current.pluginStates.claude).toBeUndefined()
  })

  it("keeps working when the cache or the backoff store cannot be read", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    state.invokeMock.mockRejectedValue(new Error("no cache"))
    state.loadRefreshBackoffsMock.mockRejectedValue(new Error("no store"))
    const { result } = setup()

    await act(async () => {
      await result.current.hydrateProbeState()
    })

    expect(result.current.selectDueProviders(["claude"])).toEqual(["claude"])
    errorSpy.mockRestore()
  })
})
