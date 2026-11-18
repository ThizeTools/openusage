import { renderHook, act } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PluginOutput } from "@/lib/plugin-types"
import { useProbeState } from "@/hooks/app/use-probe-state"

const { saveRefreshBackoffsMock } = vi.hoisted(() => ({
  saveRefreshBackoffsMock: vi.fn(),
}))

vi.mock("@/lib/refresh-backoff-store", () => ({
  saveRefreshBackoffs: saveRefreshBackoffsMock,
  loadRefreshBackoffs: vi.fn(),
}))

describe("useProbeState", () => {
  it("updates pluginStatesRef synchronously when marking plugins loading", () => {
    const { result } = renderHook(() => useProbeState({}))

    let loadingImmediatelyAfterSet: boolean | undefined
    act(() => {
      result.current.setLoadingForPlugins(["codex"])
      loadingImmediatelyAfterSet =
        result.current.pluginStatesRef.current.codex?.loading
    })

    expect(loadingImmediatelyAfterSet).toBe(true)
    expect(result.current.pluginStates.codex?.loading).toBe(true)
  })

  describe("failures and backoff", () => {
    const NOW = 1_700_000_000_000
    const ok = (overrides: Partial<PluginOutput> = {}): PluginOutput => ({
      providerId: "claude",
      displayName: "Claude",
      iconUrl: "icon",
      lines: [{ type: "text", label: "Session", value: "1" }],
      ...overrides,
    })
    const failed = (
      message: string,
      failure?: PluginOutput["failure"]
    ): PluginOutput => ({
      providerId: "claude",
      displayName: "Claude",
      iconUrl: "icon",
      lines: [{ type: "badge", label: "Error", text: message }],
      ...(failure ? { failure } : {}),
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    function setup() {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      return renderHook(() => useProbeState({}))
    }

    it("records no backoff for a successful probe and clears an earlier one", () => {
      const { result } = setup()
      act(() => result.current.handleProbeResult(failed("nope")))
      expect(result.current.backoffsRef.current.claude).toBeDefined()

      act(() => result.current.handleProbeResult(ok()))

      expect(result.current.backoffsRef.current.claude).toBeUndefined()
      expect(result.current.pluginStates.claude.lastUpdatedAt).toBe(NOW)
      expect(result.current.pluginStates.claude.error).toBeNull()
    })

    it("treats an error badge without a structured failure as refused and backs off exponentially", () => {
      const { result } = setup()

      act(() => result.current.handleProbeResult(failed("nope")))
      expect(result.current.backoffsRef.current.claude).toEqual({
        failures: 1,
        retryAt: NOW + 5 * 60_000,
        providerAsked: false,
        message: "nope",
      })

      act(() => result.current.handleProbeResult(failed("nope")))
      expect(result.current.backoffsRef.current.claude).toEqual({
        failures: 2,
        retryAt: NOW + 10 * 60_000,
        providerAsked: false,
        message: "nope",
      })
      expect(result.current.pluginStates.claude.error).toBe("nope")
      expect(result.current.pluginStates.claude.notice).toBeNull()
    })

    it("uses the structured failure kind: unreachable retries in 5 minutes without a failure count", () => {
      const { result } = setup()

      act(() =>
        result.current.handleProbeResult(failed("Network error.", { kind: "unreachable" }))
      )
      act(() =>
        result.current.handleProbeResult(failed("Network error.", { kind: "unreachable" }))
      )

      expect(result.current.backoffsRef.current.claude).toEqual({
        failures: 0,
        retryAt: NOW + 5 * 60_000,
        providerAsked: false,
        message: "Network error.",
      })
      expect(result.current.pluginStates.claude.error).toBe("Network error.")
    })

    it("a thrown rate limit backs off for Retry-After and shows a notice instead of the error", () => {
      const { result } = setup()

      act(() =>
        result.current.handleProbeResult(
          failed("Request failed (HTTP 429).", { kind: "rateLimited", retryAfterSeconds: 120 })
        )
      )

      expect(result.current.backoffsRef.current.claude).toEqual({
        failures: 1,
        retryAt: NOW + 120_000,
        providerAsked: true,
        message: expect.stringMatching(/^Claude asked OpenUsage to wait\. Retrying at .+\.$/),
      })
      const state = result.current.pluginStates.claude
      expect(state.error).toBeNull()
      expect(state.notice).toMatch(/^Claude asked OpenUsage to wait\. Retrying at .+\.$/)
      expect(state.lastUpdatedAt).toBeNull()
    })

    it("a rate-limited probe that returned lines keeps the last good reading", () => {
      const { result } = setup()
      act(() => result.current.handleProbeResult(ok()))
      const goodReading = result.current.pluginStates.claude.data
      vi.setSystemTime(NOW + 10 * 60_000)

      act(() =>
        result.current.handleProbeResult({
          ...ok({ lines: [{ type: "badge", label: "Status", text: "Rate limited, retry in ~2m" }] }),
          failure: { kind: "rateLimited", retryAfterSeconds: 120 },
        })
      )

      const state = result.current.pluginStates.claude
      expect(state.data).toBe(goodReading)
      expect(state.lastUpdatedAt).toBe(NOW)
      expect(state.error).toBeNull()
      expect(state.notice).toContain("asked OpenUsage to wait")
      expect(result.current.backoffsRef.current.claude.providerAsked).toBe(true)
    })

    it("a rate-limited probe with no earlier reading still shows its own badge", () => {
      const { result } = setup()
      const badge = ok({
        lines: [{ type: "badge", label: "Status", text: "Rate limited, try again later" }],
        failure: { kind: "rateLimited" },
      })

      act(() => result.current.handleProbeResult(badge))

      expect(result.current.pluginStates.claude.data).toBe(badge)
      expect(result.current.pluginStates.claude.lastUpdatedAt).toBeNull()
      expect(result.current.pluginStates.claude.notice).not.toBeNull()
    })

    it("a failed probe keeps the last good reading and its timestamp", () => {
      const { result } = setup()
      act(() => result.current.handleProbeResult(ok()))
      const goodReading = result.current.pluginStates.claude.data

      act(() => result.current.handleProbeResult(failed("nope")))

      expect(result.current.pluginStates.claude.data).toBe(goodReading)
      expect(result.current.pluginStates.claude.lastUpdatedAt).toBe(NOW)
    })

    it("clears the notice when the provider is probed again", () => {
      const { result } = setup()
      act(() =>
        result.current.handleProbeResult(failed("429", { kind: "rateLimited", retryAfterSeconds: 60 }))
      )
      expect(result.current.pluginStates.claude.notice).not.toBeNull()

      act(() => result.current.setLoadingForPlugins(["claude"]))
      expect(result.current.pluginStates.claude.notice).toBeNull()

      act(() => result.current.handleProbeResult(ok()))
      expect(result.current.pluginStates.claude.notice).toBeNull()
      expect(result.current.backoffsRef.current.claude).toBeUndefined()
    })

    it("only a successful probe counts as a manual refresh", () => {
      const { result } = setup()
      act(() => {
        result.current.manualRefreshIdsRef.current.add("claude")
        result.current.handleProbeResult(failed("nope"))
      })
      expect(result.current.pluginStates.claude.lastManualRefreshAt).toBeNull()

      act(() => {
        result.current.manualRefreshIdsRef.current.add("claude")
        result.current.handleProbeResult(ok())
      })
      expect(result.current.pluginStates.claude.lastManualRefreshAt).toBe(NOW)
    })
  })
  describe("launch hydration and persisted backoffs", () => {
    const NOW = 1_700_000_000_000
    const cached = (providerId: string, fetchedAt?: number) => ({
      providerId,
      displayName: providerId,
      iconUrl: "icon",
      lines: [{ type: "text" as const, label: "Session", value: "1" }],
      ...(fetchedAt === undefined ? {} : { fetchedAt }),
    })

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      saveRefreshBackoffsMock.mockReset().mockResolvedValue(undefined)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it("hydrates the cached data with the last successful fetch time", () => {
      const { result } = renderHook(() => useProbeState({}))

      act(() =>
        result.current.hydrateFromCache([cached("claude", NOW - 60_000), cached("codex")])
      )

      const claude = result.current.pluginStates.claude
      expect(claude.lastUpdatedAt).toBe(NOW - 60_000)
      expect(claude.loading).toBe(false)
      expect(claude.data?.lines).toHaveLength(1)
      expect("fetchedAt" in (claude.data ?? {})).toBe(false)
      expect(result.current.pluginStates.codex.lastUpdatedAt).toBeNull()
      expect(result.current.pluginStates.codex.data).not.toBeNull()
    })

    it("keeps a live result that arrived before the cache hydrated", () => {
      const { result } = renderHook(() => useProbeState({}))
      act(() =>
        result.current.handleProbeResult({
          providerId: "claude",
          displayName: "Claude",
          iconUrl: "icon",
          lines: [{ type: "text", label: "Live", value: "2" }],
        })
      )

      act(() => result.current.hydrateFromCache([cached("claude", NOW - 60_000)]))

      expect(result.current.pluginStates.claude.lastUpdatedAt).toBe(NOW)
      expect(result.current.pluginStates.claude.data?.lines[0]).toMatchObject({ label: "Live" })
    })

    it("saves the backoffs when a probe fails and when a success clears one", () => {
      const { result } = renderHook(() => useProbeState({ persistBackoffs: true }))

      act(() =>
        result.current.handleProbeResult({
          providerId: "claude",
          displayName: "Claude",
          iconUrl: "icon",
          lines: [{ type: "badge", label: "Error", text: "HTTP 429" }],
          failure: { kind: "rateLimited", retryAfterSeconds: 600 },
        })
      )
      expect(saveRefreshBackoffsMock).toHaveBeenCalledTimes(1)
      expect(saveRefreshBackoffsMock.mock.calls[0][0].claude).toMatchObject({
        failures: 1,
        retryAt: NOW + 600_000,
        providerAsked: true,
      })

      act(() =>
        result.current.handleProbeResult({
          providerId: "claude",
          displayName: "Claude",
          iconUrl: "icon",
          lines: [{ type: "text", label: "Session", value: "1" }],
        })
      )
      expect(saveRefreshBackoffsMock).toHaveBeenCalledTimes(2)
      expect(saveRefreshBackoffsMock.mock.calls[1][0].claude).toBeUndefined()
    })

    it("does not save backoffs unless asked to", () => {
      const { result } = renderHook(() => useProbeState({}))
      act(() =>
        result.current.handleProbeResult({
          providerId: "claude",
          displayName: "Claude",
          iconUrl: "icon",
          lines: [{ type: "badge", label: "Error", text: "nope" }],
        })
      )
      expect(saveRefreshBackoffsMock).not.toHaveBeenCalled()
    })

    it("restores unexpired backoffs with their message and drops expired ones", () => {
      const { result } = renderHook(() => useProbeState({}))

      act(() =>
        result.current.restoreBackoffs({
          claude: {
            failures: 1,
            retryAt: NOW + 120_000,
            providerAsked: true,
            message: "Claude asked OpenUsage to wait. Retrying at 3:45 PM.",
          },
          codex: { failures: 1, retryAt: NOW - 1, providerAsked: true, message: "old" },
        })
      )

      expect(result.current.backoffsRef.current.claude.retryAt).toBe(NOW + 120_000)
      expect(result.current.backoffsRef.current.codex).toBeUndefined()
      expect(result.current.pluginStates.claude.notice).toBe(
        "Claude asked OpenUsage to wait. Retrying at 3:45 PM."
      )
      expect(result.current.pluginStates.codex).toBeUndefined()
    })
  })
})
