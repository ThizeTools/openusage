import { LazyStore } from "@tauri-apps/plugin-store";
import type { PluginMeta } from "@/lib/plugin-types";

// Spec: persist plugin order + disabled list; new plugins append, default disabled unless in DEFAULT_ENABLED_PLUGINS.
export type PluginSettings = {
  order: string[];
  disabled: string[];
};

export type ThemeMode = "system" | "light" | "dark";

export type ResetTimerDisplayMode = "relative" | "absolute";

export type MenubarIconStyle = "provider" | "bars" | "donut";

export type WidgetProviderIds = string[] | null;

/** Metric labels shown in the widget, per plugin id (account ids included), in the user's order. */
export type WidgetProviderMetrics = Record<string, string[]>;

export type GlobalShortcut = string | null;

export const MENU_BAR_WIDGET_STYLES = ["stacked", "compact", "inline", "inline-compact"] as const;
export type MenuBarWidgetStyle = (typeof MENU_BAR_WIDGET_STYLES)[number];

/** macOS: usage drawn over each provider's app icon in the Dock. "pill" = value pill under the icon. */
export const DOCK_OVERLAY_STYLES = ["off", "pill"] as const;
export type DockOverlayStyle = (typeof DOCK_OVERLAY_STYLES)[number];

/**
 * The menu bar widget's background card: one parametric look instead of presets.
 * `color` is "auto" (follows the menu bar: dark card on a dark bar, white on a light one) or `#rrggbb`.
 * `opacity`, `glass` and `blur` are 0..100. Blur is real (native, macOS only); the PNG never draws it.
 */
export type MenuBarWidgetBackdrop = {
  enabled: boolean;
  color: "auto" | string;
  opacity: number;
  glass: number;
  blur: number;
};

/** Pace limits in percent of the expected pace: up to `healthy` is Healthy, up to `closeToLimit` is Close to limit, above is Over pace. */
export type PaceThresholds = { healthy: number; closeToLimit: number };

/** Custom tone colors as `#rrggbb`; a missing tone uses the built-in color. */
export type MenuBarWidgetColors = { ahead?: string; onTrack?: string; behind?: string };

export const MENU_BAR_TEXT_COLOR_MODES = ["mono", "color"] as const;
export type MenuBarTextColorMode = (typeof MENU_BAR_TEXT_COLOR_MODES)[number];

/** Per text part of the menu bar widget: drawn in the content color (mono) or in the pace tone color (color). */
export type MenuBarWidgetTextColors = {
  label: MenuBarTextColorMode;
  used: MenuBarTextColorMode;
  expected: MenuBarTextColorMode;
};

/** Per pace state: drawn in its tone color (color) or in the content color (mono). */
export type MenuBarWidgetToneModes = {
  ahead: MenuBarTextColorMode;
  onTrack: MenuBarTextColorMode;
  behind: MenuBarTextColorMode;
};

const SETTINGS_STORE_PATH = "settings.json";
const PLUGIN_SETTINGS_KEY = "plugins";
const THEME_MODE_KEY = "themeMode";
const RESET_TIMER_DISPLAY_MODE_KEY = "resetTimerDisplayMode";
const MENUBAR_ICON_STYLE_KEY = "menubarIconStyle";
const LEGACY_TRAY_ICON_STYLE_KEY = "trayIconStyle";
const LEGACY_TRAY_SHOW_PERCENTAGE_KEY = "trayShowPercentage";
const STATS_SHORTCUT_KEY = "statsShortcut";
const START_ON_LOGIN_KEY = "startOnLogin";
// New key: the old "widgetVisible" belonged to the floating widget.
const WIDGET_VISIBLE_KEY = "taskbarWidgetVisible";
const WIDGET_PROVIDER_IDS_KEY = "widgetProviderIds";
const WIDGET_PROVIDER_METRICS_KEY = "widgetProviderMetrics";
const PACE_THRESHOLDS_KEY = "paceThresholds";
// Legacy keys, migrated to MENU_BAR_WIDGET_BACKDROP_KEY when the new key is absent.
const LEGACY_MENU_BAR_WIDGET_CARD_KEY = "menuBarWidgetCard";
const LEGACY_MENU_BAR_WIDGET_BACKGROUND_KEY = "menuBarWidgetBackground";
const MENU_BAR_WIDGET_BACKDROP_KEY = "menuBarWidgetBackdrop";
const MENU_BAR_WIDGET_STYLE_KEY = "menuBarWidgetStyle";
const DOCK_OVERLAY_STYLE_KEY = "dockOverlayStyle";
const MENU_BAR_WIDGET_COLORS_KEY = "menuBarWidgetColors";
const MENU_BAR_WIDGET_TEXT_COLORS_KEY = "menuBarWidgetTextColors";
const MENU_BAR_WIDGET_TONE_MODES_KEY = "menuBarWidgetToneModes";

export const DEFAULT_THEME_MODE: ThemeMode = "system";
export const DEFAULT_RESET_TIMER_DISPLAY_MODE: ResetTimerDisplayMode = "relative";
export const DEFAULT_MENUBAR_ICON_STYLE: MenubarIconStyle = "provider";
export const DEFAULT_STATS_SHORTCUT: GlobalShortcut = null;
export const DEFAULT_START_ON_LOGIN = false;
export const DEFAULT_WIDGET_VISIBLE = true;
export const DEFAULT_WIDGET_PROVIDER_IDS: WidgetProviderIds = null;
export const DEFAULT_WIDGET_PROVIDER_METRICS: WidgetProviderMetrics = {};
export const DEFAULT_MENU_BAR_WIDGET_BACKDROP: MenuBarWidgetBackdrop = {
  enabled: true,
  color: "auto",
  opacity: 0,
  glass: 0,
  blur: 50,
};
export const DEFAULT_MENU_BAR_WIDGET_STYLE: MenuBarWidgetStyle = "compact";
export const DEFAULT_PACE_THRESHOLDS: PaceThresholds = { healthy: 80, closeToLimit: 100 };
export const DEFAULT_DOCK_OVERLAY_STYLE: DockOverlayStyle = "pill";
export const DEFAULT_MENU_BAR_WIDGET_COLORS: MenuBarWidgetColors = {};
export const DEFAULT_MENU_BAR_WIDGET_TEXT_COLORS: MenuBarWidgetTextColors = {
  label: "mono",
  used: "color",
  expected: "mono",
};
export const DEFAULT_MENU_BAR_WIDGET_TONE_MODES: MenuBarWidgetToneModes = {
  ahead: "mono",
  onTrack: "color",
  behind: "color",
};

export const SETTINGS_PLUGINS_CHANGED_EVENT = "settings:plugins-changed";

const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];
const RESET_TIMER_DISPLAY_MODES: ResetTimerDisplayMode[] = ["relative", "absolute"];
const MENUBAR_ICON_STYLES: MenubarIconStyle[] = ["provider", "donut", "bars"];
export const MENUBAR_ICON_STYLE_OPTIONS: { value: MenubarIconStyle; label: string }[] = [
  { value: "provider", label: "Plugin" },
  { value: "donut", label: "Donut" },
  { value: "bars", label: "Bars" },
];

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

// TODO(remove after 2026-09-01): One-time Windsurf -> Devin settings migration.
export function migrateWindsurfToDevin(settings: PluginSettings): PluginSettings {
  const hasDevin = settings.order.includes("devin");
  const hasWindsurf = settings.order.includes("windsurf");
  const windsurfWasDisabled = settings.disabled.includes("windsurf");
  const order = Array.from(
    new Set(settings.order.map((id) => (id === "windsurf" ? "devin" : id)))
  );
  let disabled = settings.disabled.filter((id) => id !== "windsurf");

  if (hasWindsurf && !windsurfWasDisabled) {
    disabled = disabled.filter((id) => id !== "devin");
  }

  if (!hasDevin && windsurfWasDisabled && !disabled.includes("devin")) {
    disabled.push("devin");
  }

  return {
    order,
    disabled: Array.from(new Set(disabled)),
  };
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
    // Account instances ("<plugin>@<accountId>") are enabled when first seen:
    // the user just signed in to them. Plain plugin ids keep the default list.
    const enabledByDefault = DEFAULT_ENABLED_PLUGINS.has(id) || id.includes("@");
    if (!enabledByDefault && !disabled.includes(id)) {
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

export async function loadWidgetVisible(): Promise<boolean> {
  const stored = await store.get<unknown>(WIDGET_VISIBLE_KEY);
  if (typeof stored === "boolean") return stored;
  return DEFAULT_WIDGET_VISIBLE;
}

export async function saveWidgetVisible(value: boolean): Promise<void> {
  await store.set(WIDGET_VISIBLE_KEY, value);
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

/** Keeps only the entries whose value is a list of strings; anything else is dropped. */
export function parseWidgetProviderMetrics(value: unknown): WidgetProviderMetrics {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const result: WidgetProviderMetrics = {};
  for (const [id, labels] of Object.entries(value)) {
    if (Array.isArray(labels) && labels.every((label) => typeof label === "string")) {
      result[id] = labels;
    }
  }
  return result;
}

export async function loadWidgetProviderMetrics(): Promise<WidgetProviderMetrics> {
  const stored = await store.get<unknown>(WIDGET_PROVIDER_METRICS_KEY);
  return parseWidgetProviderMetrics(stored);
}

export async function saveWidgetProviderMetrics(metrics: WidgetProviderMetrics): Promise<void> {
  await store.set(WIDGET_PROVIDER_METRICS_KEY, metrics);
  await store.save();
}

/** Both limits finite, 5 <= healthy < closeToLimit <= 150; rounded to integers. Anything else -> null. */
export function parsePaceThresholds(value: unknown): PaceThresholds | null {
  if (typeof value !== "object" || value === null) return null;
  const { healthy, closeToLimit } = value as Record<string, unknown>;
  if (typeof healthy !== "number" || typeof closeToLimit !== "number") return null;
  if (!Number.isFinite(healthy) || !Number.isFinite(closeToLimit)) return null;
  const result = { healthy: Math.round(healthy), closeToLimit: Math.round(closeToLimit) };
  return result.healthy >= 5 && result.healthy < result.closeToLimit && result.closeToLimit <= 150 ? result : null;
}

export async function loadPaceThresholds(): Promise<PaceThresholds> {
  const stored = await store.get<unknown>(PACE_THRESHOLDS_KEY);
  return parsePaceThresholds(stored) ?? { ...DEFAULT_PACE_THRESHOLDS };
}

export async function savePaceThresholds(value: PaceThresholds): Promise<void> {
  await store.set(PACE_THRESHOLDS_KEY, value);
  await store.save();
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

function clampPercent(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(100, Math.max(0, Math.round(value)))
}

/**
 * Validates a stored backdrop: each field keeps its value when valid (percentages are rounded and
 * clamped to 0..100, colors lowercased) and falls back to the default otherwise. Null when not an object.
 */
export function parseMenuBarWidgetBackdrop(value: unknown): MenuBarWidgetBackdrop | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const defaults = DEFAULT_MENU_BAR_WIDGET_BACKDROP
  const color =
    typeof source.color === "string" && HEX_COLOR.test(source.color)
      ? source.color.toLowerCase()
      : source.color === "auto"
        ? "auto"
        : defaults.color
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : defaults.enabled,
    color,
    opacity: clampPercent(source.opacity, defaults.opacity),
    glass: clampPercent(source.glass, defaults.glass),
    blur: clampPercent(source.blur, defaults.blur),
  }
}

/** Backdrop equivalent to a removed background preset (null when `value` is not one). */
export function migrateLegacyMenuBarWidgetBackground(value: unknown): MenuBarWidgetBackdrop | null {
  if (typeof value !== "string") return null
  const defaults = DEFAULT_MENU_BAR_WIDGET_BACKDROP
  if (value === "none") return { ...defaults, enabled: false }
  if (value === "solid") return { enabled: true, color: "auto", opacity: 92, glass: 0, blur: 0 }
  if (value === "inverted") return { enabled: true, color: "#ffffff", opacity: 95, glass: 0, blur: 0 }
  if (value === "dock" || value.startsWith("glass-")) {
    return { enabled: true, color: "auto", opacity: 55, glass: 60, blur: 60 }
  }
  return null
}

export function parseMenuBarWidgetStyle(value: unknown): MenuBarWidgetStyle | null {
  return typeof value === "string" && (MENU_BAR_WIDGET_STYLES as readonly string[]).includes(value)
    ? (value as MenuBarWidgetStyle)
    : null
}

/** The removed "ring", "bars" and "badge" styles migrate to "pill". */
export function parseDockOverlayStyle(value: unknown): DockOverlayStyle | null {
  if (value === "ring" || value === "bars" || value === "badge") return "pill"
  return typeof value === "string" && (DOCK_OVERLAY_STYLES as readonly string[]).includes(value)
    ? (value as DockOverlayStyle)
    : null
}

export async function loadMenuBarWidgetBackdrop(): Promise<MenuBarWidgetBackdrop> {
  const stored = await store.get<unknown>(MENU_BAR_WIDGET_BACKDROP_KEY)
  const parsed = parseMenuBarWidgetBackdrop(stored)
  if (parsed) return parsed
  // Migrate the removed background presets / boolean card only while the new key is absent.
  if (stored === undefined || stored === null) {
    const legacyBackground = migrateLegacyMenuBarWidgetBackground(
      await store.get<unknown>(LEGACY_MENU_BAR_WIDGET_BACKGROUND_KEY)
    )
    if (legacyBackground) return legacyBackground
    const legacyCard = await store.get<unknown>(LEGACY_MENU_BAR_WIDGET_CARD_KEY)
    if (legacyCard === false) return { ...DEFAULT_MENU_BAR_WIDGET_BACKDROP, enabled: false }
    if (legacyCard === true) return migrateLegacyMenuBarWidgetBackground("solid") ?? DEFAULT_MENU_BAR_WIDGET_BACKDROP
  }
  return { ...DEFAULT_MENU_BAR_WIDGET_BACKDROP }
}

export async function saveMenuBarWidgetBackdrop(value: MenuBarWidgetBackdrop): Promise<void> {
  await store.set(MENU_BAR_WIDGET_BACKDROP_KEY, value)
  await store.save()
}

export async function loadMenuBarWidgetStyle(): Promise<MenuBarWidgetStyle> {
  const stored = await store.get<unknown>(MENU_BAR_WIDGET_STYLE_KEY)
  return parseMenuBarWidgetStyle(stored) ?? DEFAULT_MENU_BAR_WIDGET_STYLE
}

export async function saveMenuBarWidgetStyle(value: MenuBarWidgetStyle): Promise<void> {
  await store.set(MENU_BAR_WIDGET_STYLE_KEY, value)
  await store.save()
}

export async function loadDockOverlayStyle(): Promise<DockOverlayStyle> {
  const stored = await store.get<unknown>(DOCK_OVERLAY_STYLE_KEY)
  return parseDockOverlayStyle(stored) ?? DEFAULT_DOCK_OVERLAY_STYLE
}

export async function saveDockOverlayStyle(value: DockOverlayStyle): Promise<void> {
  await store.set(DOCK_OVERLAY_STYLE_KEY, value)
  await store.save()
}

/** Keeps only the known tones whose value is a `#rrggbb` string (lowercased); anything else is dropped. */
export function parseMenuBarWidgetColors(value: unknown): MenuBarWidgetColors {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const result: MenuBarWidgetColors = {}
  for (const tone of ["ahead", "onTrack", "behind"] as const) {
    const color = source[tone]
    if (typeof color === "string" && HEX_COLOR.test(color)) result[tone] = color.toLowerCase()
  }
  return result
}

export async function loadMenuBarWidgetColors(): Promise<MenuBarWidgetColors> {
  const stored = await store.get<unknown>(MENU_BAR_WIDGET_COLORS_KEY)
  return parseMenuBarWidgetColors(stored)
}

export async function saveMenuBarWidgetColors(value: MenuBarWidgetColors): Promise<void> {
  await store.set(MENU_BAR_WIDGET_COLORS_KEY, value)
  await store.save()
}

/** Each known part keeps its stored mode when valid; anything else falls back to that part's default. */
export function parseMenuBarWidgetTextColors(value: unknown): MenuBarWidgetTextColors {
  const source =
    typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const result = { ...DEFAULT_MENU_BAR_WIDGET_TEXT_COLORS }
  for (const part of ["label", "used", "expected"] as const) {
    const mode = source[part]
    if (typeof mode === "string" && (MENU_BAR_TEXT_COLOR_MODES as readonly string[]).includes(mode)) {
      result[part] = mode as MenuBarTextColorMode
    }
  }
  return result
}

export async function loadMenuBarWidgetTextColors(): Promise<MenuBarWidgetTextColors> {
  const stored = await store.get<unknown>(MENU_BAR_WIDGET_TEXT_COLORS_KEY)
  return parseMenuBarWidgetTextColors(stored)
}

export async function saveMenuBarWidgetTextColors(value: MenuBarWidgetTextColors): Promise<void> {
  await store.set(MENU_BAR_WIDGET_TEXT_COLORS_KEY, value)
  await store.save()
}

/** Each pace state keeps its stored mode when valid; anything else falls back to "color". */
export function parseMenuBarWidgetToneModes(value: unknown): MenuBarWidgetToneModes {
  const source =
    typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const result = { ...DEFAULT_MENU_BAR_WIDGET_TONE_MODES }
  for (const tone of ["ahead", "onTrack", "behind"] as const) {
    const mode = source[tone]
    if (typeof mode === "string" && (MENU_BAR_TEXT_COLOR_MODES as readonly string[]).includes(mode)) {
      result[tone] = mode as MenuBarTextColorMode
    }
  }
  return result
}

export async function loadMenuBarWidgetToneModes(): Promise<MenuBarWidgetToneModes> {
  const stored = await store.get<unknown>(MENU_BAR_WIDGET_TONE_MODES_KEY)
  return parseMenuBarWidgetToneModes(stored)
}

export async function saveMenuBarWidgetToneModes(value: MenuBarWidgetToneModes): Promise<void> {
  await store.set(MENU_BAR_WIDGET_TONE_MODES_KEY, value)
  await store.save()
}

/** Colors a surface (Dock / Menu Bar) can override: tone colors, tone modes and text colors. Pace thresholds stay global. */
export type SurfaceColorsOverride = {
  colors: MenuBarWidgetColors
  textColors: MenuBarWidgetTextColors
  toneModes: MenuBarWidgetToneModes
}
export type SurfaceProvidersOverride = { providerIds: WidgetProviderIds; providerMetrics: WidgetProviderMetrics }
/** Per surface: `null` = use the global value. */
export type SurfaceOverrides = { colors: SurfaceColorsOverride | null; providers: SurfaceProvidersOverride | null }
export type WidgetSurface = "menuBar" | "dock"

export const DEFAULT_SURFACE_OVERRIDES: SurfaceOverrides = { colors: null, providers: null }

export function surfaceOverridesKey(surface: WidgetSurface): string {
  return surface === "dock" ? "dockOverrides" : "menuBarOverrides"
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** Each part is kept when it is an object; an invalid or missing part becomes null (= use the global value). */
export function parseSurfaceOverrides(value: unknown): SurfaceOverrides {
  const source = asRecord(value)
  if (!source) return DEFAULT_SURFACE_OVERRIDES
  const colorsSource = asRecord(source.colors)
  const providersSource = asRecord(source.providers)
  return {
    colors: colorsSource
      ? {
          colors: parseMenuBarWidgetColors(colorsSource.colors),
          textColors: parseMenuBarWidgetTextColors(colorsSource.textColors),
          toneModes: parseMenuBarWidgetToneModes(colorsSource.toneModes),
        }
      : null,
    providers:
      providersSource && isWidgetProviderIds(providersSource.providerIds)
        ? {
            providerIds: providersSource.providerIds,
            providerMetrics: parseWidgetProviderMetrics(providersSource.providerMetrics),
          }
        : null,
  }
}

export async function loadSurfaceOverrides(surface: WidgetSurface): Promise<SurfaceOverrides> {
  return parseSurfaceOverrides(await store.get<unknown>(surfaceOverridesKey(surface)))
}

export async function saveSurfaceOverrides(surface: WidgetSurface, value: SurfaceOverrides): Promise<void> {
  await store.set(surfaceOverridesKey(surface), value)
  await store.save()
}

/** The surface's own colors when it overrides them, else the global ones. */
export function effectiveColors(global: SurfaceColorsOverride, override: SurfaceOverrides): SurfaceColorsOverride {
  return override.colors ?? global
}

/** The surface's own providers when it overrides them, else the global ones. */
export function effectiveProviders(global: SurfaceProvidersOverride, override: SurfaceOverrides): SurfaceProvidersOverride {
  return override.providers ?? global
}
