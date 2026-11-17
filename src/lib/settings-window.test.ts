import { beforeEach, describe, expect, it, vi } from "vitest"
import { invoke } from "@tauri-apps/api/core"
import { emit } from "@tauri-apps/api/event"
import { openSettingsTab } from "@/lib/settings-window"

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}))

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
}))

describe("openSettingsTab", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockResolvedValue(undefined)
    vi.mocked(emit).mockReset().mockResolvedValue(undefined)
  })

  it("shows the settings window before asking it to switch tabs", async () => {
    await openSettingsTab("accounts")

    expect(invoke).toHaveBeenCalledWith("open_settings_window")
    expect(emit).toHaveBeenCalledWith("settings:open-tab", { tab: "accounts" })
    expect(vi.mocked(invoke).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(emit).mock.invocationCallOrder[0]
    )
  })

  it("does not emit the tab change when the window cannot be opened", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("window missing"))

    await expect(openSettingsTab("accounts")).rejects.toThrow("window missing")
    expect(emit).not.toHaveBeenCalled()
  })
})
