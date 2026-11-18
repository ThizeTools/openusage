import { describe, expect, it } from "vitest"
import {
  FAILURE_BACKOFF_CAP_MS,
  REFRESH_INTERVAL_MS,
  backoffAfter,
  backoffDelayMs,
  backoffHolds,
  decideRefresh,
  isFresh,
  rateLimitNotice,
  selectProvidersToProbe,
  parseStoredBackoffs,
  activeBackoffs,
  type RefreshBackoff,
} from "@/lib/refresh-policy"

const MIN = 60_000
const NOW = 1_000_000_000

describe("refresh policy constants", () => {
  it("refreshes every 5 minutes", () => {
    expect(REFRESH_INTERVAL_MS).toBe(5 * MIN)
    expect(FAILURE_BACKOFF_CAP_MS).toBe(60 * MIN)
  })
})

describe("backoffDelayMs", () => {
  it("is 5 minutes for zero or one failure", () => {
    expect(backoffDelayMs(0)).toBe(5 * MIN)
    expect(backoffDelayMs(1)).toBe(5 * MIN)
  })

  it("doubles per extra failure and caps at 1 hour", () => {
    expect(backoffDelayMs(2)).toBe(10 * MIN)
    expect(backoffDelayMs(3)).toBe(20 * MIN)
    expect(backoffDelayMs(4)).toBe(40 * MIN)
    expect(backoffDelayMs(5)).toBe(60 * MIN)
    expect(backoffDelayMs(6)).toBe(60 * MIN)
    expect(backoffDelayMs(17)).toBe(60 * MIN)
    expect(backoffDelayMs(1000)).toBe(60 * MIN)
  })

  it("treats negative failure counts like none", () => {
    expect(backoffDelayMs(-3)).toBe(5 * MIN)
  })
})

describe("backoffAfter", () => {
  const prev = (failures: number): RefreshBackoff => ({
    failures,
    retryAt: NOW - 1,
    providerAsked: true,
  })

  it("unreachable retries in 5 minutes without counting a failure", () => {
    expect(backoffAfter({ kind: "unreachable" }, undefined, NOW)).toEqual({
      failures: 0,
      retryAt: NOW + 5 * MIN,
      providerAsked: false,
    })
    expect(backoffAfter({ kind: "unreachable" }, prev(3), NOW)).toEqual({
      failures: 3,
      retryAt: NOW + 5 * MIN,
      providerAsked: false,
    })
  })

  it("refused counts a failure and backs off exponentially", () => {
    expect(backoffAfter({ kind: "refused" }, undefined, NOW)).toEqual({
      failures: 1,
      retryAt: NOW + 5 * MIN,
      providerAsked: false,
    })
    expect(backoffAfter({ kind: "refused" }, prev(1), NOW)).toEqual({
      failures: 2,
      retryAt: NOW + 10 * MIN,
      providerAsked: false,
    })
    expect(backoffAfter({ kind: "refused" }, prev(9), NOW)).toEqual({
      failures: 10,
      retryAt: NOW + 60 * MIN,
      providerAsked: false,
    })
  })

  it("rateLimited waits for the provider's Retry-After and flags it as asked", () => {
    expect(backoffAfter({ kind: "rateLimited", retryAfterSeconds: 90 }, undefined, NOW)).toEqual({
      failures: 1,
      retryAt: NOW + 90_000,
      providerAsked: true,
    })
  })

  it("rateLimited caps Retry-After at 1 hour", () => {
    expect(backoffAfter({ kind: "rateLimited", retryAfterSeconds: 86_400 }, undefined, NOW).retryAt).toBe(
      NOW + 60 * MIN
    )
  })

  it("rateLimited without a usable Retry-After falls back to the exponential delay", () => {
    for (const retryAfterSeconds of [undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(backoffAfter({ kind: "rateLimited", retryAfterSeconds }, prev(2), NOW)).toEqual({
        failures: 3,
        retryAt: NOW + 20 * MIN,
        providerAsked: true,
      })
    }
  })

  it("keeps counting failures across kinds", () => {
    const first = backoffAfter({ kind: "refused" }, undefined, NOW)
    const second = backoffAfter({ kind: "rateLimited" }, first, NOW)
    expect(second.failures).toBe(2)
    expect(second.retryAt).toBe(NOW + 10 * MIN)
  })
})

describe("backoffHolds", () => {
  const backoff = (providerAsked: boolean): RefreshBackoff => ({
    failures: 1,
    retryAt: NOW + MIN,
    providerAsked,
  })

  it("holds an automatic refresh until retryAt", () => {
    expect(backoffHolds(backoff(false), NOW, false)).toBe(true)
    expect(backoffHolds(backoff(true), NOW, false)).toBe(true)
    expect(backoffHolds(backoff(false), NOW + MIN, false)).toBe(false)
  })

  it("lets a forced refresh through unless the provider asked to wait", () => {
    expect(backoffHolds(backoff(false), NOW, true)).toBe(false)
    expect(backoffHolds(backoff(true), NOW, true)).toBe(true)
  })

  it("releases a provider-requested backoff once it ends, even when forced", () => {
    expect(backoffHolds(backoff(true), NOW + MIN, true)).toBe(false)
    expect(backoffHolds(backoff(true), NOW + MIN + 1, false)).toBe(false)
  })
})

describe("isFresh", () => {
  it("is fresh for a read under 5 minutes old", () => {
    expect(isFresh(NOW, NOW)).toBe(true)
    expect(isFresh(NOW - 5 * MIN + 1, NOW)).toBe(true)
  })

  it("is stale at 5 minutes, with no read, or when the clock went backwards", () => {
    expect(isFresh(NOW - 5 * MIN, NOW)).toBe(false)
    expect(isFresh(null, NOW)).toBe(false)
    expect(isFresh(undefined, NOW)).toBe(false)
    expect(isFresh(NOW + 1, NOW)).toBe(false)
  })
})

describe("decideRefresh", () => {
  const base = { now: NOW, force: false, lastSuccessAt: null, backoff: null, inFlight: false }
  const held = (providerAsked: boolean): RefreshBackoff => ({
    failures: 1,
    retryAt: NOW + MIN,
    providerAsked,
  })

  it("probes a provider with nothing in the way", () => {
    expect(decideRefresh(base)).toBe("probe")
    expect(decideRefresh({ ...base, lastSuccessAt: NOW - 5 * MIN })).toBe("probe")
  })

  it("skips a fresh provider on an automatic pass (cache hit)", () => {
    expect(decideRefresh({ ...base, lastSuccessAt: NOW - MIN })).toBe("cache-hit")
  })

  it("skips a provider held by a backoff on an automatic pass", () => {
    expect(decideRefresh({ ...base, backoff: held(false) })).toBe("backoff")
    expect(decideRefresh({ ...base, backoff: held(true) })).toBe("backoff")
  })

  it("skips a provider already in flight", () => {
    expect(decideRefresh({ ...base, inFlight: true })).toBe("in-flight")
    expect(decideRefresh({ ...base, force: true, inFlight: true })).toBe("in-flight")
  })

  it("checks cache, then backoff, then in-flight", () => {
    expect(
      decideRefresh({ ...base, lastSuccessAt: NOW - MIN, backoff: held(false), inFlight: true })
    ).toBe("cache-hit")
    expect(decideRefresh({ ...base, backoff: held(false), inFlight: true })).toBe("backoff")
  })

  it("forced ignores the cache age", () => {
    expect(decideRefresh({ ...base, force: true, lastSuccessAt: NOW - 1000 })).toBe("probe")
  })

  it("forced ignores a backoff the provider did not ask for", () => {
    expect(decideRefresh({ ...base, force: true, backoff: held(false) })).toBe("probe")
  })

  it("forced still waits for a backoff the provider asked for", () => {
    expect(decideRefresh({ ...base, force: true, backoff: held(true) })).toBe("backoff")
  })

  it("forced probes once a provider-requested backoff has ended", () => {
    const ended: RefreshBackoff = { failures: 1, retryAt: NOW - 1, providerAsked: true }
    expect(decideRefresh({ ...base, force: true, backoff: ended })).toBe("probe")
  })
})

describe("selectProvidersToProbe", () => {
  it("keeps only the providers that should be probed", () => {
    const source = {
      lastSuccessAt: (id: string) => (id === "fresh" ? NOW - MIN : null),
      backoff: (id: string): RefreshBackoff | undefined =>
        id === "held" ? { failures: 1, retryAt: NOW + MIN, providerAsked: false } : undefined,
      inFlight: (id: string) => id === "busy",
    }
    const ids = ["fresh", "held", "busy", "free"]

    expect(selectProvidersToProbe(ids, NOW, false, source)).toEqual(["free"])
    expect(selectProvidersToProbe(ids, NOW, true, source)).toEqual(["fresh", "held", "free"])
  })
})

describe("rateLimitNotice", () => {
  it("names the provider and the retry time", () => {
    const retryAt = new Date(2026, 0, 2, 15, 45).getTime()
    const notice = rateLimitNotice("Claude", retryAt)
    expect(notice.startsWith("Claude asked OpenUsage to wait. Retrying at ")).toBe(true)
    expect(notice.endsWith(".")).toBe(true)
    expect(notice).toContain("45")
  })
})

describe("persisted backoffs", () => {
  it("keeps the fields of a stored backoff and drops expired and malformed entries", () => {
    const stored = {
      active: { failures: 2, retryAt: NOW + MIN, providerAsked: true, message: "wait" },
      expired: { failures: 1, retryAt: NOW - 1, providerAsked: true },
      exactlyNow: { failures: 1, retryAt: NOW, providerAsked: false },
      noRetryAt: { failures: 1, providerAsked: true },
      notAnObject: "nope",
      nullEntry: null,
    }

    expect(parseStoredBackoffs(stored, NOW)).toEqual({
      active: { failures: 2, retryAt: NOW + MIN, providerAsked: true, message: "wait" },
    })
  })

  it("treats a missing or malformed store value as no backoffs", () => {
    expect(parseStoredBackoffs(undefined, NOW)).toEqual({})
    expect(parseStoredBackoffs(null, NOW)).toEqual({})
    expect(parseStoredBackoffs([], NOW)).toEqual({})
    expect(parseStoredBackoffs("x", NOW)).toEqual({})
  })

  it("activeBackoffs keeps only entries that still hold", () => {
    const backoffs = {
      a: { failures: 1, retryAt: NOW + 1, providerAsked: false },
      b: { failures: 1, retryAt: NOW, providerAsked: false },
    }
    expect(Object.keys(activeBackoffs(backoffs, NOW))).toEqual(["a"])
  })
})
