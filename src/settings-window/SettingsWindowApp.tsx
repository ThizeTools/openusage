import { useState, useEffect } from "react"
import { listen } from "@tauri-apps/api/event"
import { isTauri } from "@tauri-apps/api/core"
import { WindowTitleBar } from "@/components/window-titlebar"
import { SettingsPage } from "@/pages/settings"
import { useSettingsTheme } from "@/hooks/app/use-settings-theme"
import { useSettingsWindow } from "@/settings-window/use-settings-window"

export function SettingsWindowApp() {
  const s = useSettingsWindow()
  useSettingsTheme(s.themeMode)

  const [activeTab, setActiveTab] = useState("general")

  useEffect(() => {
    if (!isTauri()) return
    let unlisten: (() => void) | undefined
    listen<{ tab: string }>("settings:open-tab", (event) => {
      setActiveTab(event.payload.tab)
    }).then((fn) => { unlisten = fn }).catch(console.error)
    return () => unlisten?.()
  }, [])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-card text-foreground">
      <WindowTitleBar title="OpenUsage Settings" />
      <div className="flex-1 overflow-y-auto px-4 dark:bg-muted/30">
        <SettingsPage
          plugins={s.plugins}
          availableMetrics={s.availableMetrics}
          onReorder={s.handleReorder}
          onToggle={s.handleToggle}
          autoUpdateInterval={s.autoUpdateInterval}
          onAutoUpdateIntervalChange={s.handleAutoUpdateIntervalChange}
          themeMode={s.themeMode}
          onThemeModeChange={s.handleThemeModeChange}
          resetTimerDisplayMode={s.resetTimerDisplayMode}
          onResetTimerDisplayModeChange={s.handleResetTimerDisplayModeChange}
          globalShortcut={s.globalShortcut}
          onGlobalShortcutChange={s.handleGlobalShortcutChange}
          statsShortcut={s.statsShortcut}
          onStatsShortcutChange={s.handleStatsShortcutChange}
          startOnLogin={s.startOnLogin}
          onStartOnLoginChange={s.handleStartOnLoginChange}
          widgetLayout={s.widgetLayout}
          onWidgetLayoutChange={s.handleWidgetLayoutChange}
          widgetVisible={s.widgetVisible}
          onWidgetVisibleChange={s.handleWidgetVisibleChange}
          widgetProviderIds={s.widgetProviderIds}
          onWidgetProviderIdsChange={s.handleWidgetProviderIdsChange}
          widgetMetric={s.widgetMetric}
          onWidgetMetricChange={s.handleWidgetMetricChange}
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
        />
      </div>
    </div>
  )
}
