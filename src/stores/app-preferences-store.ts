import { create } from "zustand"
import {
  DEFAULT_AUTO_UPDATE_INTERVAL,
  DEFAULT_GLOBAL_SHORTCUT,
  DEFAULT_MENUBAR_ICON_STYLE,
  DEFAULT_RESET_TIMER_DISPLAY_MODE,
  DEFAULT_STATS_SHORTCUT,
  DEFAULT_START_ON_LOGIN,
  DEFAULT_THEME_MODE,
  DEFAULT_WIDGET_LAYOUT,
  DEFAULT_WIDGET_METRIC,
  DEFAULT_WIDGET_PROVIDER_IDS,
  DEFAULT_WIDGET_VISIBLE,
  type AutoUpdateIntervalMinutes,
  type GlobalShortcut,
  type MenubarIconStyle,
  type ResetTimerDisplayMode,
  type ThemeMode,
  type WidgetLayout,
  type WidgetMetric,
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
  widgetLayout: WidgetLayout
  widgetVisible: boolean
  widgetProviderIds: WidgetProviderIds
  widgetMetric: WidgetMetric
  setAutoUpdateInterval: (value: AutoUpdateIntervalMinutes) => void
  setThemeMode: (value: ThemeMode) => void
  setResetTimerDisplayMode: (value: ResetTimerDisplayMode) => void
  setGlobalShortcut: (value: GlobalShortcut) => void
  setStatsShortcut: (value: GlobalShortcut) => void
  setStartOnLogin: (value: boolean) => void
  setMenubarIconStyle: (value: MenubarIconStyle) => void
  setWidgetLayout: (value: WidgetLayout) => void
  setWidgetVisible: (value: boolean) => void
  setWidgetProviderIds: (value: WidgetProviderIds) => void
  setWidgetMetric: (value: WidgetMetric) => void
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
  widgetLayout: DEFAULT_WIDGET_LAYOUT,
  widgetVisible: DEFAULT_WIDGET_VISIBLE,
  widgetProviderIds: DEFAULT_WIDGET_PROVIDER_IDS,
  widgetMetric: DEFAULT_WIDGET_METRIC,
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
  setWidgetLayout: (value) => set({ widgetLayout: value }),
  setWidgetVisible: (value) => set({ widgetVisible: value }),
  setWidgetProviderIds: (value) => set({ widgetProviderIds: value }),
  setWidgetMetric: (value) => set({ widgetMetric: value }),
  resetState: () => set(initialState),
}))
