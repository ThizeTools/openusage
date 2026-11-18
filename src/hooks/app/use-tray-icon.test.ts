import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  getByIdMock,
  renderTrayRasterIconMock,
} = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  renderTrayRasterIconMock: vi.fn(),
}))

vi.mock("@tauri-apps/api/tray", () => ({
  TrayIcon: {
    getById: getByIdMock,
  },
}))

vi.mock("@/lib/tray-bars-icon", () => ({
  renderTrayRasterIcon: renderTrayRasterIconMock,
}))

import { useTrayIcon } from "@/hooks/app/use-tray-icon"
import type { PluginMeta, PluginOutput } from "@/lib/plugin-types"
import type { PluginSettings } from "@/lib/settings"

function makeTray() {
  return {
    setIcon: vi.fn().mockResolvedValue(undefined),
    setIconAsTemplate: vi.fn().mockResolvedValue(undefined),
    setTitle: vi.fn().mockResolvedValue(undefined),
    setTooltip: vi.fn().mockResolvedValue(undefined),
  }
}

const pluginsMeta: PluginMeta[] = [
  {
    id: "claude",
    name: "Claude",
    iconUrl: "claude.svg",
    lines: [
      { type: "progress", label: "Session", scope: "overview" },
      { type: "progress", label: "Weekly", scope: "overview" },
    ],
    links: [],
    primaryCandidates: ["Session"],
  },
]

const pluginSettings: PluginSettings = {
  order: ["claude"],
  disabled: [],
}

const pluginOutput: PluginOutput = {
  providerId: "claude",
  displayName: "Claude",
  iconUrl: "claude.svg",
  lines: [
    {
      type: "progress",
      label: "Session",
      used: 40,
      limit: 100,
      format: { kind: "percent" },
    },
    {
      type: "progress",
      label: "Weekly",
      used: 65,
      limit: 100,
      format: { kind: "percent" },
    },
  ],
}

describe("useTrayIcon", () => {
  beforeEach(() => {
    getByIdMock.mockReset()
    renderTrayRasterIconMock.mockReset()

    getByIdMock.mockResolvedValue(makeTray())
  })

  it("updates the tooltip but never touches the static icon or title", async () => {
    const tray = makeTray()
    getByIdMock.mockResolvedValue(tray)

    renderHook(() =>
      useTrayIcon({
        pluginsMeta,
        pluginSettings,
        pluginStates: {},
        displayMode: "used",
      })
    )

    await waitFor(() => expect(tray.setTooltip).toHaveBeenCalledWith(expect.stringContaining("OpenUsage")))
    expect(tray.setTitle).not.toHaveBeenCalled()
    expect(tray.setTooltip).toHaveBeenCalledWith(expect.stringContaining("Claude: --%"))
    // Icon is set once in Rust (app/taskbar icon); frontend must not override it.
    expect(tray.setIcon).not.toHaveBeenCalled()
    expect(tray.setIconAsTemplate).not.toHaveBeenCalled()
    expect(renderTrayRasterIconMock).not.toHaveBeenCalled()
  })

  it("updates only tooltip when probe data changes", async () => {
    const tray = makeTray()
    getByIdMock.mockResolvedValue(tray)

    const { rerender } = renderHook(
      ({ used }) =>
        useTrayIcon({
          pluginsMeta,
          pluginSettings,
          pluginStates: {
            claude: {
              data: {
                ...pluginOutput,
                lines: [
                  {
                    type: "progress",
                    label: "Session",
                    used,
                    limit: 100,
                    format: { kind: "percent" },
                  },
                ],
              },
              loading: false,
              error: null,
              lastManualRefreshAt: null,
            },
          },
          displayMode: "used",
        }),
      { initialProps: { used: 40 } }
    )

    await waitFor(() => expect(tray.setTooltip).toHaveBeenCalledWith(expect.stringContaining("40%")))

    rerender({ used: 55 })

    await waitFor(() => expect(tray.setTooltip).toHaveBeenCalledWith(expect.stringContaining("55%")))
    expect(renderTrayRasterIconMock).not.toHaveBeenCalled()
  })

  it("keeps OpenUsage tooltip when settings are missing or all providers are disabled", async () => {
    const tray = makeTray()
    getByIdMock.mockResolvedValue(tray)

    const { rerender } = renderHook(
      ({ settings }) =>
        useTrayIcon({
          pluginsMeta,
          pluginSettings: settings,
          pluginStates: {},
          displayMode: "used",
        }),
      { initialProps: { settings: null as PluginSettings | null } }
    )

    await waitFor(() => expect(tray.setTooltip).toHaveBeenCalledWith("OpenUsage"))

    rerender({ settings: { order: ["claude"], disabled: ["claude"] } })

    await waitFor(() => expect(tray.setTooltip).toHaveBeenCalledWith("OpenUsage"))
    expect(renderTrayRasterIconMock).not.toHaveBeenCalled()
  })
})
