import { useState, type ComponentType } from "react"
import { ContrastIcon, DockIcon, PanelTopIcon, SquareCheckBigIcon } from "lucide-react"
import { BackdropControls } from "@/components/widget-tab/backdrop-controls"
import { ResetColorsButton, TextColorRows, ToneRows } from "@/components/widget-tab/color-rows"
import { MenuBarPreviewStrip } from "@/components/widget-tab/menu-bar-preview-strip"
import { DockOverlaySection } from "@/components/widget-tab/dock-overlay-section"
import { PaceThresholds } from "@/components/widget-tab/pace-thresholds"
import { ProvidersList } from "@/components/widget-tab/providers-list"
import { Section } from "@/components/widget-tab/section"
import { StylePicker } from "@/components/widget-tab/style-picker"
import { summarizeBackdrop, summarizeStyle } from "@/components/widget-tab/summaries"
import { OverrideNote, SurfaceOverrides, withOverrides } from "@/components/widget-tab/surface-overrides"
import type { WidgetTabLayoutProps, WidgetTabModel } from "@/components/widget-tab/types"
import { useSurfaceOverrides } from "@/components/widget-tab/use-surface-overrides"
import { Switch } from "@/components/ui/switch"
import { isMacPlatform, widgetSurfaceName } from "@/lib/platform"
import { cn } from "@/lib/utils"

type SectionId = "layout" | "background"
type PaneId = "providers" | "dock" | "menubar" | "colors"

const PANE_HEADING = "pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"

/** The Menu Bar / Taskbar pane: preview, visibility switch, the Layout / Background accordion, then the overrides. */
function MenuBarPane({ globalModel, surface }: { globalModel: WidgetTabModel; surface: string }) {
  const [overrides, setOverrides] = useSurfaceOverrides("menuBar")
  // The preview follows this surface's own providers / colors.
  const model = withOverrides(globalModel, overrides)
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
    <div className="space-y-3">
      <MenuBarPreviewStrip model={model} label="Live preview" />

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
        <Section title="Layout" summary={summarizeStyle(model.style)} {...sectionProps("layout")}>
          <StylePicker model={model} variant="thumbs" />
        </Section>
        <Section title="Background" summary={summarizeBackdrop(model.backdrop)} {...sectionProps("background")}>
          <BackdropControls model={model} />
        </Section>
      </div>

      <SurfaceOverrides model={globalModel} surface="menuBar" overrides={overrides} onChange={setOverrides} />
    </div>
  )
}

/** The Colors pane: pace thresholds, tone colors and text colors. Global unless a surface overrides the colors. */
function ColorsPane({ model }: { model: WidgetTabModel }) {
  return (
    <>
      <div className="space-y-3 rounded-lg border border-border/60 bg-card px-3 py-3" data-testid="widget-colors">
        <div>
          <h3 className={PANE_HEADING}>Pace thresholds</h3>
          <PaceThresholds />
        </div>
        <div>
          <ToneRows model={model} />
          <TextColorRows model={model} />
          <div className="flex justify-end pt-1">
            <ResetColorsButton model={model} />
          </div>
        </div>
      </div>
      <OverrideNote part="colors" />
    </>
  )
}

/**
 * Widget tab, "sidebar" layout: a vertical nav (Providers, Dock on macOS, Menu Bar / Taskbar, Colors) and the pane of
 * the selected item. Providers and Colors apply to every surface (widget and Dock overlay) unless it overrides them.
 */
export function LayoutHybrid({ model }: WidgetTabLayoutProps) {
  const surface = widgetSurfaceName()
  const [selected, setSelected] = useState<PaneId>("providers")

  const panes: { id: PaneId; name: string; Icon: ComponentType<{ className?: string }> }[] = [
    { id: "providers", name: "Providers", Icon: SquareCheckBigIcon },
    ...(isMacPlatform() ? [{ id: "dock" as const, name: "Dock", Icon: DockIcon }] : []),
    { id: "menubar", name: surface === "menu bar" ? "Menu Bar" : "Taskbar", Icon: PanelTopIcon },
    { id: "colors", name: "Colors", Icon: ContrastIcon },
  ]

  return (
    <div className="flex items-start gap-4 pt-3" data-testid="widget-layout-hybrid">
      <div role="tablist" aria-orientation="vertical" aria-label="Widget settings" className="flex w-[136px] shrink-0 flex-col gap-0.5">
        {panes.map(({ id, name, Icon }) => {
          const active = selected === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`widget-nav-${id}`}
              aria-selected={active}
              aria-controls="widget-pane"
              onClick={() => setSelected(id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] outline-none transition-colors",
                "focus-visible:ring-3 focus-visible:ring-ring/50",
                active ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/60"
              )}
            >
              <Icon className="size-4 shrink-0" />
              {name}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" id="widget-pane" aria-labelledby={`widget-nav-${selected}`} className="min-w-0 flex-1">
        {selected === "providers" && (
          <>
            <div className="overflow-hidden rounded-lg border border-border/60 bg-card px-3 py-2" data-testid="widget-providers">
              <ProvidersList model={model} variant="compact" />
            </div>
            <OverrideNote part="providers" />
          </>
        )}
        {selected === "dock" && <DockOverlaySection model={model} />}
        {selected === "menubar" && <MenuBarPane globalModel={model} surface={surface} />}
        {selected === "colors" && <ColorsPane model={model} />}
      </div>
    </div>
  )
}
