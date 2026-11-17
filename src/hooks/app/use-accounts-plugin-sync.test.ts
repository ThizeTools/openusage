import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useAccountsPluginSync } from "@/hooks/app/use-accounts-plugin-sync"
import { useAppPluginStore } from "@/stores/app-plugin-store"
import type { PluginMeta } from "@/lib/plugin-types"

const state = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  handlers: {} as Record<string, () => void>,
  storeValues: {} as Record<string, unknown>,
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: state.invokeMock,
  isTauri: () => true,
}))

vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, cb: () => void) => {
    state.handlers[name] = cb
    return () => {
      delete state.handlers[name]
    }
  },
}))

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    async get(key: string) {
      return state.storeValues[key]
    }
    async set() {}
    async save() {}
    async onKeyChange() {
      return () => {}
    }
  },
}))

const claude: PluginMeta = {
  id: "claude",
  name: "Claude",
  iconUrl: "claude.svg",
  lines: [],
  primaryCandidates: [],
}

const claudeWork: PluginMeta = {
  id: "claude@1a2b3c4d",
  name: "Claude · work",
  iconUrl: "claude.svg",
  lines: [],
  primaryCandidates: [],
}

function renderSync(startBatch = vi.fn(() => Promise.resolve(undefined))) {
  const setLoadingForPlugins = vi.fn()
  const setErrorForPlugins = vi.fn()
  const scheduleTrayIconUpdate = vi.fn()
  renderHook(() =>
    useAccountsPluginSync({
      startBatch,
      setLoadingForPlugins,
      setErrorForPlugins,
      scheduleTrayIconUpdate,
    })
  )
  return { startBatch, setLoadingForPlugins, setErrorForPlugins, scheduleTrayIconUpdate }
}

async function emitAccountsChanged() {
  await waitFor(() => expect(state.handlers["accounts:changed"]).toBeDefined())
  act(() => {
    state.handlers["accounts:changed"]?.()
  })
}

describe("useAccountsPluginSync", () => {
  beforeEach(() => {
    state.handlers = {}
    state.storeValues = { plugins: { order: ["claude"], disabled: [] } }
    state.invokeMock.mockReset().mockImplementation((command: string) => {
      if (command === "list_plugins") return Promise.resolve([claude, claudeWork])
      return Promise.reject(new Error(`Unexpected command: ${command}`))
    })
    useAppPluginStore.setState({
      pluginsMeta: [claude],
      pluginSettings: { order: ["claude"], disabled: [] },
    })
  })

  it("reloads the plugin list and enables the new account instance", async () => {
    const { startBatch, setLoadingForPlugins, scheduleTrayIconUpdate } = renderSync()

    await emitAccountsChanged()

    await waitFor(() => expect(startBatch).toHaveBeenCalledWith(["claude@1a2b3c4d"]))
    expect(state.invokeMock).toHaveBeenCalledWith("list_plugins")
    expect(setLoadingForPlugins).toHaveBeenCalledWith(["claude@1a2b3c4d"])
    expect(scheduleTrayIconUpdate).toHaveBeenCalledWith("settings", 0)

    const store = useAppPluginStore.getState()
    expect(store.pluginsMeta.map((plugin) => plugin.id)).toEqual(["claude", "claude@1a2b3c4d"])
    expect(store.pluginSettings).toEqual({
      order: ["claude", "claude@1a2b3c4d"],
      disabled: [],
    })
  })

  it("does not probe again when no plugin id appeared", async () => {
    state.invokeMock.mockReset().mockImplementation((command: string) => {
      if (command === "list_plugins") return Promise.resolve([claude])
      return Promise.reject(new Error(`Unexpected command: ${command}`))
    })
    const { startBatch, setLoadingForPlugins, scheduleTrayIconUpdate } = renderSync()

    await emitAccountsChanged()

    // scheduleTrayIconUpdate runs right after the reload, so it marks the end of the flow.
    await waitFor(() => expect(scheduleTrayIconUpdate).toHaveBeenCalledWith("settings", 0))
    expect(startBatch).not.toHaveBeenCalled()
    expect(setLoadingForPlugins).not.toHaveBeenCalled()
  })

  it("reports a failed probe for the new ids without throwing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const startBatch = vi.fn(() => Promise.reject(new Error("probe down")))
    const { setErrorForPlugins } = renderSync(startBatch)

    await emitAccountsChanged()

    await waitFor(() =>
      expect(setErrorForPlugins).toHaveBeenCalledWith(["claude@1a2b3c4d"], "Failed to start probe")
    )
    expect(consoleError).toHaveBeenCalledWith("Failed to probe newly added accounts:", expect.any(Error))
    consoleError.mockRestore()
  })
})
