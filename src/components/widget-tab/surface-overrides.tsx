import type { ReactNode } from "react"
import { ResetColorsButton, TextColorRows, ToneRows } from "@/components/widget-tab/color-rows"
import { ProvidersList } from "@/components/widget-tab/providers-list"
import type { WidgetTabModel } from "@/components/widget-tab/types"
import { useSurfaceOverrides } from "@/components/widget-tab/use-surface-overrides"
import { Switch } from "@/components/ui/switch"
import { isMacPlatform, widgetSurfaceName } from "@/lib/platform"
import {
  effectiveColors,
  effectiveProviders,
  type SurfaceOverrides as SurfaceOverridesValue,
  type WidgetSurface,
} from "@/lib/settings"

/** The model as one surface sees it: its own providers / colors where overridden, the global ones otherwise. */
export function withOverrides(model: WidgetTabModel, overrides: SurfaceOverridesValue): WidgetTabModel {
  return {
    ...model,
    ...effectiveProviders({ providerIds: model.providerIds, providerMetrics: model.providerMetrics }, overrides),
    ...effectiveColors(
      { colors: model.colors, textColors: model.textColors, toneModes: model.toneModes },
      overrides
    ),
  }
}

function OverrideRow({
  title,
  description,
  checked,
  onCheckedChange,
  children,
}: {
  title: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  children?: ReactNode
}) {
  return (
    <div className="px-3 py-2.5">
      <label className="flex items-center gap-3 select-none">
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] text-foreground">{title}</span>
          <span className="block text-[12px] text-muted-foreground">{description}</span>
        </span>
        <Switch
          key={`override-${title}-${checked}`}
          aria-label={title}
          checked={checked}
          onCheckedChange={(next) => onCheckedChange(next === true)}
        />
      </label>
      {children}
    </div>
  )
}

export interface SurfaceOverridesProps {
  /** The global model: the starting values when a switch is turned on, and the plugin list. */
  model: WidgetTabModel
  surface: WidgetSurface
  overrides: SurfaceOverridesValue
  onChange: (value: SurfaceOverridesValue) => void
}

/** "Overrides" card of the Dock / Menu Bar panes: own providers and own colors, each off = the global tab's value. */
export function SurfaceOverrides({ model, surface, overrides, onChange }: SurfaceOverridesProps) {
  const own = overrides.providers
  const ownColors = overrides.colors

  const providersModel = own && {
    ...model,
    providerIds: own.providerIds,
    onProviderIdsChange: (providerIds: typeof own.providerIds) =>
      onChange({ ...overrides, providers: { ...own, providerIds } }),
    providerMetrics: own.providerMetrics,
    onProviderMetricsChange: (providerMetrics: typeof own.providerMetrics) =>
      onChange({ ...overrides, providers: { ...own, providerMetrics } }),
  }

  const colorsModel = ownColors && {
    ...model,
    colors: ownColors.colors,
    onColorsChange: (colors: typeof ownColors.colors) => onChange({ ...overrides, colors: { ...ownColors, colors } }),
    textColors: ownColors.textColors,
    onTextColorsChange: (textColors: typeof ownColors.textColors) =>
      onChange({ ...overrides, colors: { ...ownColors, textColors } }),
    toneModes: ownColors.toneModes,
    onToneModesChange: (toneModes: typeof ownColors.toneModes) =>
      onChange({ ...overrides, colors: { ...ownColors, toneModes } }),
  }

  return (
    <div
      className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-card"
      data-testid={`surface-overrides-${surface}`}
    >
      <h3 className="px-3 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Overrides
      </h3>
      <OverrideRow
        title="Own providers"
        description="Off: uses the Providers tab."
        checked={own !== null}
        onCheckedChange={(on) =>
          onChange({
            ...overrides,
            providers: on ? { providerIds: model.providerIds, providerMetrics: model.providerMetrics } : null,
          })
        }
      >
        {providersModel && (
          <div className="pt-1">
            <ProvidersList model={providersModel} variant="compact" />
          </div>
        )}
      </OverrideRow>
      <OverrideRow
        title="Own colors"
        description="Off: uses the Colors tab. Pace thresholds always come from Colors."
        checked={ownColors !== null}
        onCheckedChange={(on) =>
          onChange({
            ...overrides,
            colors: on ? { colors: model.colors, textColors: model.textColors, toneModes: model.toneModes } : null,
          })
        }
      >
        {colorsModel && (
          <div className="pt-1">
            <ToneRows model={colorsModel} />
            <TextColorRows model={colorsModel} />
            <div className="flex justify-end pt-1">
              <ResetColorsButton model={colorsModel} />
            </div>
          </div>
        )}
      </OverrideRow>
    </div>
  )
}

/** Names the surfaces that override a global tab ("Dock and Menu Bar use their own colors."); nothing when none does. */
export function OverrideNote({ part }: { part: "providers" | "colors" }) {
  const [menuBar] = useSurfaceOverrides("menuBar")
  const [dock] = useSurfaceOverrides("dock")
  const names = [
    ...(isMacPlatform() && dock[part] ? ["Dock"] : []),
    ...(menuBar[part] ? [widgetSurfaceName() === "menu bar" ? "Menu Bar" : "Taskbar"] : []),
  ]
  if (names.length === 0) return null
  const text =
    names.length === 1 ? `${names[0]} uses its own ${part}.` : `${names.join(" and ")} use their own ${part}.`
  return (
    <p className="pt-2 text-[12px] text-muted-foreground" data-testid="override-note">
      {text}
    </p>
  )
}
