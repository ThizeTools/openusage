import { MenuBarBackdropControls, type BackdropControlsVariant } from "@/components/menu-bar-backdrop-controls"
import type { WidgetTabModel } from "@/components/widget-tab/types"

export interface BackdropControlsProps {
  model: WidgetTabModel
  /** "cards" (original, checkbox) or "compact" (plain rows, switch). */
  variant?: BackdropControlsVariant
}

/** Show background + Auto/Custom color + Opacity / Glass / Blur sliders. */
export function BackdropControls({ model, variant = "compact" }: BackdropControlsProps) {
  return <MenuBarBackdropControls backdrop={model.backdrop} onChange={model.onBackdropChange} variant={variant} />
}
