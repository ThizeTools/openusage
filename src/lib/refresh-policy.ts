import type { PluginFailure } from "@/lib/plugin-types"

/**
 * Refresh scheduling, ported from the native OpenUsage app (RefreshSetting, RefreshBackoff and
 * WidgetDataStore.refresh). Pure, so the hooks only hold the state.
 */

/** Fixed gap between automatic refresh passes, and how long a successful read counts as fresh. */
export const REFRESH_INTERVAL_MS = 5 * 60_000

export const FAILURE_BACKOFF_BASE_MS = REFRESH_INTERVAL_MS
export const FAILURE_BACKOFF_CAP_MS = 60 * 60_000

export type RefreshFailure = PluginFailure

export type RefreshBackoff = {
  /** Consecutive failures that count toward the exponential delay. */
  failures: number
  /** Epoch ms before which the provider is not probed again. */
  retryAt: number
  /** True when the provider itself asked to wait (rate limit). A manual refresh respects it. */
  providerAsked: boolean
  /** Text to show under the provider's card while the backoff holds, kept so a relaunch can show it. */
  message?: string
}

export type RefreshBackoffs = Record<string, RefreshBackoff>

/** Backoffs still in force at `now`. */
export function activeBackoffs(backoffs: RefreshBackoffs, now: number): RefreshBackoffs {
  const active: RefreshBackoffs = {}
  for (const [id, backoff] of Object.entries(backoffs)) {
    if (backoff.retryAt > now) active[id] = backoff
  }
  return active
}

/** Reads backoffs from a stored value, dropping malformed and expired entries. */
export function parseStoredBackoffs(value: unknown, now: number): RefreshBackoffs {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
  const parsed: RefreshBackoffs = {}
  for (const [id, raw] of Object.entries(value)) {
    if (typeof raw !== "object" || raw === null) continue
    const { failures, retryAt, providerAsked, message } = raw as Record<string, unknown>
    if (typeof failures !== "number" || !Number.isFinite(failures)) continue
    if (typeof retryAt !== "number" || !Number.isFinite(retryAt)) continue
    parsed[id] = {
      failures,
      retryAt,
      providerAsked: providerAsked === true,
      ...(typeof message === "string" && message ? { message } : {}),
    }
  }
  return activeBackoffs(parsed, now)
}

/** Wait after `failures` consecutive failures: 5 min, doubling per extra failure, capped at 1 h. */
export function backoffDelayMs(failures: number): number {
  const doublings = Math.min(Math.max(failures - 1, 0), 16)
  return Math.min(FAILURE_BACKOFF_BASE_MS * 2 ** doublings, FAILURE_BACKOFF_CAP_MS)
}

/** Provider's Retry-After as ms: positive and finite only, capped at 1 h. */
function retryAfterMs(seconds: number | undefined): number | null {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return null
  return Math.min(seconds * 1000, FAILURE_BACKOFF_CAP_MS)
}

/** The backoff a failure at `now` leaves, given the one it follows (if any). */
export function backoffAfter(
  failure: RefreshFailure,
  previous: RefreshBackoff | null | undefined,
  now: number
): RefreshBackoff {
  const failures = previous?.failures ?? 0
  switch (failure.kind) {
    case "unreachable":
      return { failures, retryAt: now + FAILURE_BACKOFF_BASE_MS, providerAsked: false }
    case "refused":
      return {
        failures: failures + 1,
        retryAt: now + backoffDelayMs(failures + 1),
        providerAsked: false,
      }
    case "rateLimited": {
      const wait = retryAfterMs(failure.retryAfterSeconds) ?? backoffDelayMs(failures + 1)
      return { failures: failures + 1, retryAt: now + wait, providerAsked: true }
    }
  }
}

/** Whether the backoff blocks a probe at `now`. A forced refresh only yields to a provider request. */
export function backoffHolds(backoff: RefreshBackoff, now: number, forced: boolean): boolean {
  return now < backoff.retryAt && (backoff.providerAsked || !forced)
}

/** A read newer than the interval is fresh. A clock that went backwards is not trusted. */
export function isFresh(lastSuccessAt: number | null | undefined, now: number): boolean {
  if (lastSuccessAt == null) return false
  const age = now - lastSuccessAt
  return age >= 0 && age < REFRESH_INTERVAL_MS
}

export type RefreshDecision = "probe" | "cache-hit" | "backoff" | "in-flight"

type RefreshDecisionInput = {
  now: number
  /** Manual refresh: ignores the cache age and any backoff the provider did not ask for. */
  force: boolean
  lastSuccessAt: number | null | undefined
  backoff: RefreshBackoff | null | undefined
  inFlight: boolean
}

/** Whether one provider should be probed now, in the native app's order of checks. */
export function decideRefresh({
  now,
  force,
  lastSuccessAt,
  backoff,
  inFlight,
}: RefreshDecisionInput): RefreshDecision {
  if (!force && isFresh(lastSuccessAt, now)) return "cache-hit"
  if (backoff && backoffHolds(backoff, now, force)) return "backoff"
  if (inFlight) return "in-flight"
  return "probe"
}

export type RefreshSource = {
  lastSuccessAt: (id: string) => number | null | undefined
  backoff: (id: string) => RefreshBackoff | null | undefined
  inFlight: (id: string) => boolean
}

/** The providers among `ids` that a refresh pass at `now` should probe. */
export function selectProvidersToProbe(
  ids: string[],
  now: number,
  force: boolean,
  source: RefreshSource
): string[] {
  return ids.filter(
    (id) =>
      decideRefresh({
        now,
        force,
        lastSuccessAt: source.lastSuccessAt(id),
        backoff: source.backoff(id),
        inFlight: source.inFlight(id),
      }) === "probe"
  )
}

/** Message under a rate-limited provider's card, e.g. "Claude asked OpenUsage to wait. Retrying at 3:45 PM." */
export function rateLimitNotice(displayName: string, retryAt: number): string {
  const time = new Date(retryAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  return `${displayName} asked OpenUsage to wait. Retrying at ${time}.`
}
