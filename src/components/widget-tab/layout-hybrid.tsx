import { useState } from "react"
import { BackdropControls } from "@/components/widget-tab/backdrop-controls"
import { ResetColorsButton, TextColorRows, ToneRows } from "@/components/widget-tab/color-rows"
import { MenuBarPreviewStrip } from "@/components/widget-tab/menu-bar-preview-strip"
import { PresetCards } from "@/components/widget-tab/preset-cards"
import { ProvidersList } from "@/components/widget-tab/providers-list"
import { Section } from "@/components/widget-tab/section"
import { StylePicker } from "@/components/widget-tab/style-picker"
import { summarizeBackdrop, summarizeColors, summarizeProviders, summarizeStyle } from "@/components/widget-tab/summaries"
import type { WidgetTabLayoutProps, WidgetTabModel } from "@/components/widget-tab/types"
import { Switch } from "@/components/ui/switch"
import { widgetSurfaceName } from "@/lib/platform"
import { matchPreset, WIDGET_PRESETS } from "@/lib/widget-presets"

type SectionId = "layout" | "background" | "colors" | "providers"

/** Name of the preset the model matches ("Default", ..., "Custom"). */
function currentPresetName(model: WidgetTabModel): string {
  const matched = matchPreset(model)
  if (matched === "custom") return "Custom"
  return WIDGET_PRESETS.find((preset) => preset.id === matched)?.name ?? "Custom"
}

/**
 * Layout "Hybrid": presets and the accordion as one page. Pinned preview, the visibility switch, then a single
 * grouped card: a "Presets" row (always open: the presets as a 3-column grid of cards, the matching preset named on the right)
 * followed by the Layout / Background / Colors / Providers accordion rows with their summaries. Choosing a preset
 * updates the summaries; editing a section leaves no preset selected and the row reads "Custom" (no extra card, so
 * the grid never changes height while editing).
 */
export function LayoutHybrid({ model }: WidgetTabLayoutProps) {
  const surface = widgetSurfaceName()
  const [openSections, setOpenSections] = useState<ReadonlySet<SectionId>>(new Set())
  const sectionProps = (id: SectionId) => ({
    open: openSections.has(id),
    onOpenChange: (open: boolean) =>
      setOpenSections((current) => {
        const next = new Set(current)
        if (open) next.add(id)
        else next.delete(id)
        return next
      }),
  })

  return (
    <div className="space-y-3" data-testid="widget-layout-hybrid">
      {/* Opaque band so the content scrolls under the pinned preview; the ::before repeats the window's dark tint. */}
      <div className="sticky top-0 z-10 -mx-4 bg-card px-4 pb-1 pt-3 before:absolute before:inset-0 before:-z-10 dark:before:bg-muted/30">
        <MenuBarPreviewStrip model={model} label="Live preview" />
      </div>

      <label className="flex min-h-10 items-center gap-3 rounded-lg border border-border/60 bg-card px-3 text-[13px] text-foreground select-none">
        <span className="flex-1">Show widget in {surface}</span>
        <Switch
          key={`widget-visible-${model.visible}`}
          aria-label={`Show widget in ${surface}`}
          checked={model.visible}
          onCheckedChange={(checked) => model.onVisibleChange(checked === true)}
        />
      </label>

      <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
        <div className="bg-card" data-testid="widget-presets-row">
          <div className="flex min-h-10 items-center gap-2.5 px-3">
            <h3 className="text-[13px] font-semibold text-foreground">Presets</h3>
            <span className="ml-auto min-w-0 truncate text-[13px] text-muted-foreground" data-testid="preset-summary">
              {currentPresetName(model)}
            </span>
          </div>
          <div className="px-3 pb-3 pt-0.5">
            <PresetCards model={model} columns={3} showCustom={false} />
          </div>
        </div>
        <Section title="Layout" summary={summarizeStyle(model.style)} {...sectionProps("layout")}>
          <StylePicker model={model} variant="thumbs" />
        </Section>
        <Section title="Background" summary={summarizeBackdrop(model.backdrop)} {...sectionProps("background")}>
          <BackdropControls model={model} />
        </Section>
        <Section
          title="Colors"
          summary={summarizeColors(model.textColors, model.toneModes)}
          {...sectionProps("colors")}
        >
          <TextColorRows model={model} />
          <ToneRows model={model} />
          <div className="flex justify-end pt-1">
            <ResetColorsButton model={model} />
          </div>
        </Section>
        <Section
          title="Providers"
          summary={summarizeProviders(model.plugins, model.providerIds)}
          {...sectionProps("providers")}
        >
          <ProvidersList model={model} variant="compact" />
        </Section>
      </div>
    </div>
  )
}
