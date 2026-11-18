import { useEffect, useMemo, useState } from "react"
import type { WidgetTabModel } from "@/components/widget-tab/types"
import { getIconMask } from "@/lib/icon-mask"
import type { TaskbarItem, TaskbarPayload } from "@/lib/taskbar-payload"
import { getDefaultProviderMetrics, getProviderMetricOptions } from "@/lib/widget-rows"

export type DemoTone = Exclude<TaskbarItem["tone"], "neutral">

/** Demo value per pace tone, with the same fraction semantics as the real widget text ("used%/expected%"). */
const DEMO_VALUES: Record<DemoTone, string> = {
  ahead: "13%/91%",
  "on-track": "78%/70%",
  behind: "94%/61%",
}

/** Tones the demo items cycle through, by item index. */
export const DEFAULT_DEMO_TONES: readonly DemoTone[] = ["ahead", "behind"]

type SelectionModel = Pick<WidgetTabModel, "plugins" | "pluginsMeta" | "providerIds" | "providerMetrics">

/** One provider of the widget as configured: its icon and the metric labels it shows, in the provider's metric order. */
export interface DemoProvider {
  id: string
  iconUrl: string | undefined
  labels: string[]
}

/**
 * The providers the real widget would show: `providerIds` (null = every enabled one), enabled plugins with
 * meta only, in plugin order, each with its selected metrics (a provider without any is left out, as in the widget).
 */
export function selectDemoProviders(model: SelectionModel): DemoProvider[] {
  const metaById = new Map(model.pluginsMeta.map((meta) => [meta.id, meta]))
  const shown = model.providerIds === null ? null : new Set(model.providerIds)
  const providers: DemoProvider[] = []
  for (const plugin of model.plugins) {
    const meta = metaById.get(plugin.id)
    if (!plugin.enabled || !meta || (shown && !shown.has(plugin.id))) continue
    const selected = new Set(model.providerMetrics[plugin.id] ?? getDefaultProviderMetrics(meta))
    const labels = getProviderMetricOptions(meta).filter((label) => selected.has(label))
    if (labels.length > 0) providers.push({ id: plugin.id, iconUrl: meta.iconUrl, labels })
  }
  if (providers.length > 0) return providers
  // Nothing selected: show a Session/Weekly placeholder (with the first enabled provider's icon) so the preview is never empty.
  const first = model.plugins.find((plugin) => plugin.enabled && metaById.has(plugin.id))
  return [{ id: "demo", iconUrl: first && metaById.get(first.id)?.iconUrl, labels: ["Session", "Weekly"] }]
}

/** The payload for the selected providers; the tone of item N (counted over the whole widget) is `tones[N % tones.length]`. */
function buildPayload(
  providers: readonly DemoProvider[],
  resolveMask: (iconUrl: string) => string | null,
  tones: readonly DemoTone[]
): TaskbarPayload {
  let index = 0
  return {
    tooltip: "",
    providers: providers.map((provider) => ({
      id: provider.id,
      iconMask: provider.iconUrl ? resolveMask(provider.iconUrl) : null,
      items: provider.labels.map((label) => {
        const tone = tones[index++ % tones.length]
        return { label, value: DEMO_VALUES[tone], tone }
      }),
    })),
  }
}

/** Demo payload that follows the model's selected providers and metrics. `resolveMask` gives a provider icon's mask (null while loading). */
export function buildModelDemoPayload(
  model: SelectionModel,
  resolveMask: (iconUrl: string) => string | null,
  tones: readonly DemoTone[] = DEFAULT_DEMO_TONES
): TaskbarPayload {
  return buildPayload(selectDemoProviders(model), resolveMask, tones)
}

/**
 * `buildModelDemoPayload` with the icon masks resolved (async, cached by the lib); the object is stable while
 * nothing changes. Pass `tones` as a module-level constant (it is a dependency of the memo).
 */
export function useModelDemoPayload(model: SelectionModel, tones: readonly DemoTone[] = DEFAULT_DEMO_TONES): TaskbarPayload {
  // Models arrive as fresh objects on every render: key on the selected content.
  const selectionKey = JSON.stringify(selectDemoProviders(model))
  const providers = useMemo(() => JSON.parse(selectionKey) as DemoProvider[], [selectionKey])
  const [masks, setMasks] = useState<Record<string, string | null>>({})

  useEffect(() => {
    let cancelled = false
    for (const { iconUrl } of providers) {
      if (!iconUrl) continue
      // getIconMask resolves null (and logs) when an icon cannot be read; that icon is then left out.
      void getIconMask(iconUrl).then((mask) => {
        if (!cancelled) setMasks((current) => (current[iconUrl] === mask ? current : { ...current, [iconUrl]: mask }))
      })
    }
    return () => {
      cancelled = true
    }
  }, [providers])

  return useMemo(() => buildPayload(providers, (url) => masks[url] ?? null, tones), [providers, masks, tones])
}

/** Payload for the style tiles and preset cards: only the first provider with its first two metrics, so the tiles stay small. */
export function useTileDemoPayload(model: SelectionModel): TaskbarPayload {
  const payload = useModelDemoPayload(model)
  return useMemo(() => {
    const first = payload.providers[0]
    return { ...payload, providers: [{ ...first, items: first.items.slice(0, 2) }] }
  }, [payload])
}
