import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  stored: "off",
  loadMock: vi.fn(),
  saveMock: vi.fn(),
  loadLabelMock: vi.fn(),
  saveLabelMock: vi.fn(),
  pngMock: vi.fn(),
}))

vi.mock("@/lib/settings", async () => ({
  ...(await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings")),
  loadDockOverlayStyle: state.loadMock,
  saveDockOverlayStyle: state.saveMock,
  loadDockOverlayAccountLabel: state.loadLabelMock,
  saveDockOverlayAccountLabel: state.saveLabelMock,
}))
vi.mock("@/lib/dock-overlay-image", () => ({ renderDockOverlayPng: state.pngMock }))

import { DockOverlaySection } from "@/components/widget-tab/dock-overlay-section"
import { makeWidgetTabModel } from "@/test/widget-tab-model"

beforeEach(() => {
  state.loadMock.mockReset()
  state.loadMock.mockImplementation(async () => state.stored)
  state.saveMock.mockReset()
  state.saveMock.mockResolvedValue(undefined)
  state.loadLabelMock.mockReset()
  state.loadLabelMock.mockResolvedValue("initial")
  state.saveLabelMock.mockReset()
  state.saveLabelMock.mockResolvedValue(undefined)
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
    expect(within(group()).getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "false")
  })

  it("has only the Off and Values cards, no ring switch, and saves the choice", async () => {
    state.stored = "off"
    render(<DockOverlaySection model={model()} />)
    await waitFor(() => expect(within(group()).getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true"))
    expect(group().querySelectorAll('[role="radio"]')).toHaveLength(2)
    expect(screen.queryByRole("switch", { name: "Progress ring around the icon" })).toBeNull()
    await userEvent.click(screen.getByRole("radio", { name: "Values" }))
    expect(state.saveMock).toHaveBeenCalledWith("pill")
    expect(screen.getByRole("radio", { name: "Values" })).toHaveAttribute("aria-checked", "true")
    expect(within(group()).getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "false")
    await userEvent.click(within(group()).getByRole("radio", { name: "Off" }))
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

  it("offers the account name styles with Initial selected by default and saves the choice", async () => {
    state.stored = "pill"
    render(<DockOverlaySection model={model()} />)
    const names = screen.getByRole("radiogroup", { name: "Dock account name" })
    expect(names.querySelectorAll('[role="radio"]')).toHaveLength(4)
    await waitFor(() => expect(state.loadLabelMock).toHaveBeenCalled())
    expect(screen.getByRole("radio", { name: "Initial" })).toHaveAttribute("aria-checked", "true")
    await userEvent.click(screen.getByRole("radio", { name: "Tag" }))
    expect(state.saveLabelMock).toHaveBeenCalledWith("tag")
    expect(screen.getByRole("radio", { name: "Tag" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: "In pill" })).toHaveAttribute("aria-checked", "false")
    // "Off" is the first card; it exists in the style group too, so scope it to the account group.
    expect(names.querySelector('[role="radio"]')).toHaveAttribute("data-dock-account-label", "off")
    await userEvent.click(within(names).getByRole("radio", { name: "Off" }))
    expect(state.saveLabelMock).toHaveBeenLastCalledWith("off")
  })

  it("hides the account name styles while the style is off", async () => {
    state.stored = "off"
    render(<DockOverlaySection model={model()} />)
    await waitFor(() => expect(screen.getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true"))
    expect(screen.queryByRole("radiogroup", { name: "Dock account name" })).toBeNull()
  })

  it("previews the account name on Claude account tiles when 2+ are registered", async () => {
    state.stored = "pill"
    state.loadLabelMock.mockResolvedValue("tag")
    const accounts = [
      { id: "claude@a", name: "Claude · Work", enabled: true },
      { id: "claude@b", name: "Claude · Home", enabled: true },
    ]
    const base = makeWidgetTabModel()
    render(
      <DockOverlaySection
        model={model({
          plugins: accounts,
          pluginsMeta: [...base.pluginsMeta, ...accounts.map((a) => extraMeta(a.id, a.name))],
        })}
      />
    )
    await waitFor(() =>
      expect(state.pngMock.mock.calls.some(([, opts]) => opts.account?.mode === "tag")).toBe(true)
    )
    const names = state.pngMock.mock.calls.map(([, opts]) => opts.account?.name).filter(Boolean)
    expect(names).toEqual(expect.arrayContaining(["Work", "Home"]))
  })

  it('previews no account name when the account mode is "off"', async () => {
    state.stored = "pill"
    state.loadLabelMock.mockResolvedValue("off")
    const accounts = [
      { id: "claude@a", name: "Claude · Work", enabled: true },
      { id: "claude@b", name: "Claude · Home", enabled: true },
    ]
    const base = makeWidgetTabModel()
    render(
      <DockOverlaySection
        model={model({
          plugins: accounts,
          pluginsMeta: [...base.pluginsMeta, ...accounts.map((a) => extraMeta(a.id, a.name))],
        })}
      />
    )
    await waitFor(() =>
      expect(
        within(screen.getByRole("radiogroup", { name: "Dock account name" })).getByRole("radio", { name: "Off" })
      ).toHaveAttribute("aria-checked", "true")
    )
    // After the stored "off" arrives, the latest renders (one per Dock tile) carry no account.
    await waitFor(() => expect(state.pngMock.mock.calls.length).toBeGreaterThan(0))
    state.pngMock.mockClear()
    const accountGroup = within(screen.getByRole("radiogroup", { name: "Dock account name" }))
    await userEvent.click(accountGroup.getByRole("radio", { name: "Initial" }))
    await waitFor(() => expect(state.pngMock.mock.calls.at(-1)![1].account?.mode).toBe("initial"))
    state.pngMock.mockClear()
    await userEvent.click(accountGroup.getByRole("radio", { name: "Off" }))
    await waitFor(() => expect(state.pngMock).toHaveBeenCalled())
    expect(state.pngMock.mock.calls.every(([, opts]) => opts.account === undefined)).toBe(true)
  })

  it("previews no account name with one Claude account registered", async () => {
    state.stored = "pill"
    state.loadLabelMock.mockResolvedValue("tag")
    const accounts = [{ id: "claude@a", name: "Claude · Work", enabled: true }]
    const base = makeWidgetTabModel()
    render(
      <DockOverlaySection
        model={model({
          plugins: accounts,
          pluginsMeta: [...base.pluginsMeta, ...accounts.map((a) => extraMeta(a.id, a.name))],
        })}
      />
    )
    await waitFor(() => expect(state.pngMock).toHaveBeenCalled())
    expect(state.pngMock.mock.calls.every(([, opts]) => opts.account === undefined)).toBe(true)
  })

  it("copes with a renderer that returns null", async () => {
    state.stored = "pill"
    state.pngMock.mockResolvedValue(null)
    const { container } = render(<DockOverlaySection model={model()} />)
    await waitFor(() => expect(state.pngMock).toHaveBeenCalledTimes(2))
    expect(container.querySelectorAll("img")).toHaveLength(0)
  })
})
