import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  mac: false,
  windows: false,
  invokeMock: vi.fn(),
  pngMock: vi.fn(),
  rgbaMock: vi.fn(),
  dockMock: vi.fn(),
  dockStyle: "off",
  dockAccountLabel: "initial",
  menuBarAccountLabel: "initial",
  claudeAccountCount: 1,
  overrides: {} as Record<string, unknown>,
}))

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: state.invokeMock }))
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    onKeyChange = vi.fn(async () => () => {})
  },
}))
vi.mock("@/lib/platform", () => ({
  isMacPlatform: () => state.mac,
  isWindowsPlatform: () => state.windows,
  usesRenderedWidget: () => state.mac || state.windows,
}))
vi.mock("@/hooks/app/use-menu-bar-dark", () => ({ useMenuBarDark: () => true }))
vi.mock("@/hooks/app/use-widget-rows", () => {
  const row = (id: string, name: string) => ({
    id,
    name,
    iconUrl: `${id}.svg`,
    brandColor: "#DE7356",
    fraction: 0.4,
    expectedFraction: 0.3,
    tone: "on-track",
    metrics: [{ label: "Session", fraction: 0.4, expectedFraction: 0.3, tone: "on-track" }],
  })
  const all = [row("claude", "Claude"), row("codex", "Codex"), row("claude@abc", "Claude · Work")]
  // Global selection shows claude only; an override picks its own ids.
  const rowsFor = (selection: { providerIds: string[] | null } | null) =>
    all.filter((r) => (selection?.providerIds ?? ["claude"]).includes(r.id))
  return { useWidgetRows: () => ({ rows: rowsFor(null), rowsFor, claudeAccountCount: state.claudeAccountCount }) }
})
vi.mock("@/lib/icon-mask", () => ({ getIconMask: vi.fn(async () => null) }))
vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings")
  return {
    ...actual,
    loadDockOverlayStyle: vi.fn(async () => state.dockStyle),
    loadDockOverlayAccountLabel: vi.fn(async () => state.dockAccountLabel),
    loadMenuBarAccountLabel: vi.fn(async () => state.menuBarAccountLabel),
    loadMenuBarWidgetBackdrop: vi.fn(async () => actual.DEFAULT_MENU_BAR_WIDGET_BACKDROP),
    loadMenuBarWidgetStyle: vi.fn(async () => "stacked"),
    loadMenuBarWidgetColors: vi.fn(async () => ({})),
    loadMenuBarWidgetTextColors: vi.fn(async () => actual.DEFAULT_MENU_BAR_WIDGET_TEXT_COLORS),
    loadMenuBarWidgetToneModes: vi.fn(async () => actual.DEFAULT_MENU_BAR_WIDGET_TONE_MODES),
    loadSurfaceOverrides: vi.fn(async (surface: "menuBar" | "dock") =>
      actual.parseSurfaceOverrides(state.overrides[surface])
    ),
  }
})
vi.mock("@/lib/dock-overlay-image", () => ({ renderDockOverlayPng: state.dockMock }))
vi.mock("@/lib/menubar-widget-image", async () => ({
  ...(await vi.importActual<typeof import("@/lib/menubar-widget-image")>("@/lib/menubar-widget-image")),
  renderMenuBarWidgetPng: state.pngMock,
  renderMenuBarWidgetRgba: state.rgbaMock,
}))

import { useTaskbarWidgetSync } from "@/hooks/app/use-taskbar-widget-sync"

describe("useTaskbarWidgetSync", () => {
  beforeEach(() => {
    state.mac = false
    state.windows = false
    state.invokeMock.mockReset()
    state.invokeMock.mockResolvedValue(undefined)
    state.pngMock.mockReset()
    state.pngMock.mockResolvedValue("PNG")
    state.rgbaMock.mockReset()
    state.rgbaMock.mockResolvedValue({ width: 3, height: 66, rgba: "AAAA" })
    state.dockMock.mockReset()
    state.dockMock.mockResolvedValue("DOCK")
    state.dockStyle = "off"
    state.dockAccountLabel = "initial"
    state.menuBarAccountLabel = "initial"
    state.claudeAccountCount = 1
    state.overrides = {}
  })

  const sentPayload = () => {
    const call = state.invokeMock.mock.calls.find(([cmd]) => cmd === "taskbar_widget_update")
    return call?.[1].payload as Record<string, unknown> | undefined
  }

  const lastPayload = () => state.invokeMock.mock.calls.at(-1)?.[1].payload as Record<string, unknown> | undefined

  it("on Windows sends the rendered RGBA widget and no menu bar image", async () => {
    state.windows = true
    renderHook(() => useTaskbarWidgetSync())
    await waitFor(() => expect(sentPayload()).toBeDefined())
    expect(sentPayload()?.widgetImage).toEqual({ width: 3, height: 66, rgba: "AAAA" })
    expect(sentPayload()?.menuBarImage).toBeUndefined()
    expect(state.rgbaMock).toHaveBeenCalled()
    expect(state.pngMock).not.toHaveBeenCalled()
  })

  it("on macOS keeps sending the PNG and the backdrop", async () => {
    state.mac = true
    renderHook(() => useTaskbarWidgetSync())
    await waitFor(() => expect(sentPayload()).toBeDefined())
    expect(sentPayload()?.menuBarImage).toBe("PNG")
    expect(sentPayload()?.widgetImage).toBeUndefined()
    expect(state.rgbaMock).not.toHaveBeenCalled()
  })

  it("falls back to the native layout (no image) when the render fails", async () => {
    state.windows = true
    state.rgbaMock.mockRejectedValue(new Error("no canvas"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    renderHook(() => useTaskbarWidgetSync())
    await waitFor(() => expect(sentPayload()).toBeDefined())
    expect(sentPayload()?.widgetImage).toBeNull()
  })

  it("sends no Dock overlays while the style is off", async () => {
    state.mac = true
    state.dockStyle = "off"
    renderHook(() => useTaskbarWidgetSync())
    // The default style is "pill", so a first payload can go out before the stored "off" loads; the next one clears it.
    await waitFor(() => expect(lastPayload()?.dockOverlays).toEqual([]))
  })

  it("sends one Dock overlay per provider with a Dock app on macOS", async () => {
    state.mac = true
    state.dockStyle = "pill"
    renderHook(() => useTaskbarWidgetSync())
    await waitFor(() =>
      expect(lastPayload()?.dockOverlays).toEqual([{ bundleIds: ["com.anthropic.claudefordesktop"], png: "DOCK" }])
    )
    expect(state.dockMock.mock.calls[0]?.[0]).toMatchObject({ id: "claude" })
    expect(state.dockMock.mock.calls[0]).toHaveLength(2)
  })

  it("does not render Dock overlays on Windows", async () => {
    state.windows = true
    state.dockStyle = "pill"
    renderHook(() => useTaskbarWidgetSync())
    await waitFor(() => expect(sentPayload()).toBeDefined())
    expect(sentPayload()?.dockOverlays).toBeUndefined()
    expect(state.dockMock).not.toHaveBeenCalled()
  })

  it("sends an empty list when a Dock render fails", async () => {
    state.mac = true
    state.dockStyle = "pill"
    state.dockMock.mockRejectedValue(new Error("no canvas"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    renderHook(() => useTaskbarWidgetSync())
    await waitFor(() => expect(state.dockMock).toHaveBeenCalled())
    await waitFor(() => expect(state.invokeMock.mock.calls.length).toBeGreaterThan(1))
    expect(lastPayload()?.dockOverlays).toEqual([])
  })

  it("menu bar color override changes the render options, the global colors stay for the Dock", async () => {
    state.mac = true
    state.dockStyle = "pill"
    state.overrides = {
      menuBar: {
        colors: {
          colors: { ahead: "#123456" },
          textColors: { label: "color", used: "color", expected: "color" },
          toneModes: { ahead: "color", onTrack: "color", behind: "color" },
        },
      },
    }
    renderHook(() => useTaskbarWidgetSync())
    await waitFor(() => expect(sentPayload()).toBeDefined())
    const appearance = state.pngMock.mock.calls.at(-1)?.[1]
    expect(appearance.colors).toEqual({ ahead: "#123456" })
    expect(appearance.textColors).toEqual({ label: "color", used: "color", expected: "color" })
    expect(appearance.toneModes.ahead).toBe("color")
    expect(state.dockMock.mock.calls.at(-1)?.[1].colors).toEqual({})
  })

  it("dock color override changes the Dock render options only", async () => {
    state.mac = true
    state.dockStyle = "pill"
    state.overrides = {
      dock: {
        colors: {
          colors: { behind: "#654321" },
          textColors: { label: "mono", used: "color", expected: "mono" },
          toneModes: { ahead: "mono", onTrack: "mono", behind: "color" },
        },
      },
    }
    renderHook(() => useTaskbarWidgetSync())
    await waitFor(() => expect(state.dockMock).toHaveBeenCalled())
    expect(state.dockMock.mock.calls.at(-1)?.[1]).toMatchObject({
      colors: { behind: "#654321" },
      toneModes: { ahead: "mono", onTrack: "mono", behind: "color" },
    })
    await waitFor(() => expect(sentPayload()).toBeDefined())
    expect(state.pngMock.mock.calls.at(-1)?.[1].colors).toEqual({})
  })

  it("dock providers override changes which providers get overlays", async () => {
    state.mac = true
    state.dockStyle = "pill"
    state.overrides = { dock: { providers: { providerIds: ["codex"], providerMetrics: {} } } }
    renderHook(() => useTaskbarWidgetSync())
    await waitFor(() =>
      expect(lastPayload()?.dockOverlays).toEqual([{ bundleIds: ["com.openai.codex"], png: "DOCK" }])
    )
    // The menu bar still shows the global selection.
    expect((sentPayload()?.providers as { id: string }[]).map((p) => p.id)).toEqual(["claude"])
  })

  it("sends the account id and draws the account name with 2+ Claude accounts registered", async () => {
    state.mac = true
    state.dockStyle = "pill"
    state.claudeAccountCount = 2
    state.overrides = { dock: { providers: { providerIds: ["claude@abc"], providerMetrics: {} } } }
    renderHook(() => useTaskbarWidgetSync())
    await waitFor(() =>
      expect(lastPayload()?.dockOverlays).toEqual([
        { bundleIds: ["com.anthropic.claudefordesktop"], png: "DOCK", accountId: "abc" },
      ])
    )
    expect(state.dockMock.mock.calls.at(-1)?.[1].account).toEqual({ mode: "initial", name: "Work" })
  })

  it('sends the account id without the account name when the Dock mode is "off"', async () => {
    state.mac = true
    state.dockStyle = "pill"
    state.dockAccountLabel = "off"
    state.claudeAccountCount = 2
    state.overrides = { dock: { providers: { providerIds: ["claude@abc"], providerMetrics: {} } } }
    renderHook(() => useTaskbarWidgetSync())
    await waitFor(() =>
      expect(lastPayload()?.dockOverlays).toEqual([
        { bundleIds: ["com.anthropic.claudefordesktop"], png: "DOCK", accountId: "abc" },
      ])
    )
    expect(state.dockMock.mock.calls.at(-1)?.[1].account).toBeUndefined()
  })

  it("sends the account id without the account name with one Claude account registered", async () => {
    state.mac = true
    state.dockStyle = "pill"
    state.claudeAccountCount = 1
    state.overrides = { dock: { providers: { providerIds: ["claude@abc"], providerMetrics: {} } } }
    renderHook(() => useTaskbarWidgetSync())
    await waitFor(() =>
      expect(lastPayload()?.dockOverlays).toEqual([
        { bundleIds: ["com.anthropic.claudefordesktop"], png: "DOCK", accountId: "abc" },
      ])
    )
    expect(state.dockMock.mock.calls.at(-1)?.[1].account).toBeUndefined()
  })

  it("names the Claude accounts in the menu bar widget with 2+ accounts registered", async () => {
    state.mac = true
    state.claudeAccountCount = 2
    state.overrides = { menuBar: { providers: { providerIds: ["claude", "claude@abc"], providerMetrics: {} } } }
    renderHook(() => useTaskbarWidgetSync())
    await waitFor(() => expect((lastPayload()?.providers as { id: string }[]).length).toBe(2))
    const providers = lastPayload()?.providers as { id: string; accountName?: string }[]
    expect(providers.find((p) => p.id === "claude@abc")?.accountName).toBe("Work")
    expect(providers.find((p) => p.id === "claude")).not.toHaveProperty("accountName")
    expect(state.pngMock.mock.calls.at(-1)?.[0].providers.find((p: { id: string }) => p.id === "claude@abc")).toMatchObject({
      accountName: "Work",
    })
    expect(state.pngMock.mock.calls.at(-1)?.[1].accountLabel).toBe("initial")
  })

  it('sends no account name to the menu bar widget when its mode is "off"', async () => {
    state.mac = true
    state.menuBarAccountLabel = "off"
    state.claudeAccountCount = 2
    state.overrides = { menuBar: { providers: { providerIds: ["claude", "claude@abc"], providerMetrics: {} } } }
    renderHook(() => useTaskbarWidgetSync())
    await waitFor(() => expect((lastPayload()?.providers as { id: string }[]).length).toBe(2))
    await waitFor(() => expect(state.pngMock.mock.calls.at(-1)?.[1].accountLabel).toBe("off"))
    const providers = lastPayload()?.providers as { id: string }[]
    expect(providers.every((p) => !("accountName" in p))).toBe(true)
    expect(state.pngMock.mock.calls.at(-1)?.[0].providers.every((p: object) => !("accountName" in p))).toBe(true)
  })

  it("sends no account name to the menu bar widget with one Claude account registered", async () => {
    state.mac = true
    state.claudeAccountCount = 1
    state.overrides = { menuBar: { providers: { providerIds: ["claude@abc"], providerMetrics: {} } } }
    renderHook(() => useTaskbarWidgetSync())
    await waitFor(() => expect((lastPayload()?.providers as { id: string }[])[0].id).toBe("claude@abc"))
    const providers = lastPayload()?.providers as { id: string }[]
    expect(providers[0]).not.toHaveProperty("accountName")
    expect(state.rgbaMock).not.toHaveBeenCalled()
  })

  it("menu bar providers override changes the widget providers, not the Dock", async () => {
    state.mac = true
    state.dockStyle = "pill"
    state.overrides = { menuBar: { providers: { providerIds: ["codex"], providerMetrics: {} } } }
    renderHook(() => useTaskbarWidgetSync())
    await waitFor(() =>
      expect(lastPayload()?.dockOverlays).toEqual([{ bundleIds: ["com.anthropic.claudefordesktop"], png: "DOCK" }])
    )
    expect((lastPayload()?.providers as { id: string }[]).map((p) => p.id)).toEqual(["codex"])
  })
})
