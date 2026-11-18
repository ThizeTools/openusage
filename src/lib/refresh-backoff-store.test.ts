import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
  saved: 0,
}))

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    async get(key: string) {
      return state.values[key]
    }
    async set(key: string, value: unknown) {
      state.values[key] = value
    }
    async save() {
      state.saved += 1
    }
  },
}))

import { loadRefreshBackoffs, saveRefreshBackoffs } from "@/lib/refresh-backoff-store"

const NOW = 1_700_000_000_000

describe("refresh backoff store", () => {
  beforeEach(() => {
    state.values = {}
    state.saved = 0
  })

  it("saves only the backoffs still in force under refreshBackoffs and persists the store", async () => {
    await saveRefreshBackoffs(
      {
        claude: { failures: 1, retryAt: NOW + 60_000, providerAsked: true, message: "wait" },
        codex: { failures: 1, retryAt: NOW - 1, providerAsked: false },
      },
      NOW
    )

    expect(state.values.refreshBackoffs).toEqual({
      claude: { failures: 1, retryAt: NOW + 60_000, providerAsked: true, message: "wait" },
    })
    expect(state.saved).toBe(1)
  })

  it("restores saved backoffs and drops the expired ones on load", async () => {
    state.values.refreshBackoffs = {
      claude: { failures: 2, retryAt: NOW + 60_000, providerAsked: true, message: "wait" },
      codex: { failures: 1, retryAt: NOW - 1, providerAsked: false },
    }

    expect(await loadRefreshBackoffs(NOW)).toEqual({
      claude: { failures: 2, retryAt: NOW + 60_000, providerAsked: true, message: "wait" },
    })
  })

  it("loads nothing when the key was never written", async () => {
    expect(await loadRefreshBackoffs(NOW)).toEqual({})
  })
})
