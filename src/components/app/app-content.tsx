import { useShallow } from "zustand/react/shallow"
import { OverviewPage } from "@/pages/overview"
import { ProviderDetailPage } from "@/pages/provider-detail"
import type { DisplayPluginState } from "@/hooks/app/use-app-plugin-views"
import type { SettingsPluginState } from "@/hooks/app/use-settings-plugin-list"
import { useAppPreferencesStore } from "@/stores/app-preferences-store"
import { useAppUiStore } from "@/stores/app-ui-store"
import type {
  ResetTimerDisplayMode,
  ThemeMode,
  WidgetProviderIds,
} from "@/lib/settings"

type AppContentDerivedProps = {
  displayPlugins: DisplayPluginState[]
  pluginsReady: boolean
  pluginLoadError?: string | null
  onRetryPluginLoad?: () => void
  settingsPlugins: SettingsPluginState[]
  selectedPlugin: DisplayPluginState | null
}

export type AppContentActionProps = {
  onRetryPlugin: (id: string) => void
  onReorder: (orderedIds: string[]) => void
  onToggle: (id: string) => void
  onThemeModeChange: (mode: ThemeMode) => void
  onResetTimerDisplayModeChange: (mode: ResetTimerDisplayMode) => void
  onResetTimerDisplayModeToggle: () => void
  onStartOnLoginChange: (value: boolean) => void
  onWidgetVisibleChange: (value: boolean) => void
  onWidgetProviderIdsChange: (value: WidgetProviderIds) => void
}

export type AppContentProps = AppContentDerivedProps & AppContentActionProps

export function AppContent({
  displayPlugins,
  pluginsReady,
  pluginLoadError,
  onRetryPluginLoad,
  selectedPlugin,
  onRetryPlugin,
  onResetTimerDisplayModeToggle,
}: AppContentProps) {
  const { activeView } = useAppUiStore(
    useShallow((state) => ({
      activeView: state.activeView,
    }))
  )

  const {
    resetTimerDisplayMode,
  } = useAppPreferencesStore(
    useShallow((state) => ({
      resetTimerDisplayMode: state.resetTimerDisplayMode,
    }))
  )

  if (activeView === "home") {
    return (
      <OverviewPage
        plugins={displayPlugins}
        loading={!pluginsReady && !pluginLoadError}
        error={pluginLoadError}
        onRetry={onRetryPluginLoad}
        onRetryPlugin={onRetryPlugin}
        resetTimerDisplayMode={resetTimerDisplayMode}
        onResetTimerDisplayModeToggle={onResetTimerDisplayModeToggle}
      />
    )
  }

  const handleRetry = selectedPlugin
    ? () => onRetryPlugin(selectedPlugin.meta.id)
    : /* v8 ignore next */ undefined

  return (
    <ProviderDetailPage
      plugin={selectedPlugin}
      onRetry={handleRetry}
      resetTimerDisplayMode={resetTimerDisplayMode}
      onResetTimerDisplayModeToggle={onResetTimerDisplayModeToggle}
    />
  )
}
