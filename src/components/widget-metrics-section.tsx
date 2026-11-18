import { ProvidersList } from "@/components/widget-tab/providers-list";
import { LayoutHybrid } from "@/components/widget-tab/layout-hybrid";
import type { WidgetPluginConfig, WidgetProvidersModel, WidgetTabModel } from "@/components/widget-tab/types";
import { Checkbox } from "@/components/ui/checkbox";
import { isMacPlatform, widgetSurfaceName } from "@/lib/platform";
import type { PluginMeta } from "@/lib/plugin-types";
import {
  type MenuBarWidgetBackdrop,
  type MenuBarWidgetColors,
  type MenuBarWidgetStyle,
  type MenuBarWidgetTextColors,
  type MenuBarWidgetToneModes,
  type WidgetProviderIds,
  type WidgetProviderMetrics,
} from "@/lib/settings";

export type { WidgetPluginConfig };

interface WidgetMetricsSectionProps {
  plugins: WidgetPluginConfig[];
  pluginsMeta: PluginMeta[];
  widgetVisible: boolean;
  onWidgetVisibleChange: (value: boolean) => void;
  widgetProviderIds: WidgetProviderIds;
  onWidgetProviderIdsChange: (value: WidgetProviderIds) => void;
  widgetProviderMetrics: WidgetProviderMetrics;
  onWidgetProviderMetricsChange: (value: WidgetProviderMetrics) => void;
  menuBarWidgetBackdrop: MenuBarWidgetBackdrop;
  onMenuBarWidgetBackdropChange: (value: MenuBarWidgetBackdrop) => void;
  menuBarWidgetStyle: MenuBarWidgetStyle;
  onMenuBarWidgetStyleChange: (value: MenuBarWidgetStyle) => void;
  menuBarWidgetColors: MenuBarWidgetColors;
  onMenuBarWidgetColorsChange: (value: MenuBarWidgetColors) => void;
  menuBarWidgetTextColors: MenuBarWidgetTextColors;
  onMenuBarWidgetTextColorsChange: (value: MenuBarWidgetTextColors) => void;
  menuBarWidgetToneModes: MenuBarWidgetToneModes;
  onMenuBarWidgetToneModesChange: (value: MenuBarWidgetToneModes) => void;
}

/** Bundles the section's props into the model every macOS layout works with. */
function buildWidgetTabModel(props: WidgetMetricsSectionProps): WidgetTabModel {
  return {
    visible: props.widgetVisible,
    onVisibleChange: props.onWidgetVisibleChange,
    style: props.menuBarWidgetStyle,
    onStyleChange: props.onMenuBarWidgetStyleChange,
    backdrop: props.menuBarWidgetBackdrop,
    onBackdropChange: props.onMenuBarWidgetBackdropChange,
    colors: props.menuBarWidgetColors,
    onColorsChange: props.onMenuBarWidgetColorsChange,
    textColors: props.menuBarWidgetTextColors,
    onTextColorsChange: props.onMenuBarWidgetTextColorsChange,
    toneModes: props.menuBarWidgetToneModes,
    onToneModesChange: props.onMenuBarWidgetToneModesChange,
    plugins: props.plugins,
    pluginsMeta: props.pluginsMeta,
    providerIds: props.widgetProviderIds,
    onProviderIdsChange: props.onWidgetProviderIdsChange,
    providerMetrics: props.widgetProviderMetrics,
    onProviderMetricsChange: props.onWidgetProviderMetricsChange,
  };
}

/** macOS: the menu bar widget tab. */
function MenuBarWidgetTab(props: WidgetMetricsSectionProps) {
  return (
    <section>
      <LayoutHybrid model={buildWidgetTabModel(props)} />
    </section>
  );
}

/** Windows / Linux: visibility plus the providers and metrics shown on the taskbar widget. */
function TaskbarWidgetSection({
  plugins,
  pluginsMeta,
  widgetVisible,
  onWidgetVisibleChange,
  widgetProviderIds,
  onWidgetProviderIdsChange,
  widgetProviderMetrics,
  onWidgetProviderMetricsChange,
}: WidgetMetricsSectionProps) {
  const providers: WidgetProvidersModel = {
    plugins,
    pluginsMeta,
    providerIds: widgetProviderIds,
    onProviderIdsChange: onWidgetProviderIdsChange,
    providerMetrics: widgetProviderMetrics,
    onProviderMetricsChange: onWidgetProviderMetricsChange,
  };

  return (
    <section>
      <h3 className="text-lg font-semibold mb-0">Taskbar Widget</h3>
      <p className="text-sm text-muted-foreground mb-2">
        Choose which providers and metrics appear on the {widgetSurfaceName()}.
      </p>
      <label className="flex items-center gap-2 text-sm select-none text-foreground mb-2">
        <Checkbox
          key={`widget-visible-${widgetVisible}`}
          checked={widgetVisible}
          onCheckedChange={(checked) => onWidgetVisibleChange(checked === true)}
        />
        Show in {widgetSurfaceName()}
      </label>
      <ProvidersList model={providers} />
    </section>
  );
}

/** Widget settings: on macOS the menu bar widget tab, elsewhere the taskbar widget's providers and metrics. */
export function WidgetMetricsSection(props: WidgetMetricsSectionProps) {
  return isMacPlatform() ? <MenuBarWidgetTab {...props} /> : <TaskbarWidgetSection {...props} />;
}
