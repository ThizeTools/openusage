import { describe, expect, it, vi } from "vitest"

const renderMock = vi.fn()
const createRootMock = vi.fn(() => ({ render: renderMock }))

vi.mock("react-dom/client", () => ({
  default: {
    createRoot: createRootMock,
  },
}))

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}))

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(async () => undefined),
  warn: vi.fn(async () => undefined),
}))

vi.mock("@/App", () => ({
  App: () => <div>App</div>,
}))

describe("main", () => {
  it("mounts app", async () => {
    document.body.innerHTML = '<div id="root"></div>'
    await import("@/main")
    expect(createRootMock).toHaveBeenCalled()
    expect(renderMock).toHaveBeenCalled()
  })
})
