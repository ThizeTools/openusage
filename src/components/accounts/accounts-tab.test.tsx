import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AccountsTab } from "@/components/accounts/accounts-tab"
import type { Account, AccountProvider } from "@/lib/accounts"

const state = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  handlers: {} as Record<string, (event: { payload: unknown }) => void>,
  openUrlMock: vi.fn(() => Promise.resolve()),
  accounts: [] as Account[],
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: state.invokeMock,
  isTauri: () => true,
}))

vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, cb: (event: { payload: unknown }) => void) => {
    state.handlers[name] = cb
    return () => {
      delete state.handlers[name]
    }
  },
}))

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: state.openUrlMock,
}))

vi.mock("@/hooks/use-dark-mode", () => ({
  useDarkMode: () => false,
}))

const claude: AccountProvider = {
  id: "claude",
  name: "Claude",
  iconUrl: "claude.svg",
  brandColor: "#D97757",
  kind: "oauth",
  fields: [],
}

const copilot: AccountProvider = {
  id: "copilot",
  name: "Copilot",
  iconUrl: "copilot.svg",
  kind: "device",
  fields: [],
}

const openrouter: AccountProvider = {
  id: "openrouter",
  name: "OpenRouter",
  iconUrl: "openrouter.svg",
  kind: "api-key",
  keyUrl: "https://example.test/keys",
  fields: [],
}

const workAccount: Account = {
  id: "1a2b3c4d",
  provider: "claude",
  label: "work account",
  customLabel: false,
  createdAt: "2026-01-01T00:00:00Z",
}

function mockBackend(overrides: Record<string, (args: any) => Promise<unknown>> = {}) {
  state.invokeMock.mockReset().mockImplementation((command: string, args: any) => {
    if (overrides[command]) return overrides[command](args)
    if (command === "list_accounts") return Promise.resolve(state.accounts)
    if (command === "list_account_providers") return Promise.resolve([claude, copilot, openrouter])
    return Promise.reject(new Error(`Unexpected command: ${command}`))
  })
}

async function waitForHandler(name: string) {
  await waitFor(() => expect(state.handlers[name]).toBeDefined())
}

function emit(name: string, payload: unknown) {
  act(() => {
    state.handlers[name]?.({ payload })
  })
}

describe("AccountsTab", () => {
  beforeEach(() => {
    state.accounts = []
    state.handlers = {}
    state.openUrlMock.mockClear()
    mockBackend()
  })

  it("shows the empty state when there are no accounts", async () => {
    render(<AccountsTab />)
    expect(await screen.findByText("No accounts yet")).toBeInTheDocument()
  })

  it("groups accounts under their provider", async () => {
    state.accounts = [workAccount]
    render(<AccountsTab />)

    expect(await screen.findByText("work account")).toBeInTheDocument()
    expect(screen.queryByText("No accounts yet")).toBeNull()
  })

  it("reloads the account list on accounts:changed", async () => {
    render(<AccountsTab />)
    await screen.findByText("No accounts yet")
    await waitForHandler("accounts:changed")

    state.accounts = [workAccount]
    emit("accounts:changed", undefined)

    expect(await screen.findByText("work account")).toBeInTheDocument()
  })

  it("renames an account inline with Enter", async () => {
    state.accounts = [workAccount]
    render(<AccountsTab />)
    await screen.findByText("work account")

    await userEvent.click(screen.getByRole("button", { name: "Rename work account" }))
    const input = screen.getByLabelText("Account name")
    await userEvent.clear(input)
    await userEvent.type(input, "Work{Enter}")

    await waitFor(() =>
      expect(state.invokeMock).toHaveBeenCalledWith("rename_account", { id: "1a2b3c4d", label: "Work" })
    )
  })

  it("removes an account only after confirmation", async () => {
    state.accounts = [workAccount]
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false)
    render(<AccountsTab />)
    await screen.findByText("work account")

    await userEvent.click(screen.getByRole("button", { name: "Remove work account" }))
    expect(state.invokeMock).not.toHaveBeenCalledWith("remove_account", expect.anything())

    confirmSpy.mockReturnValue(true)
    await userEvent.click(screen.getByRole("button", { name: "Remove work account" }))
    expect(state.invokeMock).toHaveBeenCalledWith("remove_account", { id: "1a2b3c4d" })
    confirmSpy.mockRestore()
  })

  it("adds an API key account and sends the trimmed value", async () => {
    mockBackend({ add_api_key_account: () => Promise.resolve(workAccount) })
    render(<AccountsTab />)
    await screen.findByText("No accounts yet")

    await userEvent.click(screen.getByRole("button", { name: "Add account" }))
    await userEvent.click(screen.getByRole("button", { name: "OpenRouter" }))

    const dialog = screen.getByRole("dialog", { name: "Add OpenRouter account" })
    await userEvent.type(within(dialog).getByLabelText("API key"), "  sk-test-123  ")
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(state.invokeMock).toHaveBeenCalledWith(
        "add_api_key_account",
        expect.objectContaining({ providerId: "openrouter", values: { apiKey: "sk-test-123" } })
      )
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("shows the backend error inline when saving an API key fails", async () => {
    mockBackend({
      add_api_key_account: () => Promise.reject("key rejected by provider"),
    })
    render(<AccountsTab />)
    await screen.findByText("No accounts yet")

    await userEvent.click(screen.getByRole("button", { name: "Add account" }))
    await userEvent.click(screen.getByRole("button", { name: "OpenRouter" }))
    const dialog = screen.getByRole("dialog", { name: "Add OpenRouter account" })
    await userEvent.type(within(dialog).getByLabelText("API key"), "sk-bad")
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }))

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("key rejected by provider")
    expect(screen.getByRole("dialog", { name: "Add OpenRouter account" })).toBeInTheDocument()
  })

  it("oauth sign-in waits for the browser and closes when login finishes", async () => {
    mockBackend({
      start_account_login: () => Promise.resolve({ loginId: "login-1", verificationUrl: "https://example.test/auth" }),
    })
    render(<AccountsTab />)
    await screen.findByText("No accounts yet")
    await waitForHandler("accounts:login-finished")

    await userEvent.click(screen.getByRole("button", { name: "Add account" }))
    await userEvent.click(screen.getByRole("button", { name: "Claude" }))

    const dialog = await screen.findByRole("dialog", { name: "Finish signing in in your browser" })
    expect(state.invokeMock).toHaveBeenCalledWith("start_account_login", { providerId: "claude" })
    expect(within(dialog).queryByText(/Enter this code/)).toBeNull()

    emit("accounts:login-finished", { loginId: "login-1", ok: true, accountId: "1a2b3c4d" })

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("opens the sign-in page again from the oauth dialog", async () => {
    mockBackend({
      start_account_login: () => Promise.resolve({ loginId: "login-1", verificationUrl: "https://example.test/auth" }),
    })
    render(<AccountsTab />)
    await screen.findByText("No accounts yet")

    await userEvent.click(screen.getByRole("button", { name: "Add account" }))
    await userEvent.click(screen.getByRole("button", { name: "Claude" }))
    await userEvent.click(await screen.findByRole("button", { name: "Open sign-in page again" }))

    expect(state.openUrlMock).toHaveBeenCalledWith("https://example.test/auth")
  })

  it("device sign-in shows the user code and copies it", async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    mockBackend({
      start_account_login: () => Promise.resolve({ loginId: "login-2", verificationUrl: "https://example.test/device", userCode: "ABCD-1234" }),
    })
    render(<AccountsTab />)
    await screen.findByText("No accounts yet")

    await userEvent.click(screen.getByRole("button", { name: "Add account" }))
    await userEvent.click(screen.getByRole("button", { name: "Copilot" }))

    const dialog = await screen.findByRole("dialog", { name: "Finish signing in in your browser" })
    expect(within(dialog).getByText("ABCD-1234")).toBeInTheDocument()
    expect(within(dialog).getByText("Enter this code on the page that opened")).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole("button", { name: "Copy" }))
    expect(writeText).toHaveBeenCalledWith("ABCD-1234")
  })

  it("shows a failed start with Try again that starts a new sign-in", async () => {
    let attempt = 0
    mockBackend({
      start_account_login: () => {
        attempt += 1
        if (attempt === 1) return Promise.reject("Timed out waiting for the browser")
        return Promise.resolve({ loginId: "login-3" })
      },
    })
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    render(<AccountsTab />)
    await screen.findByText("No accounts yet")

    await userEvent.click(screen.getByRole("button", { name: "Add account" }))
    await userEvent.click(screen.getByRole("button", { name: "Claude" }))

    const dialog = await screen.findByRole("dialog", { name: "Sign in to Claude" })
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Timed out waiting for the browser")

    await userEvent.click(within(dialog).getByRole("button", { name: "Try again" }))
    await screen.findByRole("dialog", { name: "Finish signing in in your browser" })
    expect(attempt).toBe(2)
    errorSpy.mockRestore()
  })

  it("cancel stops the sign-in and closes the dialog", async () => {
    mockBackend({
      start_account_login: () => Promise.resolve({ loginId: "login-4", verificationUrl: "https://example.test/auth" }),
      cancel_account_login: () => Promise.resolve(undefined),
    })
    render(<AccountsTab />)
    await screen.findByText("No accounts yet")

    await userEvent.click(screen.getByRole("button", { name: "Add account" }))
    await userEvent.click(screen.getByRole("button", { name: "Claude" }))
    const dialog = await screen.findByRole("dialog", { name: "Finish signing in in your browser" })

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))

    expect(state.invokeMock).toHaveBeenCalledWith("cancel_account_login", { loginId: "login-4" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("keeps a failed sign-in visible when the backend reports an error", async () => {
    mockBackend({
      start_account_login: () => Promise.resolve({ loginId: "login-5" }),
    })
    render(<AccountsTab />)
    await screen.findByText("No accounts yet")
    await waitForHandler("accounts:login-finished")

    await userEvent.click(screen.getByRole("button", { name: "Add account" }))
    await userEvent.click(screen.getByRole("button", { name: "Claude" }))
    await screen.findByRole("dialog", { name: "Finish signing in in your browser" })

    emit("accounts:login-finished", { loginId: "login-5", ok: false, error: "access denied" })

    const dialog = await screen.findByRole("dialog", { name: "Sign in to Claude" })
    expect(within(dialog).getByRole("alert")).toHaveTextContent("access denied")
  })
})
