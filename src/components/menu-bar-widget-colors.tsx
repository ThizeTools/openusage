import { useSystemDark } from "@/hooks/use-system-dark"
import { Button } from "@/components/ui/button"
import { defaultToneColors } from "@/lib/menubar-widget-image"
import {
  MENU_BAR_TEXT_COLOR_MODES,
  type MenuBarTextColorMode,
  type MenuBarWidgetColors,
  type MenuBarWidgetTextColors,
  type MenuBarWidgetToneModes,
} from "@/lib/settings"
import { cn } from "@/lib/utils"

const TONE_ROWS: { key: keyof MenuBarWidgetColors; label: string }[] = [
  { key: "ahead", label: "Healthy" },
  { key: "onTrack", label: "Close to limit" },
  { key: "behind", label: "Over pace" },
]

/** `hint` shows (compact variant) what the part is in the sample widget: "Used (13)", "Expected pace (/91)". */
const TEXT_ROWS: { key: keyof MenuBarWidgetTextColors; label: string; hint?: string }[] = [
  { key: "label", label: "Label" },
  { key: "used", label: "Used", hint: "(13)" },
  { key: "expected", label: "Expected pace", hint: "(/91)" },
]

/** "cards": rows on card backgrounds (original look). "compact": plain rows, label left / control right. */
export type ColorRowsVariant = "cards" | "compact"

const SECTION_HEADING = "pt-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"

const TEXT_MODE_LABELS: Record<MenuBarTextColorMode, string> = {
  mono: "Mono",
  color: "Color",
}

/** True when every text part is drawn in the content color, so the tone colors are unused. */
export function allTextMono(textColors: MenuBarWidgetTextColors): boolean {
  return TEXT_ROWS.every(({ key }) => textColors[key] === "mono")
}

interface ModeToggleProps {
  ariaLabel: string
  value: MenuBarTextColorMode
  onChange: (mode: MenuBarTextColorMode) => void
}

/** Small Mono / Color segmented control. */
function ModeToggle({ ariaLabel, value, onChange }: ModeToggleProps) {
  return (
    <div className="flex w-32 shrink-0 gap-1" role="radiogroup" aria-label={ariaLabel}>
      {MENU_BAR_TEXT_COLOR_MODES.map((mode) => {
        const isActive = value === mode
        return (
          <Button
            key={mode}
            type="button"
            role="radio"
            aria-checked={isActive}
            variant={isActive ? "default" : "outline"}
            size="xs"
            className="flex-1"
            onClick={() => onChange(mode)}
          >
            {TEXT_MODE_LABELS[mode]}
          </Button>
        )
      })}
    </div>
  )
}

interface MenuBarWidgetTextColorsProps {
  textColors: MenuBarWidgetTextColors
  onChange: (value: MenuBarWidgetTextColors) => void
  variant?: ColorRowsVariant
}

/** One row per text part with a small Mono / Color segmented control. */
export function MenuBarWidgetTextColorRows({ textColors, onChange, variant = "cards" }: MenuBarWidgetTextColorsProps) {
  const compact = variant === "compact"
  return (
    <div className={compact ? undefined : "space-y-1"} data-testid="menu-bar-widget-text-colors">
      {compact ? (
        <h5 className={SECTION_HEADING}>Text</h5>
      ) : (
        <h5 className="px-2 pt-1 text-xs font-medium text-muted-foreground">Text</h5>
      )}
      {TEXT_ROWS.map(({ key, label, hint }) => (
        <div
          key={key}
          className={cn("flex items-center gap-3", compact ? "min-h-7 py-0.5" : "rounded-md bg-card px-3 py-1.5")}
        >
          <span className={cn("flex-1 text-foreground", compact ? "text-[13px]" : "text-sm")}>
            {label}
            {compact && hint && <span className="ml-1 text-muted-foreground">{hint}</span>}
          </span>
          <ModeToggle
            ariaLabel={`${label} text color`}
            value={textColors[key]}
            onChange={(mode) => onChange({ ...textColors, [key]: mode })}
          />
        </div>
      ))}
    </div>
  )
}

interface MenuBarWidgetColorsProps {
  colors: MenuBarWidgetColors
  onChange: (value: MenuBarWidgetColors) => void
  toneModes: MenuBarWidgetToneModes
  onToneModesChange: (value: MenuBarWidgetToneModes) => void
  variant?: ColorRowsVariant
}

/** True when at least one tone has a custom color. */
export function hasCustomColors(colors: MenuBarWidgetColors): boolean {
  return TONE_ROWS.some(({ key }) => colors[key] !== undefined)
}

/**
 * One row per tone: swatch (opens the native color picker), Mono / Color, hex value, and Reset when customized.
 * Compact: a color dot, the name, Mono / Color, the swatch and Reset (no hex), under a "Colors" heading.
 */
export function MenuBarWidgetColorRows({
  colors,
  onChange,
  toneModes,
  onToneModesChange,
  variant = "cards",
}: MenuBarWidgetColorsProps) {
  const dark = useSystemDark()
  const defaults = defaultToneColors(dark)
  const compact = variant === "compact"

  return (
    <div className={compact ? undefined : "space-y-1"} data-testid="menu-bar-widget-colors">
      {compact && <h5 className={SECTION_HEADING}>Colors</h5>}
      {TONE_ROWS.map(({ key, label }) => {
        const custom = colors[key]
        const effective = custom ?? defaults[key]
        const toneMono = toneModes[key] === "mono"
        const picker = (
          <label
            className={cn(
              "relative block shrink-0 cursor-pointer",
              compact ? "h-5 w-8" : "size-6 rounded-full",
              toneMono && "opacity-50",
              "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
              compact && "rounded-md"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "block border border-border shadow-xs transition-transform hover:scale-110",
                compact ? "h-5 w-8 rounded-md" : "size-6 rounded-full"
              )}
              style={{ backgroundColor: effective }}
            />
            <input
              type="color"
              aria-label={`${label} color`}
              value={effective}
              onChange={(event) => onChange({ ...colors, [key]: event.target.value.toLowerCase() })}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
          </label>
        )
        const reset = (
          <span className="flex w-12 shrink-0 justify-end">
            {custom !== undefined && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label={`Reset ${label} color`}
                onClick={() => {
                  const next = { ...colors }
                  delete next[key]
                  onChange(next)
                }}
              >
                Reset
              </Button>
            )}
          </span>
        )
        const toggle = (
          <ModeToggle
            ariaLabel={`${label} tone mode`}
            value={toneModes[key]}
            onChange={(mode) => onToneModesChange({ ...toneModes, [key]: mode })}
          />
        )
        if (compact) {
          return (
            <div key={key} className="flex min-h-7 items-center gap-3 py-0.5">
              <span
                aria-hidden
                className={cn("size-2.5 shrink-0 rounded-full", toneMono && "opacity-50")}
                style={{ backgroundColor: effective }}
              />
              <span className="flex-1 text-[13px] text-foreground">{label}</span>
              {toggle}
              {picker}
              {reset}
            </div>
          )
        }
        return (
          <div key={key} className="flex items-center gap-3 rounded-md bg-card px-3 py-2">
            {picker}
            <span className="flex-1 text-sm text-foreground">{label}</span>
            {toggle}
            <span className={cn("font-mono text-xs text-muted-foreground", toneMono && "opacity-50")}>{effective}</span>
            {reset}
          </div>
        )
      })}
    </div>
  )
}
