import { create } from "zustand"
import {
  DEFAULT_AUTO_UPDATE_INTERVAL,
  DEFAULT_GLOBAL_SHORTCUT,
  DEFAULT_MENUBAR_ICON_STYLE,
  DEFAULT_RESET_TIMER_DISPLAY_MODE,
  DEFAULT_STATS_SHORTCUT,
  DEFAULT_START_ON_LOGIN,
  DEFAULT_THEME_MODE,
  DEFAULT_WIDGET_PROVIDER_METRICS,
  DEFAULT_WIDGET_PROVIDER_IDS,
  DEFAULT_WIDGET_VISIBLE,
  type AutoUpdateIntervalMinutes,
  type GlobalShortcut,
  type MenubarIconStyle,
  type ResetTimerDisplayMode,
  type ThemeMode,
  type WidgetProviderMetrics,
  type WidgetProviderIds,
} from "@/lib/settings"

type AppPreferencesStore = {
  autoUpdateInterval: AutoUpdateIntervalMinutes
  themeMode: ThemeMode
  resetTimerDisplayMode: ResetTimerDisplayMode
  globalShortcut: GlobalShortcut
  statsShortcut: GlobalShortcut
  startOnLogin: boolean
  menubarIconStyle: MenubarIconStyle
  widgetVisible: boolean
  widgetProviderIds: WidgetProviderIds
  widgetProviderMetrics: WidgetProviderMetrics
  setAutoUpdateInterval: (value: AutoUpdateIntervalMinutes) => void
  setThemeMode: (value: ThemeMode) => void
  setResetTimerDisplayMode: (value: ResetTimerDisplayMode) => void
  setGlobalShortcut: (value: GlobalShortcut) => void
  setStatsShortcut: (value: GlobalShortcut) => void
  setStartOnLogin: (value: boolean) => void
  setMenubarIconStyle: (value: MenubarIconStyle) => void
  setWidgetVisible: (value: boolean) => void
  setWidgetProviderIds: (value: WidgetProviderIds) => void
  setWidgetProviderMetrics: (value: WidgetProviderMetrics) => void
  resetState: () => void
}

const initialState = {
  autoUpdateInterval: DEFAULT_AUTO_UPDATE_INTERVAL,
  themeMode: DEFAULT_THEME_MODE,
  resetTimerDisplayMode: DEFAULT_RESET_TIMER_DISPLAY_MODE,
  globalShortcut: DEFAULT_GLOBAL_SHORTCUT,
  statsShortcut: DEFAULT_STATS_SHORTCUT,
  startOnLogin: DEFAULT_START_ON_LOGIN,
  menubarIconStyle: DEFAULT_MENUBAR_ICON_STYLE,
  widgetVisible: DEFAULT_WIDGET_VISIBLE,
  widgetProviderIds: DEFAULT_WIDGET_PROVIDER_IDS,
  widgetProviderMetrics: DEFAULT_WIDGET_PROVIDER_METRICS,
}

export const useAppPreferencesStore = create<AppPreferencesStore>((set) => ({
  ...initialState,
  setAutoUpdateInterval: (value) => set({ autoUpdateInterval: value }),
  setThemeMode: (value) => set({ themeMode: value }),
  setResetTimerDisplayMode: (value) => set({ resetTimerDisplayMode: value }),
  setGlobalShortcut: (value) => set({ globalShortcut: value }),
  setStatsShortcut: (value) => set({ statsShortcut: value }),
  setStartOnLogin: (value) => set({ startOnLogin: value }),
  setMenubarIconStyle: (value) => set({ menubarIconStyle: value }),
  setWidgetVisible: (value) => set({ widgetVisible: value }),
  setWidgetProviderIds: (value) => set({ widgetProviderIds: value }),
  setWidgetProviderMetrics: (value) => set({ widgetProviderMetrics: value }),
  resetState: () => set(initialState),
}))
