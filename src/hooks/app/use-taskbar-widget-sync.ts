import { useEffect, useRef, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { LazyStore } from "@tauri-apps/plugin-store"
import { useMenuBarDark } from "@/hooks/app/use-menu-bar-dark"
import { useWidgetRows } from "@/hooks/app/use-widget-rows"
import { accountLabel, claudeAccountId } from "@/lib/claude-desktop"
import { dockBundleIdsFor } from "@/lib/dock-apps"
import { renderDockOverlayPng, type DockOverlayOptions } from "@/lib/dock-overlay-image"
import { getIconMask } from "@/lib/icon-mask"
import {
  MENU_BAR_METRICS,
  MENU_BAR_RENDER_SCALE,
  menuBarImageSizePt,
  renderMenuBarWidgetPng,
  renderMenuBarWidgetRgba,
} from "@/lib/menubar-widget-image"
import { isMacPlatform, usesRenderedWidget } from "@/lib/platform"
import {
  DEFAULT_DOCK_OVERLAY_ACCOUNT_LABEL,
  DEFAULT_MENU_BAR_ACCOUNT_LABEL,
  DEFAULT_MENU_BAR_WIDGET_BACKDROP,
  DEFAULT_MENU_BAR_WIDGET_COLORS,
  DEFAULT_MENU_BAR_WIDGET_STYLE,
  DEFAULT_MENU_BAR_WIDGET_TEXT_COLORS,
  DEFAULT_MENU_BAR_WIDGET_TONE_MODES,
  DEFAULT_SURFACE_OVERRIDES,
  effectiveColors,
  loadDockOverlayAccountLabel,
  loadDockOverlayStyle,
  loadMenuBarAccountLabel,
  loadMenuBarWidgetBackdrop,
  loadMenuBarWidgetColors,
  loadMenuBarWidgetStyle,
  loadMenuBarWidgetTextColors,
  loadMenuBarWidgetToneModes,
  loadSurfaceOverrides,
  parseDockOverlayAccountLabel,
  parseDockOverlayStyle,
  parseMenuBarAccountLabel,
  parseMenuBarWidgetBackdrop,
  parseMenuBarWidgetColors,
  parseMenuBarWidgetStyle,
  parseMenuBarWidgetTextColors,
  parseMenuBarWidgetToneModes,
  parseSurfaceOverrides,
  surfaceOverridesKey,
  type DockOverlayAccountLabel,
  type DockOverlayStyle,
  type MenuBarAccountLabel,
  type MenuBarWidgetBackdrop,
  type MenuBarWidgetColors,
  type MenuBarWidgetStyle,
  type MenuBarWidgetTextColors,
  type MenuBarWidgetToneModes,
  type SurfaceOverrides,
} from "@/lib/settings"
import {
  buildMenuBarBackdrop,
  buildTaskbarPayload,
  type DockOverlay,
  type TaskbarPayload,
  type TaskbarProvider,
} from "@/lib/taskbar-payload"

const SETTINGS_STORE_PATH = "settings.json"

/**
 * One overlay per provider that has a Dock app; empty when the style is off. Claude account overlays carry the
 * account id, and draw the account name (in the `accountMode` look) when `showAccountNames` and the mode is not "off".
 */
async function renderDockOverlays(
  providers: TaskbarProvider[],
  style: DockOverlayStyle,
  opts: DockOverlayOptions,
  accountMode: DockOverlayAccountLabel,
  names: Record<string, string>,
  showAccountNames: boolean
): Promise<DockOverlay[]> {
  const overlays: DockOverlay[] = []
  if (style === "off") return overlays
  for (const provider of providers) {
    const bundleIds = dockBundleIdsFor(provider.id)
    if (bundleIds.length === 0) continue
    const accountId = claudeAccountId(provider.id)
    const account =
      accountId && showAccountNames && accountMode !== "off"
        ? { mode: accountMode, name: accountLabel(names[provider.id] ?? provider.id) }
        : undefined
    const png = await renderDockOverlayPng(provider, account ? { ...opts, account } : opts)
    if (!png) continue
    overlays.push(accountId ? { bundleIds, png, accountId } : { bundleIds, png })
  }
  return overlays
}

/** Pushes provider rows to the native taskbar widget whenever their content changes. */
export function useTaskbarWidgetSync(): void {
  const { rowsFor, claudeAccountCount } = useWidgetRows()
  const showAccountNames = claudeAccountCount >= 2
  const lastSentKeyRef = useRef<string | null>(null)
  const dark = useMenuBarDark()
  const [backdrop, setBackdrop] = useState<MenuBarWidgetBackdrop>(DEFAULT_MENU_BAR_WIDGET_BACKDROP)
  const [style, setStyle] = useState<MenuBarWidgetStyle>(DEFAULT_MENU_BAR_WIDGET_STYLE)
  const [menuBarAccountLabel, setMenuBarAccountLabel] = useState<MenuBarAccountLabel>(DEFAULT_MENU_BAR_ACCOUNT_LABEL)
  const [colors, setColors] = useState<MenuBarWidgetColors>(DEFAULT_MENU_BAR_WIDGET_COLORS)
  const [textColors, setTextColors] = useState<MenuBarWidgetTextColors>(DEFAULT_MENU_BAR_WIDGET_TEXT_COLORS)
  const [toneModes, setToneModes] = useState<MenuBarWidgetToneModes>(DEFAULT_MENU_BAR_WIDGET_TONE_MODES)
  // "off" until the stored style loads, so a user who turned the overlay off never sees it flash on at launch.
  const [dockStyle, setDockStyle] = useState<DockOverlayStyle>("off")
  const [dockAccountLabel, setDockAccountLabel] = useState<DockOverlayAccountLabel>(
    DEFAULT_DOCK_OVERLAY_ACCOUNT_LABEL
  )
  const [menuBarOverrides, setMenuBarOverrides] = useState<SurfaceOverrides>(DEFAULT_SURFACE_OVERRIDES)
  const [dockOverrides, setDockOverrides] = useState<SurfaceOverrides>(DEFAULT_SURFACE_OVERRIDES)

  // Menu bar style, backdrop, colors, text colors and tone modes: load once, then follow changes made in the Settings window.
  useEffect(() => {
    if (!isTauri() || !usesRenderedWidget()) return
    let cancelled = false
    const unlisteners: (() => void)[] = []

    void (async () => {
      try {
        const [
          storedBackdrop,
          storedStyle,
          storedMenuBarAccountLabel,
          storedColors,
          storedTextColors,
          storedToneModes,
          storedDockStyle,
          storedDockAccountLabel,
          storedMenuBarOverrides,
          storedDockOverrides,
        ] = await Promise.all([
          loadMenuBarWidgetBackdrop(),
          loadMenuBarWidgetStyle(),
          loadMenuBarAccountLabel(),
          loadMenuBarWidgetColors(),
          loadMenuBarWidgetTextColors(),
          loadMenuBarWidgetToneModes(),
          loadDockOverlayStyle(),
          loadDockOverlayAccountLabel(),
          loadSurfaceOverrides("menuBar"),
          loadSurfaceOverrides("dock"),
        ])
        if (!cancelled) {
          setBackdrop(storedBackdrop)
          setStyle(storedStyle)
          setMenuBarAccountLabel(storedMenuBarAccountLabel)
          setColors(storedColors)
          setTextColors(storedTextColors)
          setToneModes(storedToneModes)
          setDockStyle(storedDockStyle)
          setDockAccountLabel(storedDockAccountLabel)
          setMenuBarOverrides(storedMenuBarOverrides)
          setDockOverrides(storedDockOverrides)
        }
      } catch (error) {
        console.error("Failed to load menu bar widget appearance settings:", error)
      }
      try {
        const store = new LazyStore(SETTINGS_STORE_PATH)
        const watch = async (key: string, apply: (value: unknown) => void) => {
          const fn = await store.onKeyChange<unknown>(key, apply)
          if (cancelled) fn()
          else unlisteners.push(fn)
        }
        await watch("menuBarWidgetBackdrop", (value) => {
          const parsed = parseMenuBarWidgetBackdrop(value)
          if (parsed) setBackdrop(parsed)
        })
        await watch("menuBarWidgetStyle", (value) => {
          const parsed = parseMenuBarWidgetStyle(value)
          if (parsed) setStyle(parsed)
        })
        await watch("menuBarAccountLabel", (value) => {
          const parsed = parseMenuBarAccountLabel(value)
          if (parsed) setMenuBarAccountLabel(parsed)
        })
        await watch("menuBarWidgetColors", (value) => {
          setColors(parseMenuBarWidgetColors(value))
        })
        await watch("menuBarWidgetTextColors", (value) => {
          setTextColors(parseMenuBarWidgetTextColors(value))
        })
        await watch("menuBarWidgetToneModes", (value) => {
          setToneModes(parseMenuBarWidgetToneModes(value))
        })
        await watch("dockOverlayStyle", (value) => {
          const parsed = parseDockOverlayStyle(value)
          if (parsed) setDockStyle(parsed)
        })
        await watch("dockOverlayAccountLabel", (value) => {
          const parsed = parseDockOverlayAccountLabel(value)
          if (parsed) setDockAccountLabel(parsed)
        })
        await watch(surfaceOverridesKey("menuBar"), (value) => setMenuBarOverrides(parseSurfaceOverrides(value)))
        await watch(surfaceOverridesKey("dock"), (value) => setDockOverrides(parseSurfaceOverrides(value)))
      } catch (error) {
        console.error("Failed to watch menu bar widget appearance settings:", error)
      }
    })()

    return () => {
      cancelled = true
      for (const unlisten of unlisteners) unlisten()
    }
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    const mac = isMacPlatform()
    const rendered = usesRenderedWidget()
    const menuBarRows = rowsFor(menuBarOverrides.providers)
    const draft = buildTaskbarPayload(menuBarRows)
    if (showAccountNames && menuBarAccountLabel !== "off") {
      // 2+ Claude accounts: each account provider also carries its name for the menu bar render.
      const rowNames = new Map(menuBarRows.map((row) => [row.id, row.name]))
      for (const provider of draft.providers) {
        if (claudeAccountId(provider.id) !== null) {
          provider.accountName = accountLabel(rowNames.get(provider.id) ?? provider.id)
        }
      }
    }
    const dockRows = rowsFor(dockOverrides.providers)
    const dockDraft = buildTaskbarPayload(dockRows)
    const dockNames = Object.fromEntries(dockRows.map((row) => [row.id, row.name]))
    const global = { colors, textColors, toneModes }
    const menuBarColors = effectiveColors(global, menuBarOverrides)
    const dockColors = effectiveColors(global, dockOverrides)
    const draftKey = rendered
      ? `${JSON.stringify(draft)}|${dark ? "dark" : "light"}|${JSON.stringify(backdrop)}|${style}|${menuBarAccountLabel}|${JSON.stringify(menuBarColors)}|${dockStyle}|${dockAccountLabel}|${showAccountNames}|${JSON.stringify(dockDraft)}|${JSON.stringify(dockColors)}`
      : JSON.stringify(draft)
    if (draftKey === lastSentKeyRef.current) return

    let cancelled = false
    void (async () => {
      const providers = await Promise.all(
        draft.providers.map(async ({ iconUrl, ...provider }) => ({
          ...provider,
          iconMask: await getIconMask(iconUrl),
        }))
      )
      if (cancelled) return

      const payload: TaskbarPayload = { providers, tooltip: draft.tooltip }
      if (rendered) {
        const appearance = { dark, backdrop, style, accountLabel: menuBarAccountLabel, ...menuBarColors }
        try {
          if (mac) {
            payload.menuBarImage = await renderMenuBarWidgetPng(payload, appearance)
            const size = payload.menuBarImage ? menuBarImageSizePt(payload.menuBarImage) : null
            payload.menuBarBackdrop = buildMenuBarBackdrop(backdrop, size, MENU_BAR_METRICS.cardRadius)
          } else {
            const image = await renderMenuBarWidgetRgba(payload, appearance)
            payload.widgetImage = image
            // Windows draws the blur under the card natively (the blurred wallpaper behind the taskbar).
            const size = image
              ? { width: image.width / MENU_BAR_RENDER_SCALE, height: image.height / MENU_BAR_RENDER_SCALE }
              : null
            payload.menuBarBackdrop = buildMenuBarBackdrop(backdrop, size, MENU_BAR_METRICS.cardRadius)
          }
        } catch (error) {
          console.error("Failed to render widget image:", error)
          payload.menuBarImage = null
          payload.menuBarBackdrop = null
          payload.widgetImage = null
        }
        if (cancelled) return
      }
      if (mac) {
        try {
          const dockProviders = dockDraft.providers.map(({ id, items }) => ({ id, items }))
          payload.dockOverlays = await renderDockOverlays(
            dockProviders,
            dockStyle,
            dockColors,
            dockAccountLabel,
            dockNames,
            showAccountNames
          )
        } catch (error) {
          console.error("Failed to render Dock overlays:", error)
          payload.dockOverlays = []
        }
        if (cancelled) return
      }
      try {
        await invoke("taskbar_widget_update", { payload })
        lastSentKeyRef.current = draftKey
      } catch (error) {
        console.error("Failed to update taskbar widget:", error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [rowsFor, dark, backdrop, style, menuBarAccountLabel, colors, textColors, toneModes, dockStyle, dockAccountLabel, showAccountNames, menuBarOverrides, dockOverrides])
}
