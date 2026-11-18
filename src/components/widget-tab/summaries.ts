import { MENU_BAR_STYLE_LABELS } from "@/components/menu-bar-widget-preview"
import type {
  MenuBarWidgetBackdrop,
  MenuBarWidgetStyle,
  MenuBarWidgetTextColors,
  MenuBarWidgetToneModes,
  WidgetProviderIds,
} from "@/lib/settings"
import type { WidgetPluginConfig } from "@/components/widget-tab/types"

/** "Compact", "Inline compact", ... */
export function summarizeStyle(style: MenuBarWidgetStyle): string {
  return MENU_BAR_STYLE_LABELS[style]
}

/**
 * One line for the background: "Off", "Auto · blur 50%", "#ff0000 · 40% · glass 20%".
 * Color first, then opacity (bare %), glass and blur; a zero value is left out.
 */
export function summarizeBackdrop(backdrop: MenuBarWidgetBackdrop): string {
  if (!backdrop.enabled) return "Off"
  const parts = [backdrop.color === "auto" ? "Auto" : backdrop.color]
  if (backdrop.opacity > 0) parts.push(`${backdrop.opacity}%`)
  if (backdrop.glass > 0) parts.push(`glass ${backdrop.glass}%`)
  if (backdrop.blur > 0) parts.push(`blur ${backdrop.blur}%`)
  return parts.join(" · ")
}

/**
 * Which texts are drawn in pace colors: "All mono", "Used colored", "Used & pace colored",
 * "Label & used colored", "All colored". A text part counts only while at least one pace state is in color
 * (the render never colors a text whose tones are all mono).
 */
export function summarizeColors(textColors: MenuBarWidgetTextColors, toneModes: MenuBarWidgetToneModes): string {
  const tonesInColor = Object.values(toneModes).some((mode) => mode === "color")
  const colored: string[] = []
  if (tonesInColor) {
    if (textColors.label === "color") colored.push("Label")
    if (textColors.used === "color") colored.push("Used")
    if (textColors.expected === "color") colored.push("pace")
  }
  if (colored.length === 0) return "All mono"
  if (colored.length === 3) return "All colored"
  // Only the first word keeps its capital: "Label & used colored".
  const names = colored.map((name, index) => (index === 0 ? name : name.toLowerCase()))
  return `${names.join(" & ")} colored`
}

/** Names of the providers shown in the widget ("Claude, ChatGPT"); "None" when empty, "+N" past three. */
export function summarizeProviders(plugins: WidgetPluginConfig[], providerIds: WidgetProviderIds): string {
  const enabled = plugins.filter((plugin) => plugin.enabled)
  const shown = providerIds === null ? enabled : enabled.filter((plugin) => providerIds.includes(plugin.id))
  if (shown.length === 0) return "None"
  const names = shown.slice(0, 3).map((plugin) => plugin.name)
  return shown.length > 3 ? `${names.join(", ")} +${shown.length - 3}` : names.join(", ")
}
