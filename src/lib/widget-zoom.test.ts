import { describe, expect, it } from "vitest"
import {
  adjustWidgetZoom,
  clampWidgetZoom,
  formatWidgetZoomPercent,
  widgetZoomDeltaFromWheel,
  WIDGET_ZOOM_DEFAULT,
  WIDGET_ZOOM_MAX,
  WIDGET_ZOOM_MIN,
} from "@/lib/widget-zoom"

describe("widget-zoom", () => {
  it("clamps zoom to allowed range", () => {
    expect(clampWidgetZoom(0.1)).toBe(WIDGET_ZOOM_MIN)
    expect(clampWidgetZoom(9)).toBe(WIDGET_ZOOM_MAX)
    expect(clampWidgetZoom(Number.NaN)).toBe(WIDGET_ZOOM_DEFAULT)
  })

  it("formats percent label", () => {
    expect(formatWidgetZoomPercent(1)).toBe("100%")
    expect(formatWidgetZoomPercent(1.25)).toBe("125%")
  })

  it("adjusts zoom in small wheel steps", () => {
    const delta = widgetZoomDeltaFromWheel(-100)
    expect(delta).toBeGreaterThan(0)
    expect(delta).toBeLessThan(0.1)
    expect(adjustWidgetZoom(1, delta)).toBeGreaterThan(1)
  })
})
