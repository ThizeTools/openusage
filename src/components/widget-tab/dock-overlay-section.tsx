import { useEffect, useMemo, useState } from "react"
import { selectDemoProviders, DEFAULT_DEMO_TONES, type DemoTone } from "@/components/widget-tab/demo-payload"
import { SurfaceOverrides, withOverrides } from "@/components/widget-tab/surface-overrides"
import type { WidgetTabModel } from "@/components/widget-tab/types"
import { useSurfaceOverrides } from "@/components/widget-tab/use-surface-overrides"
import { accountLabel, claudeAccountId } from "@/lib/claude-desktop"
import { dockBundleIdsFor } from "@/lib/dock-apps"
import { renderDockOverlayPng } from "@/lib/dock-overlay-image"
import {
  DEFAULT_DOCK_OVERLAY_ACCOUNT_LABEL,
  DEFAULT_DOCK_OVERLAY_STYLE,
  loadDockOverlayAccountLabel,
  loadDockOverlayStyle,
  saveDockOverlayAccountLabel,
  saveDockOverlayStyle,
  type DockOverlayAccountLabel,
  type DockOverlayStyle,
} from "@/lib/settings"
import type { TaskbarProvider } from "@/lib/taskbar-payload"
import { cn } from "@/lib/utils"

const OPTIONS: { id: DockOverlayStyle; name: string }[] = [
  { id: "off", name: "Off" },
  { id: "pill", name: "Values" },
]

const ACCOUNT_OPTIONS: { id: DockOverlayAccountLabel; name: string }[] = [
  { id: "off", name: "Off" },
  { id: "initial", name: "Initial" },
  { id: "tag", name: "Tag" },
  { id: "pill", name: "In pill" },
]

/** Demo used / expected fractions per tone (same numbers as the widget demo: 13%/91%, 78%/70%, 94%/61%). */
const DEMO_FRACTIONS: Record<DemoTone, { fraction: number; expectedFraction: number }> = {
  ahead: { fraction: 0.13, expectedFraction: 0.91 },
  "on-track": { fraction: 0.78, expectedFraction: 0.7 },
  behind: { fraction: 0.94, expectedFraction: 0.61 },
}
const FALLBACK_BRAND_COLOR = "#3a3a3c"
const DOCK_WALLPAPER = "linear-gradient(120deg,#2a1747 0%,#4a1f5e 55%,#1d1038 100%)"

type PreviewProvider = {
  id: string
  name: string
  brandColor: string
  iconUrl: string | undefined
  /** False when the provider has no Dock app: drawn dimmed, without overlay. */
  hasDockApp: boolean
  overlay: TaskbarProvider
}

/** The providers of the widget as Dock tiles, each with the demo overlay data (tones cycle over the whole Dock). */
function buildPreviewProviders(model: WidgetTabModel): PreviewProvider[] {
  let index = 0
  return selectDemoProviders(model).map((provider) => {
    const meta = model.pluginsMeta.find((candidate) => candidate.id === provider.id)
    const hasDockApp = provider.id === "demo" || dockBundleIdsFor(provider.id).length > 0
    const items = provider.labels.map((label) => {
      const tone = DEFAULT_DEMO_TONES[index++ % DEFAULT_DEMO_TONES.length]
      return { label, value: "", tone, ...DEMO_FRACTIONS[tone] }
    })
    return {
      id: provider.id,
      name: meta?.name ?? provider.id,
      brandColor: meta?.brandColor ?? FALLBACK_BRAND_COLOR,
      iconUrl: provider.iconUrl,
      hasDockApp,
      overlay: { id: provider.id, items },
    }
  })
}

/** "Cursor has no Dock app." / "X and Y have no Dock app."; empty when every provider has one. */
function noDockAppNote(names: string[]): string {
  if (names.length === 0) return ""
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
  return `${list} ${names.length === 1 ? "has" : "have"} no Dock app.`
}

/**
 * One fake Dock tile. The overlay PNG (140-unit canvas) maps over the 100-unit tile: 140% size, shifted back by 20%.
 * The visible squircle in the PNG is inset 9.75% with radius 18.5 units (23% of the 80.5-unit square).
 */
function DockTile({ provider, png }: { provider: PreviewProvider; png: string | null }) {
  const icon = provider.iconUrl ? `url(${provider.iconUrl})` : undefined
  return (
    <span
      data-testid={`dock-tile-${provider.id}`}
      className={cn("relative block size-14 shrink-0", !provider.hasDockApp && "opacity-35")}
      title={provider.name}
    >
      <span
        className="absolute inset-[9.75%] flex items-center justify-center rounded-[23%]"
        style={{ backgroundColor: provider.brandColor }}
      >
        <span
          aria-hidden
          className="size-1/2 bg-white"
          style={{
            WebkitMaskImage: icon,
            WebkitMaskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskImage: icon,
            maskSize: "contain",
            maskRepeat: "no-repeat",
            maskPosition: "center",
          }}
        />
      </span>
      {png && (
        <img
          alt=""
          aria-hidden
          src={`data:image/png;base64,${png}`}
          className="pointer-events-none absolute -left-[20%] -top-[20%] size-[140%] max-w-none"
        />
      )}
    </span>
  )
}

/** Tiny picture of what a style draws, for the option cards. */
function StyleGlyph({ id }: { id: DockOverlayStyle }) {
  if (id === "off") return <span className="text-base leading-6 text-muted-foreground">–</span>
  return (
    <span className="relative block size-6 rounded-md bg-muted-foreground/60">
      <span className="absolute inset-x-0.5 -bottom-0.5 h-2 rounded-full border border-white/30 bg-neutral-800" />
    </span>
  )
}

/** Tiny picture of where an account name is drawn, for the option cards. */
function AccountGlyph({ id }: { id: DockOverlayAccountLabel }) {
  if (id === "off") return <span className="text-base leading-6 text-muted-foreground">–</span>
  return (
    <span className="relative block size-6 rounded-md bg-muted-foreground/60">
      {id === "initial" && (
        <span className="absolute -left-1 -top-1 size-2.5 rounded-full border border-white/30 bg-neutral-800" />
      )}
      {id === "tag" && (
        <span className="absolute inset-x-1 -top-1 h-1.5 rounded-full border border-white/30 bg-neutral-800" />
      )}
      {id === "pill" && (
        <span className="absolute inset-x-0.5 -bottom-1 h-3.5 rounded-md border border-white/30 bg-neutral-800" />
      )}
    </span>
  )
}

/**
 * "Dock" pane of the Widget tab (macOS): a live fake Dock with one tile per provider of the widget, then the style
 * picker for how usage is drawn over each provider's app icon in the real Dock, the account name picker (several
 * Claude accounts registered), then the Dock's overrides.
 */
export function DockOverlaySection({ model: globalModel }: { model: WidgetTabModel }) {
  const [overrides, setOverrides] = useSurfaceOverrides("dock")
  // The preview follows the Dock's own providers / colors.
  const model = withOverrides(globalModel, overrides)
  const [style, setStyle] = useState<DockOverlayStyle>(DEFAULT_DOCK_OVERLAY_STYLE)
  const [accountMode, setAccountMode] = useState<DockOverlayAccountLabel>(DEFAULT_DOCK_OVERLAY_ACCOUNT_LABEL)
  const [pngs, setPngs] = useState<Record<string, string | null>>({})
  const registeredClaudeAccounts = model.pluginsMeta.filter((meta) => claudeAccountId(meta.id) !== null).length

  // Models arrive as fresh objects on every render: key on the content that decides the overlay.
  const previewKey = JSON.stringify({
    providers: buildPreviewProviders(model),
    colors: model.colors,
    toneModes: model.toneModes,
    textColors: model.textColors,
  })
  const { providers, colors, toneModes, textColors } = useMemo(
    () =>
      JSON.parse(previewKey) as {
        providers: PreviewProvider[]
        colors: WidgetTabModel["colors"]
        toneModes: WidgetTabModel["toneModes"]
        textColors: WidgetTabModel["textColors"]
      },
    [previewKey]
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const stored = await loadDockOverlayStyle()
        if (!cancelled) setStyle(stored)
      } catch (error) {
        console.error("Failed to load dock overlay style:", error)
      }
      try {
        const stored = await loadDockOverlayAccountLabel()
        if (!cancelled) setAccountMode(stored)
      } catch (error) {
        console.error("Failed to load dock overlay account label:", error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (style === "off") return
    let cancelled = false
    void (async () => {
      try {
        const opts = { colors, toneModes, textColors }
        const withDockApp = providers.filter((provider) => provider.hasDockApp)
        // The name shows once 2+ Claude accounts are registered, so the preview draws it on account tiles then.
        const showNames = registeredClaudeAccounts >= 2
        const rendered = await Promise.all(
          withDockApp.map(async (provider) => {
            const account =
              showNames && accountMode !== "off" && claudeAccountId(provider.id)
                ? { mode: accountMode, name: accountLabel(provider.name) }
                : undefined
            const png = await renderDockOverlayPng(provider.overlay, account ? { ...opts, account } : opts)
            return [provider.id, png] as const
          })
        )
        if (!cancelled) setPngs(Object.fromEntries(rendered))
      } catch (error) {
        console.error("Failed to render dock overlay preview:", error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [providers, colors, toneModes, textColors, style, accountMode, registeredClaudeAccounts])

  const save = (next: DockOverlayStyle) => {
    setStyle(next)
    saveDockOverlayStyle(next).catch((error) => console.error("Failed to save dock overlay style:", error))
  }

  const saveAccountMode = (next: DockOverlayAccountLabel) => {
    setAccountMode(next)
    saveDockOverlayAccountLabel(next).catch((error) =>
      console.error("Failed to save dock overlay account label:", error)
    )
  }

  const note = noDockAppNote(providers.filter((provider) => !provider.hasDockApp).map((provider) => provider.name))

  return (
    <div className="space-y-3" data-testid="widget-dock">
      <div className="space-y-1.5">
        <div
          className="flex h-[132px] items-center justify-center overflow-hidden rounded-lg"
          style={{ background: DOCK_WALLPAPER }}
          data-testid="dock-preview"
        >
          <div className="flex max-w-[94%] flex-wrap items-center justify-center gap-0.5 rounded-[20px] border border-white/15 bg-white/10 px-2 py-1.5">
            {providers.map((provider) => (
              <DockTile
                key={provider.id}
                provider={provider}
                png={style === "off" || !provider.hasDockApp ? null : (pngs[provider.id] ?? null)}
              />
            ))}
          </div>
        </div>
        {note && <p className="text-[12px] text-muted-foreground">{note}</p>}
      </div>
      <p className="text-[12px] text-muted-foreground">
        Draws usage on the provider&apos;s app icon in the Dock. Needs Accessibility permission.
      </p>
      <div role="radiogroup" aria-label="Dock overlay style" className="grid grid-cols-4 gap-2">
        {OPTIONS.map((option) => {
          const selected = option.id === style
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={option.name}
              data-dock-style={option.id}
              onClick={() => {
                if (option.id !== style) save(option.id)
              }}
              className={cn(
                "flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-lg border-[1.5px] bg-card px-1.5 py-2.5 text-center outline-none transition-colors",
                "focus-visible:ring-3 focus-visible:ring-ring/50",
                selected ? "border-primary ring-2 ring-primary/25" : "border-border hover:bg-muted/60"
              )}
            >
              <StyleGlyph id={option.id} />
              <span className="text-[13px] font-semibold text-foreground">{option.name}</span>
            </button>
          )
        })}
      </div>
      {style !== "off" && (
        <div className="space-y-1.5">
          <p className="text-[12px] text-muted-foreground">Account name</p>
          <p className="text-[12px] text-muted-foreground">
            Shown when more than one Claude account is registered.
          </p>
          <div role="radiogroup" aria-label="Dock account name" className="grid grid-cols-4 gap-2">
            {ACCOUNT_OPTIONS.map((option) => {
              const selected = option.id === accountMode
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={option.name}
                  data-dock-account-label={option.id}
                  onClick={() => {
                    if (option.id !== accountMode) saveAccountMode(option.id)
                  }}
                  className={cn(
                    "flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-lg border-[1.5px] bg-card px-1.5 py-2.5 text-center outline-none transition-colors",
                    "focus-visible:ring-3 focus-visible:ring-ring/50",
                    selected ? "border-primary ring-2 ring-primary/25" : "border-border hover:bg-muted/60"
                  )}
                >
                  <AccountGlyph id={option.id} />
                  <span className="text-[13px] font-semibold text-foreground">{option.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      <SurfaceOverrides model={globalModel} surface="dock" overrides={overrides} onChange={setOverrides} />
    </div>
  )
}
