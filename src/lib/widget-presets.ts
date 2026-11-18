import type {
  MenuBarWidgetBackdrop,
  MenuBarWidgetStyle,
  MenuBarWidgetTextColors,
  MenuBarWidgetToneModes,
} from "@/lib/settings"

export const WIDGET_PRESET_IDS = ["default", "minimal", "traffic-light", "glass", "solid-pill", "mono"] as const
export type WidgetPresetId = (typeof WIDGET_PRESET_IDS)[number]

/** What a preset sets. Custom tone colors (`menuBarWidgetColors`) are never touched. */
export interface WidgetPresetSettings {
  style: MenuBarWidgetStyle
  /**
   * Only the fields a preset cares about: "no background" is just `{ enabled: false }`, so the user's
   * color / opacity / glass / blur values survive and come back when the background is turned on again.
   */
  backdrop: Partial<MenuBarWidgetBackdrop>
  textColors: MenuBarWidgetTextColors
  toneModes: MenuBarWidgetToneModes
}

export interface WidgetPreset {
  id: WidgetPresetId
  name: string
  description: string
  settings: WidgetPresetSettings
}

/** The values a preset can be compared with / applied to (a slice of `WidgetTabModel`). */
export interface WidgetPresetTarget {
  style: MenuBarWidgetStyle
  backdrop: MenuBarWidgetBackdrop
  textColors: MenuBarWidgetTextColors
  toneModes: MenuBarWidgetToneModes
}

/** A `WidgetPresetTarget` plus the change handlers `applyPreset` calls. */
export interface WidgetPresetModel extends WidgetPresetTarget {
  onStyleChange: (value: MenuBarWidgetStyle) => void
  onBackdropChange: (value: MenuBarWidgetBackdrop) => void
  onTextColorsChange: (value: MenuBarWidgetTextColors) => void
  onToneModesChange: (value: MenuBarWidgetToneModes) => void
}

const MONO_TEXT: MenuBarWidgetTextColors = { label: "mono", used: "mono", expected: "mono" }
const MONO_TONES: MenuBarWidgetToneModes = { ahead: "mono", onTrack: "mono", behind: "mono" }
const COLOR_TONES: MenuBarWidgetToneModes = { ahead: "color", onTrack: "color", behind: "color" }
/** Same as DEFAULT_MENU_BAR_WIDGET_TEXT_COLORS / _TONE_MODES in settings.ts. */
const DEFAULT_TEXT: MenuBarWidgetTextColors = { label: "mono", used: "color", expected: "mono" }
const DEFAULT_TONES: MenuBarWidgetToneModes = { ahead: "mono", onTrack: "color", behind: "color" }

export const WIDGET_PRESETS: readonly WidgetPreset[] = [
  {
    id: "default",
    name: "Default",
    description: "Recommended",
    settings: {
      style: "compact",
      backdrop: { enabled: true, color: "auto", opacity: 0, glass: 0, blur: 50 },
      textColors: DEFAULT_TEXT,
      toneModes: DEFAULT_TONES,
    },
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Inline, mono",
    settings: { style: "inline-compact", backdrop: { enabled: false }, textColors: MONO_TEXT, toneModes: MONO_TONES },
  },
  {
    id: "traffic-light",
    name: "Traffic light",
    description: "All states",
    settings: {
      style: "compact",
      backdrop: { enabled: false },
      textColors: { label: "mono", used: "color", expected: "color" },
      toneModes: COLOR_TONES,
    },
  },
  {
    id: "glass",
    name: "Glass",
    description: "Frosted, blur 80%",
    settings: {
      style: "compact",
      backdrop: { enabled: true, color: "auto", opacity: 15, glass: 60, blur: 80 },
      textColors: DEFAULT_TEXT,
      toneModes: DEFAULT_TONES,
    },
  },
  {
    id: "solid-pill",
    name: "Solid pill",
    description: "Dark fill",
    settings: {
      style: "inline-compact",
      backdrop: { enabled: true, color: "auto", opacity: 92, glass: 0, blur: 0 },
      textColors: DEFAULT_TEXT,
      toneModes: DEFAULT_TONES,
    },
  },
  {
    id: "mono",
    name: "Mono",
    description: "White only",
    settings: {
      style: "stacked",
      backdrop: { enabled: true, color: "auto", opacity: 0, glass: 0, blur: 50 },
      textColors: MONO_TEXT,
      toneModes: MONO_TONES,
    },
  },
]

export function getWidgetPreset(id: WidgetPresetId): WidgetPreset {
  const preset = WIDGET_PRESETS.find((candidate) => candidate.id === id)
  if (!preset) throw new Error(`Unknown widget preset "${id}"`)
  return preset
}

/** The backdrop `current` becomes under a preset: the preset's fields over the user's own values. */
export function presetBackdrop(id: WidgetPresetId, current: MenuBarWidgetBackdrop): MenuBarWidgetBackdrop {
  return { ...current, ...getWidgetPreset(id).settings.backdrop }
}

/** What a model looks like with a preset applied (pure; colors are not part of a preset). */
export function resolvePreset(id: WidgetPresetId, current: WidgetPresetTarget): WidgetPresetTarget {
  const { settings } = getWidgetPreset(id)
  return {
    style: settings.style,
    backdrop: presetBackdrop(id, current.backdrop),
    textColors: { ...settings.textColors },
    toneModes: { ...settings.toneModes },
  }
}

function sameFields<T extends object>(a: T, b: Partial<T>): boolean {
  return (Object.keys(b) as (keyof T)[]).every((key) => a[key] === b[key])
}

/** The preset whose settings equal `settings`, or "custom". A background-less preset ignores slider values. */
export function matchPreset(settings: WidgetPresetTarget): WidgetPresetId | "custom" {
  for (const preset of WIDGET_PRESETS) {
    const wanted = preset.settings
    if (
      settings.style === wanted.style &&
      sameFields(settings.backdrop, wanted.backdrop) &&
      sameFields(settings.textColors, wanted.textColors) &&
      sameFields(settings.toneModes, wanted.toneModes)
    ) {
      return preset.id
    }
  }
  return "custom"
}

/** Applies a preset through the model's handlers (only the ones whose value changes). Colors stay as they are. */
export function applyPreset(model: WidgetPresetModel, id: WidgetPresetId): void {
  const next = resolvePreset(id, model)
  if (next.style !== model.style) model.onStyleChange(next.style)
  if (JSON.stringify(next.backdrop) !== JSON.stringify(model.backdrop)) model.onBackdropChange(next.backdrop)
  if (JSON.stringify(next.textColors) !== JSON.stringify(model.textColors)) model.onTextColorsChange(next.textColors)
  if (JSON.stringify(next.toneModes) !== JSON.stringify(model.toneModes)) model.onToneModesChange(next.toneModes)
}
