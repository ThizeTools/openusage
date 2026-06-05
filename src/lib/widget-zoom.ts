export const WIDGET_ZOOM_MIN = 0.5
export const WIDGET_ZOOM_MAX = 2
export const WIDGET_ZOOM_DEFAULT = 1
/** Settings +/- buttons step (5%). */
export const WIDGET_ZOOM_SETTINGS_STEP = 0.05
/** Scroll wheel sensitivity — small on purpose. */
const WIDGET_ZOOM_WHEEL_SENSITIVITY = 0.0006

export function clampWidgetZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return WIDGET_ZOOM_DEFAULT
  return Math.min(WIDGET_ZOOM_MAX, Math.max(WIDGET_ZOOM_MIN, Math.round(zoom * 1000) / 1000))
}

export function adjustWidgetZoom(current: number, delta: number): number {
  return clampWidgetZoom(current + delta)
}

export function widgetZoomDeltaFromWheel(deltaY: number): number {
  return -deltaY * WIDGET_ZOOM_WHEEL_SENSITIVITY
}

export function formatWidgetZoomPercent(zoom: number): string {
  return `${Math.round(clampWidgetZoom(zoom) * 100)}%`
}

export function isWidgetZoom(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= WIDGET_ZOOM_MIN && value <= WIDGET_ZOOM_MAX
}
