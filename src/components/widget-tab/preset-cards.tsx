import { MenuBarImage, STRIP_CLASS } from "@/components/menu-bar-widget-preview"
import type { WidgetTabModel } from "@/components/widget-tab/types"
import { useTileDemoPayload } from "@/components/widget-tab/demo-payload"
import { useSystemDark } from "@/hooks/use-system-dark"
import {
  applyPreset,
  matchPreset,
  resolvePreset,
  WIDGET_PRESETS,
  type WidgetPresetId,
} from "@/lib/widget-presets"
import { cn } from "@/lib/utils"

const SAMPLE_HEIGHT_PX = 30

export interface PresetCardsProps {
  model: WidgetTabModel
  /** Grid columns (default 3). */
  columns?: 2 | 3
  /** Append a "Custom" card while no preset matches (default true). Without it the grid always has one card per preset. */
  showCustom?: boolean
}

/**
 * One card per preset showing a real rendered sample (the preset's look with the model's tone colors), plus a
 * "Custom" card marked current while no preset matches the model (unless `showCustom` is false). Selecting a card applies the preset through the
 * model's handlers (style, background, text and tone modes; custom tone colors are kept).
 * A radiogroup named "Widget preset"; each card is a radio named after the preset.
 */
export function PresetCards({ model, columns = 3, showCustom = true }: PresetCardsProps) {
  const dark = useSystemDark()
  const payload = useTileDemoPayload(model)
  const matched = matchPreset(model)

  const card = (
    key: string,
    name: string,
    description: string,
    appearance: Pick<WidgetTabModel, "style" | "backdrop" | "textColors" | "toneModes">,
    selected: boolean,
    onSelect: (() => void) | null,
    custom = false
  ) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={name}
      data-preset={key}
      onClick={() => onSelect?.()}
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-lg border-[1.5px] bg-card p-1.5 text-left outline-none transition-colors",
        "focus-visible:ring-3 focus-visible:ring-ring/50",
        custom && "border-dashed",
        selected ? "border-primary ring-2 ring-primary/25" : "border-border hover:bg-muted/60"
      )}
    >
      <span
        className={cn(
          "flex h-14 min-w-0 items-center justify-center overflow-hidden rounded-md shadow-inner",
          STRIP_CLASS[dark ? "dark" : "light"]
        )}
      >
        <MenuBarImage
          payload={payload}
          dark={dark}
          style={appearance.style}
          backdrop={appearance.backdrop}
          colors={model.colors}
          textColors={appearance.textColors}
          toneModes={appearance.toneModes}
          heightPx={SAMPLE_HEIGHT_PX}
        />
      </span>
      <span className="flex items-baseline justify-between gap-2 px-1">
        <span className="truncate text-[13px] font-semibold text-foreground">{name}</span>
        <span className={cn("truncate text-[11px]", custom ? "text-primary" : "text-muted-foreground")}>
          {description}
        </span>
      </span>
    </button>
  )

  return (
    <div
      role="radiogroup"
      aria-label="Widget preset"
      data-testid="widget-preset-cards"
      className={cn("grid gap-2.5", columns === 2 ? "grid-cols-2" : "grid-cols-3")}
    >
      {WIDGET_PRESETS.map((preset) =>
        card(
          preset.id,
          preset.name,
          preset.description,
          resolvePreset(preset.id as WidgetPresetId, model),
          matched === preset.id,
          () => applyPreset(model, preset.id)
        )
      )}
      {showCustom && matched === "custom" && card("custom", "Custom", "Current", model, true, null, true)}
    </div>
  )
}
