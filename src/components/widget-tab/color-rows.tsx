import {
  allTextMono,
  hasCustomColors,
  MenuBarWidgetColorRows,
  MenuBarWidgetTextColorRows,
  type ColorRowsVariant,
} from "@/components/menu-bar-widget-colors"
import { Button } from "@/components/ui/button"
import type { WidgetTabModel } from "@/components/widget-tab/types"
import { cn } from "@/lib/utils"

export interface ColorRowsProps {
  model: WidgetTabModel
  variant?: ColorRowsVariant
}

/** Mono / Color per text part (Label, Used, Expected pace). */
export function TextColorRows({ model, variant = "compact" }: ColorRowsProps) {
  return <MenuBarWidgetTextColorRows textColors={model.textColors} onChange={model.onTextColorsChange} variant={variant} />
}

/**
 * Healthy / Close to limit / Over pace: Mono / Color, custom color swatch, Reset.
 * Dimmed with a note while every text is mono (the tone colors are then unused).
 */
export function ToneRows({ model, variant = "compact" }: ColorRowsProps) {
  const unused = allTextMono(model.textColors)
  return (
    <div className={cn(unused && "opacity-50")} data-testid="menu-bar-widget-tone-colors">
      {unused && <p className="pb-1 text-xs text-muted-foreground">Not used — all texts are mono</p>}
      <MenuBarWidgetColorRows
        colors={model.colors}
        onChange={model.onColorsChange}
        toneModes={model.toneModes}
        onToneModesChange={model.onToneModesChange}
        variant={variant}
      />
    </div>
  )
}

/** "Reset all" button for the custom tone colors; renders nothing while none is customized. */
export function ResetColorsButton({ model }: { model: WidgetTabModel }) {
  if (!hasCustomColors(model.colors)) return null
  return (
    <Button type="button" variant="ghost" size="xs" onClick={() => model.onColorsChange({})}>
      Reset all
    </Button>
  )
}
