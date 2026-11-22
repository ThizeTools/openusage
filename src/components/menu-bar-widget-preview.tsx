import { useEffect, useId, useMemo, useState } from "react"
import { CheckIcon } from "lucide-react"
import { useSystemDark } from "@/hooks/use-system-dark"
import { renderMenuBarWidgetPng } from "@/lib/menubar-widget-image"
import {
  MENU_BAR_WIDGET_STYLES,
  type MenuBarAccountLabel,
  type MenuBarWidgetBackdrop,
  type MenuBarWidgetColors,
  type MenuBarWidgetStyle,
  type MenuBarWidgetTextColors,
  type MenuBarWidgetToneModes,
} from "@/lib/settings"
import type { TaskbarItem, TaskbarPayload } from "@/lib/taskbar-payload"
import { cn } from "@/lib/utils"

export const MENU_BAR_STYLE_LABELS: Record<MenuBarWidgetStyle, string> = {
  stacked: "Stacked",
  compact: "Compact",
  inline: "Inline",
  "inline-compact": "Inline compact",
}

export const MENU_BAR_STYLE_DESCRIPTIONS: Record<MenuBarWidgetStyle, string> = {
  stacked: "Session above Weekly with full labels",
  compact: "Two rows, one-letter labels",
  inline: "One row with full labels",
  "inline-compact": "One row, one-letter labels",
}

const DEMO_ITEMS: TaskbarItem[] = [
  { label: "Session", value: "13%/91%", tone: "ahead" },
  { label: "Weekly", value: "94%/61%", tone: "behind" },
]

/** The widget is 22pt tall; the samples are shown 1.6x larger so they stay legible. */
export const SAMPLE_HEIGHT_PX = 35
export const SAMPLE_RENDER_SCALE = 3
/** Height of the dense thumbnails. */
const THUMB_HEIGHT_PX = 28

/** One provider with the demo metrics; the icon is optional. */
export function buildDemoPayload(iconMask: string | null): TaskbarPayload {
  return { providers: [{ id: "demo", iconMask, items: DEMO_ITEMS }], tooltip: "" }
}

/** Mimics a macOS menu bar over wallpaper. */
export const STRIP_CLASS = {
  dark: "bg-linear-to-br from-[#40434f] via-[#2b2d36] to-[#1b1c22]",
  light: "bg-linear-to-br from-[#f4f4f6] via-[#e6e6ea] to-[#d4d4da]",
} as const

export interface AppearanceProps {
  backdrop: MenuBarWidgetBackdrop
  colors: MenuBarWidgetColors
  textColors: MenuBarWidgetTextColors
  toneModes: MenuBarWidgetToneModes
}

/**
 * Renders the real menu bar PNG and shows it at `heightPx` CSS pixels tall. Renders `payload` when given,
 * else the single-provider demo (`buildDemoPayload(iconMask)`).
 */
export function MenuBarImage({
  iconMask = null,
  payload: payloadProp,
  dark,
  style,
  backdrop,
  colors,
  textColors,
  toneModes,
  accountLabel,
  heightPx,
}: AppearanceProps & {
  iconMask?: string | null
  payload?: TaskbarPayload
  /** How providers with an `accountName` show it. */
  accountLabel?: MenuBarAccountLabel
  dark: boolean
  style: MenuBarWidgetStyle
  heightPx: number
}) {
  const [png, setPng] = useState<string | null>(null)
  const payload = useMemo(() => payloadProp ?? buildDemoPayload(iconMask), [payloadProp, iconMask])
  // Callers pass a fresh object per render; key the effect on the content.
  const backdropKey = JSON.stringify(backdrop)
  const colorsKey = JSON.stringify(colors)
  const textColorsKey = JSON.stringify(textColors)
  const toneModesKey = JSON.stringify(toneModes)

  useEffect(() => {
    let cancelled = false
    void renderMenuBarWidgetPng(payload, {
      dark,
      style,
      backdrop: JSON.parse(backdropKey) as MenuBarWidgetBackdrop,
      colors: JSON.parse(colorsKey) as MenuBarWidgetColors,
      textColors: JSON.parse(textColorsKey) as MenuBarWidgetTextColors,
      toneModes: JSON.parse(toneModesKey) as MenuBarWidgetToneModes,
      accountLabel,
      scale: SAMPLE_RENDER_SCALE,
    })
      .then((result) => {
        if (!cancelled) setPng(result)
      })
      .catch((error) => console.error("Failed to render menu bar widget preview:", error))
    return () => {
      cancelled = true
    }
  }, [payload, dark, style, accountLabel, backdropKey, colorsKey, textColorsKey, toneModesKey])

  if (!png) return <div style={{ height: heightPx }} aria-hidden />
  return (
    <img
      src={`data:image/png;base64,${png}`}
      alt=""
      style={{ height: heightPx }}
      className="max-w-full object-contain object-left"
      draggable={false}
    />
  )
}

interface MenuBarStylePickerProps extends AppearanceProps {
  style: MenuBarWidgetStyle
  /** "tiles" (default): 2x2 cards with a description. "thumbs": 2x2 compact thumbnails with the name below. */
  variant?: "tiles" | "thumbs"
  /** What every sample shows (normally the first selected provider with two metrics, see `useTileDemoPayload`). */
  payload: TaskbarPayload
  onStyleChange: (value: MenuBarWidgetStyle) => void
}

/**
 * 2x2 grid of selectable tiles, one per style. Every sample is the real rendered widget
 * with the current background and colors (without the native blur), so each option shows its effect live.
 */
export function MenuBarStylePicker({
  style,
  backdrop,
  colors,
  textColors,
  toneModes,
  payload,
  variant = "tiles",
  onStyleChange,
}: MenuBarStylePickerProps) {
  const dark = useSystemDark()
  const idPrefix = useId()
  const thumbs = variant === "thumbs"

  return (
    <div
      role="radiogroup"
      aria-label="Menu bar style"
      data-testid="menu-bar-widget-preview"
      className={cn("grid gap-1", thumbs ? "grid-cols-2 gap-2" : "grid-cols-2")}
    >
      {MENU_BAR_WIDGET_STYLES.map((option) => {
        const selected = option === style
        const descriptionId = `${idPrefix}-${option}`
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={MENU_BAR_STYLE_LABELS[option]}
            aria-describedby={descriptionId}
            onClick={() => onStyleChange(option)}
            className={cn(
              "relative flex min-w-0 flex-col rounded-md border bg-card text-left outline-none transition-colors",
              thumbs ? "gap-1 p-1.5" : "gap-2 p-2",
              "focus-visible:ring-3 focus-visible:ring-ring/50",
              selected ? "border-primary ring-2 ring-primary" : "border-transparent hover:border-border hover:bg-muted/60"
            )}
          >
            <span
              className={cn(
                "flex min-w-0 items-center overflow-hidden rounded-md shadow-inner",
                thumbs ? "h-12 justify-center px-2" : "h-14 px-3",
                STRIP_CLASS[dark ? "dark" : "light"]
              )}
            >
              <MenuBarImage
                payload={payload}
                dark={dark}
                style={option}
                backdrop={backdrop}
                colors={colors}
                textColors={textColors}
                toneModes={toneModes}
                heightPx={thumbs ? THUMB_HEIGHT_PX : SAMPLE_HEIGHT_PX}
              />
            </span>
            {thumbs ? (
              <span className="block px-0.5 text-center">
                <span className="block text-xs font-medium text-foreground">{MENU_BAR_STYLE_LABELS[option]}</span>
                <span id={descriptionId} className="sr-only">
                  {MENU_BAR_STYLE_DESCRIPTIONS[option]}
                </span>
              </span>
            ) : (
              <span className="block px-0.5">
                <span className="block text-sm font-medium text-foreground">{MENU_BAR_STYLE_LABELS[option]}</span>
                <span id={descriptionId} className="block text-xs text-muted-foreground">
                  {MENU_BAR_STYLE_DESCRIPTIONS[option]}
                </span>
              </span>
            )}
            {selected && !thumbs && (
              <span
                aria-hidden
                className="absolute right-3.5 top-3.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm"
              >
                <CheckIcon className="size-3" strokeWidth={3} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
