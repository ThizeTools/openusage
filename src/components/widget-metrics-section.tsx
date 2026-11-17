import { ProviderIcon } from "@/components/accounts/provider-icon";
import { Checkbox } from "@/components/ui/checkbox";
import type { PluginMeta } from "@/lib/plugin-types";
import type { WidgetProviderIds, WidgetProviderMetrics } from "@/lib/settings";
import { getDefaultProviderMetrics, getProviderMetricOptions } from "@/lib/widget-rows";

export interface WidgetPluginConfig {
  id: string;
  name: string;
  enabled: boolean;
}

interface WidgetMetricsSectionProps {
  plugins: WidgetPluginConfig[];
  pluginsMeta: PluginMeta[];
  widgetVisible: boolean;
  onWidgetVisibleChange: (value: boolean) => void;
  widgetProviderIds: WidgetProviderIds;
  onWidgetProviderIdsChange: (value: WidgetProviderIds) => void;
  widgetProviderMetrics: WidgetProviderMetrics;
  onWidgetProviderMetricsChange: (value: WidgetProviderMetrics) => void;
}

/** Taskbar widget settings: visibility, which providers show, and which metrics each shows. */
export function WidgetMetricsSection({
  plugins,
  pluginsMeta,
  widgetVisible,
  onWidgetVisibleChange,
  widgetProviderIds,
  onWidgetProviderIdsChange,
  widgetProviderMetrics,
  onWidgetProviderMetricsChange,
}: WidgetMetricsSectionProps) {
  const metaById = new Map(pluginsMeta.map((meta) => [meta.id, meta]));
  const enabledPlugins = plugins.filter((plugin) => plugin.enabled);
  const enabledWidgetProviderIds = widgetProviderIds ?? enabledPlugins.map((plugin) => plugin.id);
  const shownProviderIds = new Set(enabledWidgetProviderIds);

  const getSelectedMetrics = (id: string, meta: PluginMeta): Set<string> =>
    new Set(widgetProviderMetrics[id] ?? getDefaultProviderMetrics(meta));

  const handleProviderToggle = (pluginId: string, checked: boolean) => {
    const next = new Set(enabledWidgetProviderIds);
    if (checked) next.add(pluginId);
    else next.delete(pluginId);
    onWidgetProviderIdsChange(plugins.filter((plugin) => next.has(plugin.id)).map((plugin) => plugin.id));
  };

  const handleMetricToggle = (plugin: WidgetPluginConfig, meta: PluginMeta, label: string, checked: boolean) => {
    const next = getSelectedMetrics(plugin.id, meta);
    if (checked) next.add(label);
    else next.delete(label);
    const ordered = getProviderMetricOptions(meta).filter((option) => next.has(option));
    onWidgetProviderMetricsChange({ ...widgetProviderMetrics, [plugin.id]: ordered });
  };

  return (
    <section>
      <h3 className="text-lg font-semibold mb-0">Taskbar Widget</h3>
      <p className="text-sm text-muted-foreground mb-2">
        Choose which providers and metrics appear on the taskbar.
      </p>
      <label className="flex items-center gap-2 text-sm select-none text-foreground mb-2">
        <Checkbox
          key={`widget-visible-${widgetVisible}`}
          checked={widgetVisible}
          onCheckedChange={(checked) => onWidgetVisibleChange(checked === true)}
        />
        Show in taskbar
      </label>
      <div className="bg-muted/50 rounded-lg p-1 space-y-1">
        {enabledPlugins.map((plugin) => {
          const meta = metaById.get(plugin.id);
          if (!meta) throw new Error(`Missing plugin metadata for widget provider "${plugin.id}"`);
          const isShown = shownProviderIds.has(plugin.id);
          const selected = getSelectedMetrics(plugin.id, meta);
          const options = getProviderMetricOptions(meta);
          return (
            <div key={`widget-provider-${plugin.id}`} className="space-y-1">
              <label className="flex items-center gap-2 px-3 py-2 rounded-md bg-card text-sm select-none">
                <Checkbox
                  key={`widget-provider-${plugin.id}-${isShown}`}
                  checked={isShown}
                  onCheckedChange={(checked) => handleProviderToggle(plugin.id, checked === true)}
                />
                <ProviderIcon iconUrl={meta.iconUrl} brandColor={meta.brandColor} className="size-4" />
                <span className="flex-1">{plugin.name}</span>
              </label>
              {options.length > 0 && (
                <div className="pl-9 pr-1 space-y-1">
                  {options.map((label) => (
                    <label
                      key={`widget-metric-${plugin.id}-${label}`}
                      className="flex items-center gap-2 px-2 py-1 rounded-md text-sm select-none text-foreground"
                    >
                      <Checkbox
                        key={`widget-metric-${plugin.id}-${label}-${selected.has(label)}`}
                        checked={selected.has(label)}
                        disabled={!isShown}
                        onCheckedChange={(checked) => handleMetricToggle(plugin, meta, label, checked === true)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
