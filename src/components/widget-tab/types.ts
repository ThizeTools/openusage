import type { PluginMeta } from "@/lib/plugin-types"
import type {
  MenuBarWidgetBackdrop,
  MenuBarWidgetColors,
  MenuBarWidgetStyle,
  MenuBarWidgetTextColors,
  MenuBarWidgetToneModes,
  WidgetProviderIds,
  WidgetProviderMetrics,
} from "@/lib/settings"

/** A provider (or account) row of the plugin list, as the Settings page receives it. */
export interface WidgetPluginConfig {
  id: string
  name: string
  enabled: boolean
}

/**
 * Everything a layout of the macOS Widget tab reads and writes: every value plus its change handler.
 * Layouts only get this (`(props: { model: WidgetTabModel }) => JSX`); they never see the individual props
 * of `WidgetMetricsSection`. Handlers persist immediately (the settings window debounces the backdrop sliders).
 */
export interface WidgetTabModel {
  /** Whether the widget is shown in the menu bar at all. */
  visible: boolean
  onVisibleChange: (value: boolean) => void

  /** How the metrics are arranged (stacked / compact / inline / inline-compact). */
  style: MenuBarWidgetStyle
  onStyleChange: (value: MenuBarWidgetStyle) => void

  /** The background card: enabled, auto/custom color, opacity, glass, blur. */
  backdrop: MenuBarWidgetBackdrop
  onBackdropChange: (value: MenuBarWidgetBackdrop) => void

  /** Custom tone colors (Healthy / Close to limit / Over pace); a missing tone uses the built-in color. */
  colors: MenuBarWidgetColors
  onColorsChange: (value: MenuBarWidgetColors) => void

  /** Per text part (label / used / expected pace): mono or pace-colored. */
  textColors: MenuBarWidgetTextColors
  onTextColorsChange: (value: MenuBarWidgetTextColors) => void

  /** Per pace state (ahead / onTrack / behind): drawn in its tone color or mono. */
  toneModes: MenuBarWidgetToneModes
  onToneModesChange: (value: MenuBarWidgetToneModes) => void

  /** All plugins/accounts in the user's order (enabled or not); layouts normally show the enabled ones. */
  plugins: WidgetPluginConfig[]
  pluginsMeta: PluginMeta[]
  /** Providers shown in the widget; null = every enabled provider. */
  providerIds: WidgetProviderIds
  onProviderIdsChange: (value: WidgetProviderIds) => void
  /** Metric labels shown per provider id, in manifest order; a missing id uses the provider defaults. */
  providerMetrics: WidgetProviderMetrics
  onProviderMetricsChange: (value: WidgetProviderMetrics) => void
}

/** The appearance part of the model: what the rendered widget depends on. Presets and previews take only this. */
export type WidgetAppearance = Pick<WidgetTabModel, "style" | "backdrop" | "colors" | "textColors" | "toneModes">

/** The provider/metric part of the model. */
export type WidgetProvidersModel = Pick<
  WidgetTabModel,
  "plugins" | "pluginsMeta" | "providerIds" | "onProviderIdsChange" | "providerMetrics" | "onProviderMetricsChange"
>

/** Props of every layout component of the Widget tab. */
export interface WidgetTabLayoutProps {
  model: WidgetTabModel
}
