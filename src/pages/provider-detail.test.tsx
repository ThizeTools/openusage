import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ProviderDetailPage } from "@/pages/provider-detail"

const state = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  windows: true,
  mac: false,
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: state.invokeMock,
  isTauri: () => true,
}))

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  isWindowsPlatform: () => state.windows,
  isMacPlatform: () => state.mac,
}))

function claudePlugin(id: string) {
  return {
    meta: { id, name: "Claude · me@work.test", iconUrl: "", lines: [], primaryCandidates: [] },
    data: null,
    loading: false,
    error: null,
    lastManualRefreshAt: null,
    lastUpdatedAt: null,
  }
}

describe("ProviderDetailPage", () => {
  it("shows not found when plugin missing", () => {
    render(<ProviderDetailPage plugin={null} displayMode="used" resetTimerDisplayMode="relative" />)
    expect(screen.getByText("Provider not found")).toBeInTheDocument()
  })

  it("renders ProviderCard with all scope when plugin present", async () => {
    render(
      <ProviderDetailPage
        displayMode="used"
        resetTimerDisplayMode="relative"
        plugin={{
          meta: { id: "a", name: "Alpha", iconUrl: "", lines: [] },
          data: { providerId: "a", displayName: "Alpha", iconUrl: "", lines: [] },
          loading: false,
          error: null,
          lastManualRefreshAt: null,
          lastUpdatedAt: null,
        }}
      />
    )
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0)
  })

  it("renders when plugin data is null (still shows provider name)", () => {
    render(
      <ProviderDetailPage
        displayMode="used"
        resetTimerDisplayMode="relative"
        plugin={{
          meta: { id: "a", name: "Alpha", iconUrl: "", lines: [] },
          data: null,
          loading: false,
          error: null,
          lastManualRefreshAt: null,
          lastUpdatedAt: null,
        }}
      />
    )
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0)
  })

  it("renders quick links when provided by plugin meta", () => {
    render(
      <ProviderDetailPage
        displayMode="used"
        resetTimerDisplayMode="relative"
        plugin={{
          meta: {
            id: "a",
            name: "Alpha",
            iconUrl: "",
            lines: [],
            links: [{ label: "Status", url: "https://status.example.com" }],
          },
          data: null,
          loading: false,
          error: null,
          lastManualRefreshAt: null,
          lastUpdatedAt: null,
        }}
      />
    )
    expect(screen.getByRole("button", { name: /status/i })).toBeInTheDocument()
  })
})

describe("ProviderDetailPage Claude Desktop button", () => {
  beforeEach(() => {
    state.windows = true
    state.mac = false
    state.invokeMock.mockReset().mockResolvedValue(undefined)
  })

  it("opens a Claude account in Claude Desktop", async () => {
    render(<ProviderDetailPage resetTimerDisplayMode="relative" plugin={claudePlugin("claude@1a2b3c4d")} />)
    await userEvent.click(screen.getByRole("button", { name: /Claude Desktop/ }))
    expect(state.invokeMock).toHaveBeenCalledWith("open_claude_desktop", { accountId: "1a2b3c4d" })
  })

  it("shows the error when Claude Desktop cannot open", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    state.invokeMock.mockRejectedValue("Claude Desktop is not installed")
    render(<ProviderDetailPage resetTimerDisplayMode="relative" plugin={claudePlugin("claude@1a2b3c4d")} />)
    await userEvent.click(screen.getByRole("button", { name: /Claude Desktop/ }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Claude Desktop is not installed")
  })

  it("has no Claude Desktop button for other providers", () => {
    render(<ProviderDetailPage resetTimerDisplayMode="relative" plugin={claudePlugin("copilot@1a2b3c4d")} />)
    expect(screen.queryByRole("button", { name: /Claude Desktop/ })).toBeNull()
  })

  it("has no Claude Desktop button outside Windows and macOS", () => {
    state.windows = false
    render(<ProviderDetailPage resetTimerDisplayMode="relative" plugin={claudePlugin("claude@1a2b3c4d")} />)
    expect(screen.queryByRole("button", { name: /Claude Desktop/ })).toBeNull()
  })

  it("opens a Claude account in Claude Desktop on macOS", async () => {
    state.windows = false
    state.mac = true
    render(<ProviderDetailPage resetTimerDisplayMode="relative" plugin={claudePlugin("claude@1a2b3c4d")} />)
    await userEvent.click(screen.getByRole("button", { name: /Claude Desktop/ }))
    expect(state.invokeMock).toHaveBeenCalledWith("open_claude_desktop", { accountId: "1a2b3c4d" })
  })
})
