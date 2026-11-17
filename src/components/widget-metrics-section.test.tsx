import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WidgetMetricsSection } from "@/components/widget-metrics-section"
import type { PluginMeta } from "@/lib/plugin-types"

function progressMeta(id: string, name: string, labels: string[]): PluginMeta {
  return {
    id,
    name,
    iconUrl: `${id}.svg`,
    lines: labels.map((label) => ({ type: "progress" as const, label, scope: "overview" as const })),
    primaryCandidates: labels,
  }
}

const pluginsMeta = [
  progressMeta("claude@1a2b3c4d", "Claude · work", ["Session", "Weekly", "Sonnet"]),
  progressMeta("codex", "Codex", ["Session", "Weekly"]),
]

const plugins = [
  { id: "claude@1a2b3c4d", name: "Claude · work", enabled: true },
  { id: "codex", name: "Codex", enabled: true },
]

function renderSection(overrides: Partial<Parameters<typeof WidgetMetricsSection>[0]> = {}) {
  const props = {
    plugins,
    pluginsMeta,
    widgetVisible: true,
    onWidgetVisibleChange: vi.fn(),
    widgetProviderIds: null,
    onWidgetProviderIdsChange: vi.fn(),
    widgetProviderMetrics: {},
    onWidgetProviderMetricsChange: vi.fn(),
    ...overrides,
  }
  render(<WidgetMetricsSection {...props} />)
  return props
}

afterEach(() => {
  cleanup()
})

describe("WidgetMetricsSection", () => {
  it("checks the default metrics of an account provider", () => {
    renderSection()
    // "Session" is shown for Claude (first) and Codex; Claude's comes first.
    const claudeSessionLabel = screen.getAllByText("Session")[0].closest("label")!
    expect(within(claudeSessionLabel).getByRole("checkbox")).toHaveAttribute("aria-checked", "true")
    const sonnetLabel = screen.getByText("Sonnet").closest("label")!
    expect(within(sonnetLabel).getByRole("checkbox")).toHaveAttribute("aria-checked", "false")
  })

  it("saves the full metric array in manifest order when a metric is toggled", async () => {
    const { onWidgetProviderMetricsChange } = renderSection({
      widgetProviderMetrics: { "claude@1a2b3c4d": ["Weekly"] },
    })

    await userEvent.click(screen.getByLabelText("Sonnet"))
    expect(onWidgetProviderMetricsChange).toHaveBeenLastCalledWith({
      "claude@1a2b3c4d": ["Weekly", "Sonnet"],
    })

    // Props are not re-rendered by the test, so Session is toggled on top of ["Weekly"].
    await userEvent.click(screen.getAllByLabelText("Session")[0])
    expect(onWidgetProviderMetricsChange).toHaveBeenLastCalledWith({
      "claude@1a2b3c4d": ["Session", "Weekly"],
    })
  })

  it("keeps other providers' selections when one provider changes", async () => {
    const { onWidgetProviderMetricsChange } = renderSection({
      widgetProviderMetrics: { codex: ["Weekly"] },
    })

    await userEvent.click(screen.getByLabelText("Sonnet"))
    expect(onWidgetProviderMetricsChange).toHaveBeenLastCalledWith({
      codex: ["Weekly"],
      "claude@1a2b3c4d": ["Session", "Weekly", "Sonnet"],
    })
  })

  it("does not save metric changes for a provider hidden from the widget", async () => {
    const { onWidgetProviderMetricsChange } = renderSection({ widgetProviderIds: ["codex"] })

    await userEvent.click(screen.getByLabelText("Sonnet"))
    expect(onWidgetProviderMetricsChange).not.toHaveBeenCalled()
  })

  it("toggling a provider saves the shown provider ids in plugin order", async () => {
    const { onWidgetProviderIdsChange } = renderSection({ widgetProviderIds: ["codex"] })

    await userEvent.click(screen.getByLabelText("Claude · work"))
    expect(onWidgetProviderIdsChange).toHaveBeenCalledWith(["claude@1a2b3c4d", "codex"])
  })

  it("shows the taskbar visibility toggle", async () => {
    const { onWidgetVisibleChange } = renderSection({ widgetVisible: false })

    await userEvent.click(screen.getByText("Show in taskbar"))
    expect(onWidgetVisibleChange).toHaveBeenCalledWith(true)
  })
})
