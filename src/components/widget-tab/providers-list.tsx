import { ProviderIcon } from "@/components/accounts/provider-icon"
import { Checkbox } from "@/components/ui/checkbox"
import type { PluginMeta } from "@/lib/plugin-types"
import { cn } from "@/lib/utils"
import { getDefaultProviderMetrics, getProviderMetricOptions } from "@/lib/widget-rows"
import type { WidgetPluginConfig, WidgetProvidersModel } from "@/components/widget-tab/types"

export interface ProvidersListProps {
  model: WidgetProvidersModel
  /**
   * "cards" (default, what Windows shows): a card per provider with its metrics indented below.
   * "compact": one dense row per provider with its metric checkboxes inline on the right.
   */
  variant?: "cards" | "compact"
}

/** Providers shown in the widget, each with the metrics it shows. Reads/writes `providerIds` / `providerMetrics`. */
export function ProvidersList({ model, variant = "cards" }: ProvidersListProps) {
  const { plugins, pluginsMeta, providerIds, onProviderIdsChange, providerMetrics, onProviderMetricsChange } = model
  const metaById = new Map(pluginsMeta.map((meta) => [meta.id, meta]))
  const enabledPlugins = plugins.filter((plugin) => plugin.enabled)
  const shownProviderIds = new Set(providerIds ?? enabledPlugins.map((plugin) => plugin.id))
  const compact = variant === "compact"

  const getSelectedMetrics = (id: string, meta: PluginMeta): Set<string> =>
    new Set(providerMetrics[id] ?? getDefaultProviderMetrics(meta))

  const handleProviderToggle = (pluginId: string, checked: boolean) => {
    const next = new Set(shownProviderIds)
    if (checked) next.add(pluginId)
    else next.delete(pluginId)
    onProviderIdsChange(plugins.filter((plugin) => next.has(plugin.id)).map((plugin) => plugin.id))
  }

  const handleMetricToggle = (plugin: WidgetPluginConfig, meta: PluginMeta, label: string, checked: boolean) => {
    const next = getSelectedMetrics(plugin.id, meta)
    if (checked) next.add(label)
    else next.delete(label)
    const ordered = getProviderMetricOptions(meta).filter((option) => next.has(option))
    onProviderMetricsChange({ ...providerMetrics, [plugin.id]: ordered })
  }

  return (
    <div
      className={compact ? "divide-y divide-border/60" : "bg-muted/50 rounded-lg p-1 space-y-1"}
      data-testid="widget-providers-list"
    >
      {enabledPlugins.map((plugin) => {
        const meta = metaById.get(plugin.id)
        if (!meta) throw new Error(`Missing plugin metadata for widget provider "${plugin.id}"`)
        const isShown = shownProviderIds.has(plugin.id)
        const selected = getSelectedMetrics(plugin.id, meta)
        const options = getProviderMetricOptions(meta)
        const providerLabel = (
          <label
            className={cn(
              "flex items-center gap-2 select-none",
              compact ? "min-w-0 flex-1 text-[13px]" : "px-3 py-2 rounded-md bg-card text-sm"
            )}
          >
            <Checkbox
              key={`widget-provider-${plugin.id}-${isShown}`}
              checked={isShown}
              onCheckedChange={(checked) => handleProviderToggle(plugin.id, checked === true)}
            />
            <ProviderIcon iconUrl={meta.iconUrl} brandColor={meta.brandColor} className="size-4" />
            <span className={compact ? "truncate" : "flex-1"}>{plugin.name}</span>
          </label>
        )
        const metricLabels = options.map((label) => (
          <label
            key={`widget-metric-${plugin.id}-${label}`}
            className={cn(
              "flex items-center gap-2 rounded-md select-none text-foreground",
              compact ? "text-[13px]" : "px-2 py-1 text-sm"
            )}
          >
            <Checkbox
              key={`widget-metric-${plugin.id}-${label}-${selected.has(label)}`}
              checked={selected.has(label)}
              disabled={!isShown}
              onCheckedChange={(checked) => handleMetricToggle(plugin, meta, label, checked === true)}
            />
            <span>{label}</span>
          </label>
        ))

        if (compact) {
          return (
            <div key={`widget-provider-${plugin.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5">
              {providerLabel}
              {options.length > 0 && <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">{metricLabels}</div>}
            </div>
          )
        }
        return (
          <div key={`widget-provider-${plugin.id}`} className="space-y-1">
            {providerLabel}
            {options.length > 0 && <div className="pl-9 pr-1 space-y-1">{metricLabels}</div>}
          </div>
        )
      })}
    </div>
  )
}
