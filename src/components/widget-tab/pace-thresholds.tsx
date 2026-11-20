import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { Button } from "@/components/ui/button"
import {
  DEFAULT_PACE_THRESHOLDS,
  loadPaceThresholds,
  savePaceThresholds,
  type PaceThresholds as Thresholds,
} from "@/lib/settings"

const MAX = 150
const STEP = 5
const SEGMENT_COLORS = { healthy: "rgba(108,203,95,.75)", close: "rgba(252,225,0,.75)", over: "rgba(255,98,81,.75)" }
/** Example line: used 42% when 50% was expected. */
const EXAMPLE_USED = 42
const EXAMPLE_EXPECTED = 50

type HandleKey = keyof Thresholds

/** Snap to steps of 5 and keep `healthy` >= 5, `closeToLimit` <= 150 and the two at least one step apart. */
function constrain(key: HandleKey, raw: number, current: Thresholds): Thresholds {
  const snapped = Math.round(raw / STEP) * STEP
  if (key === "healthy") return { ...current, healthy: Math.min(Math.max(snapped, STEP), current.closeToLimit - STEP) }
  return { ...current, closeToLimit: Math.min(Math.max(snapped, current.healthy + STEP), MAX) }
}

function stateName(ratio: number, thresholds: Thresholds): string {
  if (ratio <= thresholds.healthy) return "Healthy"
  if (ratio <= thresholds.closeToLimit) return "Close to limit"
  return "Over pace"
}

const pct = (value: number) => `${(value / MAX) * 100}%`

interface HandleProps {
  label: string
  value: number
  min: number
  max: number
  onMove: (clientX: number) => void
  onStep: (delta: number) => void
  onCommit: () => void
}

function Handle({ label, value, min, max, onMove, onStep, onCommit }: HandleProps) {
  const dragging = useRef(false)
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    onStep(event.key === "ArrowLeft" ? -STEP : STEP)
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = true
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.currentTarget.focus()
  }
  const onPointerUp = () => {
    if (!dragging.current) return
    dragging.current = false
    onCommit()
  }
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={`${value}% of expected pace`}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={(event) => dragging.current && onMove(event.clientX)}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="group absolute -bottom-1 -top-1 flex w-4 -translate-x-1/2 cursor-ew-resize touch-none justify-center outline-none"
      style={{ left: pct(value) }}
    >
      <span className="w-[3px] rounded-full bg-white shadow group-focus-visible:ring-3 group-focus-visible:ring-ring/60" />
    </div>
  )
}

/**
 * Global pace limits as a bar from 0% to 150% of the expected pace with two draggable handles
 * (green up to `healthy`, yellow up to `closeToLimit`, red above). Loads on mount, saves when a drag ends
 * or a key is pressed.
 */
export function PaceThresholds() {
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_PACE_THRESHOLDS)
  const bar = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    loadPaceThresholds()
      .then((stored) => {
        if (!cancelled) setThresholds(stored)
      })
      .catch((error) => console.error("Failed to load pace thresholds:", error))
    return () => {
      cancelled = true
    }
  }, [])

  const save = (next: Thresholds) =>
    savePaceThresholds(next).catch((error) => console.error("Failed to save pace thresholds:", error))

  const move = (key: HandleKey) => (clientX: number) => {
    const rect = bar.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const raw = ((clientX - rect.left) / rect.width) * MAX
    setThresholds((current) => constrain(key, raw, current))
  }
  const step = (key: HandleKey) => (delta: number) => {
    const next = constrain(key, thresholds[key] + delta, thresholds)
    if (next[key] === thresholds[key]) return
    setThresholds(next)
    void save(next)
  }
  const reset = () => {
    setThresholds(DEFAULT_PACE_THRESHOLDS)
    void save(DEFAULT_PACE_THRESHOLDS)
  }

  const isDefault =
    thresholds.healthy === DEFAULT_PACE_THRESHOLDS.healthy &&
    thresholds.closeToLimit === DEFAULT_PACE_THRESHOLDS.closeToLimit
  const ratio = Math.round((EXAMPLE_USED / EXAMPLE_EXPECTED) * 100)

  return (
    <div className="space-y-1.5" data-testid="pace-thresholds">
      <div ref={bar} className="relative h-8">
        <div className="absolute inset-0 flex overflow-hidden rounded-md">
          <span style={{ width: pct(thresholds.healthy), background: SEGMENT_COLORS.healthy }} />
          <span style={{ width: pct(thresholds.closeToLimit - thresholds.healthy), background: SEGMENT_COLORS.close }} />
          <span className="flex-1" style={{ background: SEGMENT_COLORS.over }} />
        </div>
        <Handle
          label="Healthy until"
          value={thresholds.healthy}
          min={STEP}
          max={thresholds.closeToLimit - STEP}
          onMove={move("healthy")}
          onStep={step("healthy")}
          onCommit={() => void save(thresholds)}
        />
        <Handle
          label="Close to limit until"
          value={thresholds.closeToLimit}
          min={thresholds.healthy + STEP}
          max={MAX}
          onMove={move("closeToLimit")}
          onStep={step("closeToLimit")}
          onCommit={() => void save(thresholds)}
        />
      </div>
      <div className="relative h-4 text-[11px] text-muted-foreground" aria-hidden>
        <span className="absolute -translate-x-1/2" style={{ left: pct(thresholds.healthy) }}>
          {thresholds.healthy}%
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: pct(thresholds.closeToLimit) }}>
          {thresholds.closeToLimit}%
        </span>
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground" aria-hidden>
        <span>0%</span>
        <span>{MAX}% of expected</span>
      </div>
      <div className="flex min-h-6 items-center gap-2">
        <p className="flex-1 text-xs text-muted-foreground" data-testid="pace-example">
          Example: used {EXAMPLE_USED}% when {EXAMPLE_EXPECTED}% was expected → {ratio}% of pace →{" "}
          {stateName(ratio, thresholds)}.
        </p>
        {!isDefault && (
          <Button type="button" variant="ghost" size="xs" onClick={reset}>
            Reset
          </Button>
        )}
      </div>
    </div>
  )
}
