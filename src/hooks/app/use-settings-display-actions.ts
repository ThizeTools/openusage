import { useCallback } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import {
  saveMenubarIconStyle,
  saveResetTimerDisplayMode,
  saveThemeMode,
  saveWidgetLayout,
  saveWidgetProviderIds,
  type MenubarIconStyle,
  type ResetTimerDisplayMode,
  type ThemeMode,
  type WidgetLayout,
  type WidgetProviderIds,
} from "@/lib/settings"

type ScheduleTrayIconUpdate = (reason: "probe" | "settings" | "init", delayMs?: number) => void

type UseSettingsDisplayActionsArgs = {
  setThemeMode: (value: ThemeMode) => void
  resetTimerDisplayMode: ResetTimerDisplayMode
  setResetTimerDisplayMode: (value: ResetTimerDisplayMode) => void
  setMenubarIconStyle: (value: MenubarIconStyle) => void
  setWidgetLayout: (value: WidgetLayout) => void
  setWidgetVisible: (value: boolean) => void
  setWidgetProviderIds: (value: WidgetProviderIds) => void
  scheduleTrayIconUpdate: ScheduleTrayIconUpdate
}

export function useSettingsDisplayActions({
  setThemeMode,
  resetTimerDisplayMode,
  setResetTimerDisplayMode,
  setMenubarIconStyle,
  setWidgetLayout,
  setWidgetVisible,
  setWidgetProviderIds,
  scheduleTrayIconUpdate,
}: UseSettingsDisplayActionsArgs) {
  const handleThemeModeChange = useCallback((mode: ThemeMode) => {
    setThemeMode(mode)
    void saveThemeMode(mode).catch((error) => {
      console.error("Failed to save theme mode:", error)
    })
  }, [setThemeMode])

  const handleResetTimerDisplayModeChange = useCallback((mode: ResetTimerDisplayMode) => {
    setResetTimerDisplayMode(mode)
    void saveResetTimerDisplayMode(mode).catch((error) => {
      console.error("Failed to save reset timer display mode:", error)
    })
  }, [setResetTimerDisplayMode])

  const handleResetTimerDisplayModeToggle = useCallback(() => {
    const next = resetTimerDisplayMode === "relative" ? "absolute" : "relative"
    handleResetTimerDisplayModeChange(next)
  }, [handleResetTimerDisplayModeChange, resetTimerDisplayMode])

  const handleMenubarIconStyleChange = useCallback((style: MenubarIconStyle) => {
    setMenubarIconStyle(style)
    scheduleTrayIconUpdate("settings", 0)
    void saveMenubarIconStyle(style).catch((error) => {
      console.error("Failed to save menubar icon style:", error)
    })
  }, [scheduleTrayIconUpdate, setMenubarIconStyle])

  const handleWidgetLayoutChange = useCallback((layout: WidgetLayout) => {
    setWidgetLayout(layout)
    // Widget window stays in sync via the shared store's onKeyChange listener.
    void saveWidgetLayout(layout).catch((error) => {
      console.error("Failed to save widget layout:", error)
    })
  }, [setWidgetLayout])

  const handleWidgetVisibleChange = useCallback((visible: boolean) => {
    setWidgetVisible(visible)
    if (!isTauri()) return
    // Rust persists widgetVisible and shows/hides the widget window.
    void invoke("set_widget_visible", { visible }).catch((error) => {
      console.error("Failed to set widget visibility:", error)
    })
  }, [setWidgetVisible])

  const handleWidgetProviderIdsChange = useCallback((ids: WidgetProviderIds) => {
    setWidgetProviderIds(ids)
    void saveWidgetProviderIds(ids).catch((error) => {
      console.error("Failed to save widget providers:", error)
    })
  }, [setWidgetProviderIds])

  return {
    handleThemeModeChange,
    handleResetTimerDisplayModeChange,
    handleResetTimerDisplayModeToggle,
    handleMenubarIconStyleChange,
    handleWidgetLayoutChange,
    handleWidgetVisibleChange,
    handleWidgetProviderIdsChange,
  }
}
