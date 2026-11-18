import { MenuBarStylePicker } from "@/components/menu-bar-widget-preview"
import { useTileDemoPayload } from "@/components/widget-tab/demo-payload"
import type { WidgetTabModel } from "@/components/widget-tab/types"

export interface StylePickerProps {
  model: WidgetTabModel
  /** "tiles": 2x2 cards with a description (the original). "thumbs": 2x2 compact thumbnails with the name. */
  variant?: "tiles" | "thumbs"
}

/**
 * Pick how the metrics are laid out. Every option is the real rendered widget with the model's current
 * background and colors. A radiogroup named "Menu bar style" with one radio per style.
 */
export function StylePicker({ model, variant = "tiles" }: StylePickerProps) {
  const payload = useTileDemoPayload(model)
  return (
    <MenuBarStylePicker
      variant={variant}
      style={model.style}
      backdrop={model.backdrop}
      colors={model.colors}
      textColors={model.textColors}
      toneModes={model.toneModes}
      payload={payload}
      onStyleChange={model.onStyleChange}
    />
  )
}
