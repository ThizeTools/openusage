import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AccountRow } from "@/components/accounts/account-row"
import type { Account } from "@/lib/accounts"

const state = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  windows: true,
  mac: false,
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: state.invokeMock,
  isTauri: () => true,
}))

vi.mock("@/lib/platform", () => ({
  isWindowsPlatform: () => state.windows,
  isMacPlatform: () => state.mac,
}))

const claudeAccount: Account = {
  id: "1a2b3c4d",
  provider: "claude",
  label: "me@work.test",
  customLabel: false,
  createdAt: "2026-01-01T00:00:00Z",
}

const OPEN_BUTTON = "Open me@work.test in Claude Desktop"

describe("AccountRow Claude Desktop button", () => {
  beforeEach(() => {
    state.windows = true
    state.mac = false
    state.invokeMock.mockReset().mockResolvedValue(undefined)
  })

  it("opens the Claude account in Claude Desktop", async () => {
    render(<AccountRow account={claudeAccount} />)
    await userEvent.click(screen.getByRole("button", { name: OPEN_BUTTON }))
    expect(state.invokeMock).toHaveBeenCalledWith("open_claude_desktop", { accountId: "1a2b3c4d" })
  })

  it("shows the error when Claude Desktop cannot open", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    state.invokeMock.mockRejectedValue("Claude Desktop is not installed")
    render(<AccountRow account={claudeAccount} />)
    await userEvent.click(screen.getByRole("button", { name: OPEN_BUTTON }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Claude Desktop is not installed")
  })

  it("has no Claude Desktop button for other providers", () => {
    render(<AccountRow account={{ ...claudeAccount, provider: "copilot" }} />)
    expect(screen.queryByRole("button", { name: /in Claude Desktop/ })).toBeNull()
  })

  it("has no Claude Desktop button outside Windows and macOS", () => {
    state.windows = false
    render(<AccountRow account={claudeAccount} />)
    expect(screen.queryByRole("button", { name: /in Claude Desktop/ })).toBeNull()
  })

  it("opens the Claude account in Claude Desktop on macOS", async () => {
    state.windows = false
    state.mac = true
    render(<AccountRow account={claudeAccount} />)
    await userEvent.click(screen.getByRole("button", { name: OPEN_BUTTON }))
    expect(state.invokeMock).toHaveBeenCalledWith("open_claude_desktop", { accountId: "1a2b3c4d" })
  })
})
