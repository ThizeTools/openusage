import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  stored: "off",
  loadMock: vi.fn(),
  saveMock: vi.fn(),
  pngMock: vi.fn(),
}))

vi.mock("@/lib/settings", async () => ({
  ...(await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings")),
  loadDockOverlayStyle: state.loadMock,
  saveDockOverlayStyle: state.saveMock,
}))
vi.mock("@/lib/dock-overlay-image", () => ({ renderDockOverlayPng: state.pngMock }))

import { DockOverlaySection } from "@/components/widget-tab/dock-overlay-section"
import { makeWidgetTabModel } from "@/test/widget-tab-model"

beforeEach(() => {
  state.loadMock.mockReset()
  state.loadMock.mockImplementation(async () => state.stored)
  state.saveMock.mockReset()
  state.saveMock.mockResolvedValue(undefined)
  state.pngMock.mockReset()
  state.pngMock.mockResolvedValue("AAAA")
  state.stored = "off"
})
afterEach(() => cleanup())

const group = () => screen.getByRole("radiogroup", { name: "Dock overlay style" })

const extraMeta = (id: string, name: string) => ({
  id,
  name,
  iconUrl: `${id}.svg`,
  lines: [{ type: "progress" as const, label: "Weekly", scope: "overview" as const }],
  primaryCandidates: ["Weekly"],
})

/** Claude and Codex have a Dock app; "windsurf" (Devin) and "other" (Other) have none. */
const model = (overrides = {}) =>
  makeWidgetTabModel({
    plugins: [
      { id: "claude", name: "Claude", enabled: true },
      { id: "codex", name: "ChatGPT", enabled: true },
      { id: "windsurf", name: "Devin", enabled: true },
    ],
    pluginsMeta: [...makeWidgetTabModel().pluginsMeta, extraMeta("windsurf", "Devin"), extraMeta("other", "Other")],
    ...overrides,
  })

describe("DockOverlaySection", () => {
  it("selects the Values card by default, before and after the stored style loads", async () => {
    state.stored = "pill"
    render(<DockOverlaySection model={model()} />)
    expect(screen.getByRole("radio", { name: "Values" })).toHaveAttribute("aria-checked", "true")
    await waitFor(() => expect(state.loadMock).toHaveBeenCalled())
    expect(screen.getByRole("radio", { name: "Values" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "false")
  })

  it("has only the Off and Values cards, no ring switch, and saves the choice", async () => {
    state.stored = "off"
    render(<DockOverlaySection model={model()} />)
    await waitFor(() => expect(screen.getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true"))
    expect(group().querySelectorAll('[role="radio"]')).toHaveLength(2)
    expect(screen.queryByRole("switch", { name: "Progress ring around the icon" })).toBeNull()
    await userEvent.click(screen.getByRole("radio", { name: "Values" }))
    expect(state.saveMock).toHaveBeenCalledWith("pill")
    expect(screen.getByRole("radio", { name: "Values" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "false")
    await userEvent.click(screen.getByRole("radio", { name: "Off" }))
    expect(state.saveMock).toHaveBeenLastCalledWith("off")
  })

  it("does not save again when the selected card is clicked", async () => {
    state.stored = "pill"
    render(<DockOverlaySection model={model()} />)
    await waitFor(() => expect(state.loadMock).toHaveBeenCalled())
    await userEvent.click(screen.getByRole("radio", { name: "Values" }))
    expect(state.saveMock).not.toHaveBeenCalled()
  })

  it("renders the preview without a style argument", async () => {
    state.stored = "pill"
    render(<DockOverlaySection model={model()} />)
    await waitFor(() => expect(state.pngMock).toHaveBeenCalledTimes(2))
    expect(state.pngMock.mock.calls[0][1]).toMatchObject({ colors: {} })
    expect(state.pngMock.mock.calls[0]).toHaveLength(2)
  })

  it("draws one tile per provider of the model, without overlay while Off", async () => {
    const { container } = render(<DockOverlaySection model={model()} />)
    for (const id of ["claude", "codex", "windsurf"]) expect(screen.getByTestId(`dock-tile-${id}`)).toBeInTheDocument()
    state.stored = "off"
    await waitFor(() => expect(screen.getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true"))
    await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(0))
  })

  it("follows the selected providers", () => {
    render(<DockOverlaySection model={model({ providerIds: ["codex"] })} />)
    expect(screen.getByTestId("dock-tile-codex")).toBeInTheDocument()
    expect(screen.queryByTestId("dock-tile-claude")).toBeNull()
    expect(screen.queryByText(/no Dock app/)).toBeNull()
  })

  it("overlays the PNG on tiles with a Dock app, dims the others and names them", async () => {
    state.stored = "pill"
    const { container } = render(<DockOverlaySection model={model()} />)
    await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(2))
    expect(state.pngMock).toHaveBeenCalledTimes(2)
    const [provider, opts] = state.pngMock.mock.calls[0]
    expect(provider.id).toBe("claude")
    expect(provider.items.map((item: { label: string; tone: string; fraction: number }) => [item.label, item.tone, item.fraction])).toEqual([
      ["Session", "ahead", 0.13],
      ["Weekly", "behind", 0.94],
    ])
    expect(opts).toMatchObject({ colors: {}, toneModes: { ahead: "mono", onTrack: "color", behind: "color" } })
    expect(opts.textColors).toBeDefined()
    expect(screen.getByTestId("dock-tile-windsurf")).toHaveClass("opacity-35")
    expect(screen.getByTestId("dock-tile-windsurf").querySelector("img")).toBeNull()
    expect(screen.getByTestId("dock-tile-claude")).not.toHaveClass("opacity-35")
    expect(screen.getByText("Devin has no Dock app.")).toBeInTheDocument()
  })

  it("names several providers without a Dock app", () => {
    render(
      <DockOverlaySection
        model={model({
          plugins: [
            { id: "windsurf", name: "Devin", enabled: true },
            { id: "other", name: "Other", enabled: true },
          ],
        })}
      />
    )
    expect(screen.getByText("Devin and Other have no Dock app.")).toBeInTheDocument()
  })

  it("re-renders when the colors change", async () => {
    state.stored = "pill"
    const { rerender } = render(<DockOverlaySection model={model()} />)
    await waitFor(() => expect(state.pngMock).toHaveBeenCalledTimes(2))
    rerender(<DockOverlaySection model={model({ colors: { behind: "#112233" } })} />)
    await waitFor(() => expect(state.pngMock).toHaveBeenCalledTimes(4))
    expect(state.pngMock.mock.calls[3][1].colors).toEqual({ behind: "#112233" })
  })

  it("copes with a renderer that returns null", async () => {
    state.stored = "pill"
    state.pngMock.mockResolvedValue(null)
    const { container } = render(<DockOverlaySection model={model()} />)
    await waitFor(() => expect(state.pngMock).toHaveBeenCalledTimes(2))
    expect(container.querySelectorAll("img")).toHaveLength(0)
  })
})
