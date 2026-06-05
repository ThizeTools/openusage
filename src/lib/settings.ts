import { LazyStore } from "@tauri-apps/plugin-store";
import type { PluginMeta } from "@/lib/plugin-types";

// Refresh cooldown duration in milliseconds (5 minutes)
export const REFRESH_COOLDOWN_MS = 300_000;

// Spec: persist plugin order + disabled list; new plugins append, default disabled unless in DEFAULT_ENABLED_PLUGINS.
export type PluginSettings = {
  order: string[];
  disabled: string[];
};

export type AutoUpdateIntervalMinutes = 1 | 5 | 15 | 30;

export type ThemeMode = "system" | "light" | "dark";

export type ResetTimerDisplayMode = "relative" | "absolute";

export type MenubarIconStyle = "provider" | "bars" | "donut";

export type WidgetLayout = "vertical" | "horizontal";

export type WidgetPosition = { x: number; y: number };

export type WidgetProviderIds = string[] | null;

/** Selected metric label shown in the widget; null = auto (weekly/total like the tray). */
export type WidgetMetric = string | null;

export type GlobalShortcut = string | null;

const SETTINGS_STORE_PATH = "settings.json";
const PLUGIN_SETTINGS_KEY = "plugins";
const AUTO_UPDATE_SETTINGS_KEY = "autoUpdateInterval";
const THEME_MODE_KEY = "themeMode";
const RESET_TIMER_DISPLAY_MODE_KEY = "resetTimerDisplayMode";
const MENUBAR_ICON_STYLE_KEY = "menubarIconStyle";
const LEGACY_TRAY_ICON_STYLE_KEY = "trayIconStyle";
const LEGACY_TRAY_SHOW_PERCENTAGE_KEY = "trayShowPercentage";
const GLOBAL_SHORTCUT_KEY = "globalShortcut";
const STATS_SHORTCUT_KEY = "statsShortcut";
const START_ON_LOGIN_KEY = "startOnLogin";
const WIDGET_LAYOUT_KEY = "widgetLayout";
const WIDGET_VISIBLE_KEY = "widgetVisible";
const WIDGET_POSITION_KEY = "widgetPosition";
const WIDGET_PROVIDER_IDS_KEY = "widgetProviderIds";
const WIDGET_METRIC_KEY = "widgetMetric";

export const DEFAULT_AUTO_UPDATE_INTERVAL: AutoUpdateIntervalMinutes = 15;
export const DEFAULT_THEME_MODE: ThemeMode = "system";
export const DEFAULT_RESET_TIMER_DISPLAY_MODE: ResetTimerDisplayMode = "relative";
export const DEFAULT_MENUBAR_ICON_STYLE: MenubarIconStyle = "provider";
export const DEFAULT_GLOBAL_SHORTCUT: GlobalShortcut = null;
export const DEFAULT_STATS_SHORTCUT: GlobalShortcut = null;
export const DEFAULT_START_ON_LOGIN = false;
export const DEFAULT_WIDGET_LAYOUT: WidgetLayout = "vertical";
export const DEFAULT_WIDGET_VISIBLE = false;
export const DEFAULT_WIDGET_PROVIDER_IDS: WidgetProviderIds = null;
export const DEFAULT_WIDGET_METRIC: WidgetMetric = null;

const AUTO_UPDATE_INTERVALS: AutoUpdateIntervalMinutes[] = [1, 5, 15, 30];
const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];
const RESET_TIMER_DISPLAY_MODES: ResetTimerDisplayMode[] = ["relative", "absolute"];
const MENUBAR_ICON_STYLES: MenubarIconStyle[] = ["provider", "donut", "bars"];
const WIDGET_LAYOUTS: WidgetLayout[] = ["vertical", "horizontal"];

export const WIDGET_LAYOUT_OPTIONS: { value: WidgetLayout; label: string }[] = [
  { value: "vertical", label: "Vertical" },
  { value: "horizontal", label: "Horizontal" },
];

export const MENUBAR_ICON_STYLE_OPTIONS: { value: MenubarIconStyle; label: string }[] = [
  { value: "provider", label: "Plugin" },
  { value: "donut", label: "Donut" },
  { value: "bars", label: "Bars" },
];

export const AUTO_UPDATE_OPTIONS: { value: AutoUpdateIntervalMinutes; label: string }[] =
  AUTO_UPDATE_INTERVALS.map((value) => ({
    value,
    label: `${value} min`,
  }));

export const THEME_OPTIONS: { value: ThemeMode; label: string }[] =
  THEME_MODES.map((value) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1),
  }));

export const RESET_TIMER_DISPLAY_OPTIONS: { value: ResetTimerDisplayMode; label: string }[] = [
  { value: "relative", label: "Relative" },
  { value: "absolute", label: "Absolute" },
];

const store = new LazyStore(SETTINGS_STORE_PATH);

const DEFAULT_ENABLED_PLUGINS = new Set(["claude", "codex", "cursor"]);

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  order: [],
  disabled: [],
};

export async function loadPluginSettings(): Promise<PluginSettings> {
  const stored = await store.get<PluginSettings>(PLUGIN_SETTINGS_KEY);
  if (!stored) return { ...DEFAULT_PLUGIN_SETTINGS };
  return {
    order: Array.isArray(stored.order) ? stored.order : [],
    disabled: Array.isArray(stored.disabled) ? stored.disabled : [],
  };
}

export async function savePluginSettings(settings: PluginSettings): Promise<void> {
  await store.set(PLUGIN_SETTINGS_KEY, settings);
  await store.save();
}

function isAutoUpdateInterval(value: unknown): value is AutoUpdateIntervalMinutes {
  return (
    typeof value === "number" &&
    AUTO_UPDATE_INTERVALS.includes(value as AutoUpdateIntervalMinutes)
  );
}

export async function loadAutoUpdateInterval(): Promise<AutoUpdateIntervalMinutes> {
  const stored = await store.get<unknown>(AUTO_UPDATE_SETTINGS_KEY);
  if (isAutoUpdateInterval(stored)) return stored;
  return DEFAULT_AUTO_UPDATE_INTERVAL;
}

export async function saveAutoUpdateInterval(
  interval: AutoUpdateIntervalMinutes
): Promise<void> {
  await store.set(AUTO_UPDATE_SETTINGS_KEY, interval);
  await store.save();
}

export function normalizePluginSettings(
  settings: PluginSettings,
  plugins: PluginMeta[]
): PluginSettings {
  const knownIds = plugins.map((plugin) => plugin.id);
  const knownSet = new Set(knownIds);

  const order: string[] = [];
  const seen = new Set<string>();
  for (const id of settings.order) {
    if (!knownSet.has(id) || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  const newlyAdded: string[] = [];
  for (const id of knownIds) {
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
      newlyAdded.push(id);
    }
  }

  const disabled = settings.disabled.filter((id) => knownSet.has(id));
  for (const id of newlyAdded) {
    if (!DEFAULT_ENABLED_PLUGINS.has(id) && !disabled.includes(id)) {
      disabled.push(id);
    }
  }
  return { order, disabled };
}

export function arePluginSettingsEqual(
  a: PluginSettings,
  b: PluginSettings
): boolean {
  if (a.order.length !== b.order.length) return false;
  if (a.disabled.length !== b.disabled.length) return false;
  for (let i = 0; i < a.order.length; i += 1) {
    if (a.order[i] !== b.order[i]) return false;
  }
  for (let i = 0; i < a.disabled.length; i += 1) {
    if (a.disabled[i] !== b.disabled[i]) return false;
  }
  return true;
}

function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && THEME_MODES.includes(value as ThemeMode);
}

export async function loadThemeMode(): Promise<ThemeMode> {
  const stored = await store.get<unknown>(THEME_MODE_KEY);
  if (isThemeMode(stored)) return stored;
  return DEFAULT_THEME_MODE;
}

export async function saveThemeMode(mode: ThemeMode): Promise<void> {
  await store.set(THEME_MODE_KEY, mode);
  await store.save();
}

function isResetTimerDisplayMode(value: unknown): value is ResetTimerDisplayMode {
  return (
    typeof value === "string" &&
    RESET_TIMER_DISPLAY_MODES.includes(value as ResetTimerDisplayMode)
  );
}

export async function loadResetTimerDisplayMode(): Promise<ResetTimerDisplayMode> {
  const stored = await store.get<unknown>(RESET_TIMER_DISPLAY_MODE_KEY);
  if (isResetTimerDisplayMode(stored)) return stored;
  return DEFAULT_RESET_TIMER_DISPLAY_MODE;
}

export async function saveResetTimerDisplayMode(mode: ResetTimerDisplayMode): Promise<void> {
  await store.set(RESET_TIMER_DISPLAY_MODE_KEY, mode);
  await store.save();
}

function isMenubarIconStyle(value: unknown): value is MenubarIconStyle {
  return (
    typeof value === "string" &&
    MENUBAR_ICON_STYLES.includes(value as MenubarIconStyle)
  );
}

export async function loadMenubarIconStyle(): Promise<MenubarIconStyle> {
  const stored = await store.get<unknown>(MENUBAR_ICON_STYLE_KEY);
  if (isMenubarIconStyle(stored)) return stored;
  return DEFAULT_MENUBAR_ICON_STYLE;
}

export async function saveMenubarIconStyle(style: MenubarIconStyle): Promise<void> {
  await store.set(MENUBAR_ICON_STYLE_KEY, style);
  await store.save();
}

type LegacyStoreWithDelete = {
  delete?: (key: string) => Promise<void>;
};

async function deleteStoreKey(key: string): Promise<void> {
  const maybeDelete = (store as unknown as LegacyStoreWithDelete).delete;
  if (typeof maybeDelete === "function") {
    await maybeDelete.call(store, key);
    return;
  }
  // Fallback for store implementations without delete support.
  await store.set(key, null);
}

export async function migrateLegacyTraySettings(): Promise<void> {
  const [legacyTrayStyle, legacyShowPercentage, currentMenubarStyle] = await Promise.all([
    store.get<unknown>(LEGACY_TRAY_ICON_STYLE_KEY),
    store.get<unknown>(LEGACY_TRAY_SHOW_PERCENTAGE_KEY),
    store.get<unknown>(MENUBAR_ICON_STYLE_KEY),
  ]);

  const hasLegacyTrayStyle = legacyTrayStyle != null;
  const hasLegacyShowPercentage = legacyShowPercentage != null;
  if (!hasLegacyTrayStyle && !hasLegacyShowPercentage) return;

  if (hasLegacyTrayStyle && currentMenubarStyle == null) {
    if (legacyTrayStyle === "bars") {
      await store.set(MENUBAR_ICON_STYLE_KEY, "bars");
    } else if (legacyTrayStyle === "circle") {
      await store.set(MENUBAR_ICON_STYLE_KEY, "donut");
    }
  }

  const removals: Promise<void>[] = [];
  if (hasLegacyTrayStyle) removals.push(deleteStoreKey(LEGACY_TRAY_ICON_STYLE_KEY));
  if (hasLegacyShowPercentage) removals.push(deleteStoreKey(LEGACY_TRAY_SHOW_PERCENTAGE_KEY));
  await Promise.all(removals);
  await store.save();
}

export function getEnabledPluginIds(settings: PluginSettings): string[] {
  const disabledSet = new Set(settings.disabled);
  return settings.order.filter((id) => !disabledSet.has(id));
}

function isGlobalShortcut(value: unknown): value is GlobalShortcut {
  if (value === null) return true;
  return typeof value === "string";
}

export async function loadGlobalShortcut(): Promise<GlobalShortcut> {
  const stored = await store.get<unknown>(GLOBAL_SHORTCUT_KEY);
  if (isGlobalShortcut(stored)) return stored;
  return DEFAULT_GLOBAL_SHORTCUT;
}

export async function saveGlobalShortcut(shortcut: GlobalShortcut): Promise<void> {
  await store.set(GLOBAL_SHORTCUT_KEY, shortcut);
  await store.save();
}

export async function loadStatsShortcut(): Promise<GlobalShortcut> {
  const stored = await store.get<unknown>(STATS_SHORTCUT_KEY);
  if (isGlobalShortcut(stored)) return stored;
  return DEFAULT_STATS_SHORTCUT;
}

export async function saveStatsShortcut(shortcut: GlobalShortcut): Promise<void> {
  await store.set(STATS_SHORTCUT_KEY, shortcut);
  await store.save();
}

export async function loadStartOnLogin(): Promise<boolean> {
  const stored = await store.get<unknown>(START_ON_LOGIN_KEY);
  if (typeof stored === "boolean") return stored;
  return DEFAULT_START_ON_LOGIN;
}

export async function saveStartOnLogin(value: boolean): Promise<void> {
  await store.set(START_ON_LOGIN_KEY, value);
  await store.save();
}

function isWidgetLayout(value: unknown): value is WidgetLayout {
  return typeof value === "string" && WIDGET_LAYOUTS.includes(value as WidgetLayout);
}

export async function loadWidgetLayout(): Promise<WidgetLayout> {
  const stored = await store.get<unknown>(WIDGET_LAYOUT_KEY);
  if (isWidgetLayout(stored)) return stored;
  return DEFAULT_WIDGET_LAYOUT;
}

export async function saveWidgetLayout(layout: WidgetLayout): Promise<void> {
  await store.set(WIDGET_LAYOUT_KEY, layout);
  await store.save();
}

export async function loadWidgetVisible(): Promise<boolean> {
  const stored = await store.get<unknown>(WIDGET_VISIBLE_KEY);
  if (typeof stored === "boolean") return stored;
  return DEFAULT_WIDGET_VISIBLE;
}

export async function saveWidgetVisible(value: boolean): Promise<void> {
  await store.set(WIDGET_VISIBLE_KEY, value);
  await store.save();
}

function isWidgetPosition(value: unknown): value is WidgetPosition {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as WidgetPosition).x === "number" &&
    typeof (value as WidgetPosition).y === "number" &&
    Number.isFinite((value as WidgetPosition).x) &&
    Number.isFinite((value as WidgetPosition).y)
  );
}

export async function loadWidgetPosition(): Promise<WidgetPosition | null> {
  const stored = await store.get<unknown>(WIDGET_POSITION_KEY);
  if (isWidgetPosition(stored)) return stored;
  return null;
}

export async function saveWidgetPosition(position: WidgetPosition): Promise<void> {
  await store.set(WIDGET_POSITION_KEY, position);
  await store.save();
}

function isWidgetProviderIds(value: unknown): value is WidgetProviderIds {
  if (value === null) return true;
  return Array.isArray(value) && value.every((id) => typeof id === "string");
}

export async function loadWidgetProviderIds(): Promise<WidgetProviderIds> {
  const stored = await store.get<unknown>(WIDGET_PROVIDER_IDS_KEY);
  if (isWidgetProviderIds(stored)) return stored;
  return DEFAULT_WIDGET_PROVIDER_IDS;
}

export async function saveWidgetProviderIds(ids: WidgetProviderIds): Promise<void> {
  await store.set(WIDGET_PROVIDER_IDS_KEY, ids);
  await store.save();
}

function isWidgetMetric(value: unknown): value is WidgetMetric {
  return value === null || typeof value === "string";
}

export async function loadWidgetMetric(): Promise<WidgetMetric> {
  const stored = await store.get<unknown>(WIDGET_METRIC_KEY);
  if (isWidgetMetric(stored)) return stored;
  return DEFAULT_WIDGET_METRIC;
}

export async function saveWidgetMetric(metric: WidgetMetric): Promise<void> {
  await store.set(WIDGET_METRIC_KEY, metric);
  await store.save();
}
