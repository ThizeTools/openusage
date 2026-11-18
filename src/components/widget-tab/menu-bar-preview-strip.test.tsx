import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MenuBarPreviewStrip } from "@/components/widget-tab/menu-bar-preview-strip"
import { makeWidgetTabModel } from "@/test/widget-tab-model"
import { renderMenuBarWidgetPng } from "@/lib/menubar-widget-image"

vi.mock("@/lib/menubar-widget-image", async () => ({
  ...(await vi.importActual<typeof import("@/lib/menubar-widget-image")>("@/lib/menubar-widget-image")),
  renderMenuBarWidgetPng: vi.fn(async () => "AAAA"),
}))

vi.mock("@/lib/icon-mask", () => ({
  getIconMask: vi.fn(async () => null),
}))

afterEach(() => cleanup())

describe("MenuBarPreviewStrip", () => {
  it("shows a fake menu bar around the real widget render at scale 3, 22px tall", async () => {
    render(<MenuBarPreviewStrip model={makeWidgetTabModel({ style: "stacked" })} />)
    for (const text of ["Finder", "File", "Edit", "View", "Tue 9:41"]) expect(screen.getByText(text)).toBeInTheDocument()
    const widget = screen.getByTestId("menu-bar-preview-widget")
    await waitFor(() => expect(widget.querySelector("img")).toHaveAttribute("src", "data:image/png;base64,AAAA"))
    expect(widget.querySelector("img")).toHaveStyle({ height: "22px" })
    expect(vi.mocked(renderMenuBarWidgetPng)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ style: "stacked", scale: 3, dark: false })
    )
  })

  it("renders the selected providers and metrics", async () => {
    vi.mocked(renderMenuBarWidgetPng).mockClear()
    const model = makeWidgetTabModel({ providerIds: ["codex"], providerMetrics: { codex: ["Weekly"] } })
    render(<MenuBarPreviewStrip model={model} />)
    await waitFor(() => expect(vi.mocked(renderMenuBarWidgetPng)).toHaveBeenCalled())
    const payload = vi.mocked(renderMenuBarWidgetPng).mock.calls.at(-1)![0]
    expect(payload.providers.map((provider) => provider.id)).toEqual(["codex"])
    expect(payload.providers[0].items.map((item) => item.label)).toEqual(["Weekly"])
  })

  it("zoom scales the bar and the widget", async () => {
    render(<MenuBarPreviewStrip model={makeWidgetTabModel()} zoom={2} />)
    const widget = screen.getByTestId("menu-bar-preview-widget")
    await waitFor(() => expect(widget.querySelector("img")).toHaveStyle({ height: "44px" }))
    expect(screen.getByTestId("menu-bar-preview-strip")).toHaveStyle({ height: "112px" })
  })

  it("shows the optional caption and dims the widget while it is hidden", () => {
    render(<MenuBarPreviewStrip model={makeWidgetTabModel()} label="Live preview" />)
    expect(screen.getByText("Live preview")).toBeInTheDocument()
    expect(screen.getByTestId("menu-bar-preview-widget")).not.toHaveClass("opacity-30")
    cleanup()
    render(<MenuBarPreviewStrip model={{ ...makeWidgetTabModel(), visible: false }} />)
    expect(screen.getByTestId("menu-bar-preview-widget")).toHaveClass("opacity-30")
  })
})
