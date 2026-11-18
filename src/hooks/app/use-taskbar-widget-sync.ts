import { useEffect, useRef, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { LazyStore } from "@tauri-apps/plugin-store"
import { useMenuBarDark } from "@/hooks/app/use-menu-bar-dark"
import { useWidgetRows } from "@/hooks/app/use-widget-rows"
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
  DEFAULT_MENU_BAR_WIDGET_BACKDROP,
  DEFAULT_MENU_BAR_WIDGET_COLORS,
  DEFAULT_MENU_BAR_WIDGET_STYLE,
  DEFAULT_MENU_BAR_WIDGET_TEXT_COLORS,
  DEFAULT_MENU_BAR_WIDGET_TONE_MODES,
  loadMenuBarWidgetBackdrop,
  loadMenuBarWidgetColors,
  loadMenuBarWidgetStyle,
  loadMenuBarWidgetTextColors,
  loadMenuBarWidgetToneModes,
  parseMenuBarWidgetBackdrop,
  parseMenuBarWidgetColors,
  parseMenuBarWidgetStyle,
  parseMenuBarWidgetTextColors,
  parseMenuBarWidgetToneModes,
  type MenuBarWidgetBackdrop,
  type MenuBarWidgetColors,
  type MenuBarWidgetStyle,
  type MenuBarWidgetTextColors,
  type MenuBarWidgetToneModes,
} from "@/lib/settings"
import { buildMenuBarBackdrop, buildTaskbarPayload, type TaskbarPayload } from "@/lib/taskbar-payload"

const SETTINGS_STORE_PATH = "settings.json"

/** Pushes provider rows to the native taskbar widget whenever their content changes. */
export function useTaskbarWidgetSync(): void {
  const rows = useWidgetRows()
  const lastSentKeyRef = useRef<string | null>(null)
  const dark = useMenuBarDark()
  const [backdrop, setBackdrop] = useState<MenuBarWidgetBackdrop>(DEFAULT_MENU_BAR_WIDGET_BACKDROP)
  const [style, setStyle] = useState<MenuBarWidgetStyle>(DEFAULT_MENU_BAR_WIDGET_STYLE)
  const [colors, setColors] = useState<MenuBarWidgetColors>(DEFAULT_MENU_BAR_WIDGET_COLORS)
  const [textColors, setTextColors] = useState<MenuBarWidgetTextColors>(DEFAULT_MENU_BAR_WIDGET_TEXT_COLORS)
  const [toneModes, setToneModes] = useState<MenuBarWidgetToneModes>(DEFAULT_MENU_BAR_WIDGET_TONE_MODES)

  // Menu bar style, backdrop, colors, text colors and tone modes: load once, then follow changes made in the Settings window.
  useEffect(() => {
    if (!isTauri() || !usesRenderedWidget()) return
    let cancelled = false
    const unlisteners: (() => void)[] = []

    void (async () => {
      try {
        const [storedBackdrop, storedStyle, storedColors, storedTextColors, storedToneModes] = await Promise.all([
          loadMenuBarWidgetBackdrop(),
          loadMenuBarWidgetStyle(),
          loadMenuBarWidgetColors(),
          loadMenuBarWidgetTextColors(),
          loadMenuBarWidgetToneModes(),
        ])
        if (!cancelled) {
          setBackdrop(storedBackdrop)
          setStyle(storedStyle)
          setColors(storedColors)
          setTextColors(storedTextColors)
          setToneModes(storedToneModes)
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
        await watch("menuBarWidgetColors", (value) => {
          setColors(parseMenuBarWidgetColors(value))
        })
        await watch("menuBarWidgetTextColors", (value) => {
          setTextColors(parseMenuBarWidgetTextColors(value))
        })
        await watch("menuBarWidgetToneModes", (value) => {
          setToneModes(parseMenuBarWidgetToneModes(value))
        })
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
    const draft = buildTaskbarPayload(rows)
    const draftKey = rendered
      ? `${JSON.stringify(draft)}|${dark ? "dark" : "light"}|${JSON.stringify(backdrop)}|${style}|${JSON.stringify(colors)}|${JSON.stringify(textColors)}|${JSON.stringify(toneModes)}`
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
        const appearance = { dark, backdrop, style, colors, textColors, toneModes }
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
  }, [rows, dark, backdrop, style, colors, textColors, toneModes])
}
