import { LayoutHybrid } from "@/components/widget-tab/layout-hybrid";
import type { WidgetPluginConfig, WidgetTabModel } from "@/components/widget-tab/types";
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

/** Bundles the section's props into the model the widget tab works with. */
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

/** Widget settings: the same tab on macOS (menu bar) and Windows (taskbar). */
export function WidgetMetricsSection(props: WidgetMetricsSectionProps) {
  return (
    <section>
      <LayoutHybrid model={buildWidgetTabModel(props)} />
    </section>
  );
}
