import { vi } from "vitest"
import type { PluginMeta } from "@/lib/plugin-types"
import type { WidgetTabModel } from "@/components/widget-tab/types"

function progressMeta(id: string, name: string, labels: string[]): PluginMeta {
  return {
    id,
    name,
    iconUrl: `${id}.svg`,
    lines: labels.map((label) => ({ type: "progress" as const, label, scope: "overview" as const })),
    primaryCandidates: labels,
  }
}

/** A complete `WidgetTabModel` with spy handlers, for layout tests. The defaults are the product defaults. */
export function makeWidgetTabModel(overrides: Partial<WidgetTabModel> = {}): WidgetTabModel {
  return {
    visible: true,
    onVisibleChange: vi.fn(),
    style: "compact",
    onStyleChange: vi.fn(),
    backdrop: { enabled: true, color: "auto", opacity: 0, glass: 0, blur: 50 },
    onBackdropChange: vi.fn(),
    colors: {},
    onColorsChange: vi.fn(),
    textColors: { label: "mono", used: "color", expected: "mono" },
    onTextColorsChange: vi.fn(),
    toneModes: { ahead: "mono", onTrack: "color", behind: "color" },
    onToneModesChange: vi.fn(),
    plugins: [
      { id: "claude", name: "Claude", enabled: true },
      { id: "codex", name: "ChatGPT", enabled: true },
      { id: "cursor", name: "Cursor", enabled: false },
    ],
    pluginsMeta: [
      progressMeta("claude", "Claude", ["Session", "Weekly", "Sonnet"]),
      progressMeta("codex", "ChatGPT", ["Session", "Weekly"]),
      progressMeta("cursor", "Cursor", ["Total Usage"]),
    ],
    providerIds: null,
    onProviderIdsChange: vi.fn(),
    providerMetrics: {},
    onProviderMetricsChange: vi.fn(),
    ...overrides,
  }
}
