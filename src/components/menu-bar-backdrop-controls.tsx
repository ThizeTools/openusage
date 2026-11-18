import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { useSystemDark } from "@/hooks/use-system-dark"
import { backdropCardColor } from "@/lib/menubar-widget-image"
import { isWindowsPlatform } from "@/lib/platform"
import type { MenuBarWidgetBackdrop } from "@/lib/settings"
import { cn } from "@/lib/utils"

const SLIDERS: { key: "opacity" | "glass" | "blur"; label: string; note?: string }[] = [
  { key: "opacity", label: "Opacity" },
  { key: "glass", label: "Glass" },
  { key: "blur", label: "Blur", note: "Real blur of the wallpaper behind the widget; only visible in the menu bar." },
]

/** "cards": rows on card backgrounds (original look). "compact": plain rows, label left / control right. */
export type BackdropControlsVariant = "cards" | "compact"

interface SliderRowProps {
  label: string
  note?: string
  value: number
  disabled?: boolean
  variant: BackdropControlsVariant
  onChange: (value: number) => void
}

/** Labeled range input (0..100) with its value at the right. */
function SliderRow({ label, note, value, disabled, variant, onChange }: SliderRowProps) {
  const compact = variant === "compact"
  return (
    <div className={compact ? "py-1" : "rounded-md bg-card px-3 py-2"}>
      <div className="flex items-center gap-3">
        <span className={cn("shrink-0 text-foreground", compact ? "flex-1 text-[13px]" : "w-16 text-sm")}>{label}</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={(event) => onChange(Number(event.target.value))}
          className={cn(
            "h-1.5 cursor-pointer accent-primary disabled:cursor-default disabled:opacity-50",
            compact ? "w-40 shrink-0" : "min-w-0 flex-1"
          )}
        />
        <span className="w-10 shrink-0 text-right font-mono text-xs text-muted-foreground">{value}%</span>
      </div>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

interface MenuBarBackdropControlsProps {
  backdrop: MenuBarWidgetBackdrop
  onChange: (value: MenuBarWidgetBackdrop) => void
  variant?: BackdropControlsVariant
}

/** "Show background" switch plus, when on: Auto / Custom color and the Opacity, Glass and Blur sliders. */
export function MenuBarBackdropControls({ backdrop, onChange, variant = "cards" }: MenuBarBackdropControlsProps) {
  const dark = useSystemDark()
  const compact = variant === "compact"
  const isCustom = backdrop.color !== "auto"
  const effectiveColor = backdropCardColor(dark, backdrop)
  const row = compact ? "flex items-center gap-3 py-1" : "flex items-center gap-3 rounded-md bg-card px-3 py-2"
  const text = compact ? "text-[13px]" : "text-sm"

  return (
    <div className={compact ? "divide-y divide-border/60" : "space-y-1"} data-testid="menu-bar-widget-backdrop">
      {compact ? (
        <label className={cn(row, text, "select-none text-foreground")}>
          <span className="flex-1">Show background</span>
          <Switch
            key={`backdrop-enabled-${backdrop.enabled}`}
            aria-label="Show background"
            checked={backdrop.enabled}
            onCheckedChange={(checked) => onChange({ ...backdrop, enabled: checked === true })}
          />
        </label>
      ) : (
        <label className="flex items-center gap-2 rounded-md bg-card px-3 py-2 text-sm select-none text-foreground">
          <Checkbox
            key={`backdrop-enabled-${backdrop.enabled}`}
            checked={backdrop.enabled}
            onCheckedChange={(checked) => onChange({ ...backdrop, enabled: checked === true })}
          />
          Show background
        </label>
      )}
      {backdrop.enabled && (
        <>
          <div className={row}>
            <span className={cn("flex-1 text-foreground", text)}>Color</span>
            {isCustom && (
              <>
                <label
                  className={cn(
                    "relative block size-6 shrink-0 cursor-pointer rounded-full",
                    "has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
                  )}
                >
                  <span
                    aria-hidden
                    className="block size-6 rounded-full border border-border shadow-xs transition-transform hover:scale-110"
                    style={{ backgroundColor: effectiveColor }}
                  />
                  <input
                    type="color"
                    aria-label="Background color"
                    value={effectiveColor}
                    onChange={(event) => onChange({ ...backdrop, color: event.target.value.toLowerCase() })}
                    className="absolute inset-0 size-full cursor-pointer opacity-0"
                  />
                </label>
                <span className="font-mono text-xs text-muted-foreground">{effectiveColor}</span>
              </>
            )}
            <div className="flex w-32 gap-1" role="radiogroup" aria-label="Background color mode">
              {(["auto", "custom"] as const).map((mode) => {
                const active = (mode === "custom") === isCustom
                return (
                  <Button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    variant={active ? "default" : "outline"}
                    size="xs"
                    className="flex-1"
                    onClick={() => {
                      if (active) return
                      onChange({ ...backdrop, color: mode === "auto" ? "auto" : effectiveColor })
                    }}
                  >
                    {mode === "auto" ? "Auto" : "Custom"}
                  </Button>
                )
              })}
            </div>
          </div>
          {SLIDERS.filter(({ key }) => key !== "blur" || !isWindowsPlatform()).map(({ key, label, note }) => (
            <SliderRow
              key={key}
              label={label}
              note={note}
              value={backdrop[key]}
              variant={variant}
              onChange={(value) => onChange({ ...backdrop, [key]: value })}
            />
          ))}
        </>
      )}
    </div>
  )
}
