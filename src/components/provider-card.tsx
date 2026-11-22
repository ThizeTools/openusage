import { Fragment, useMemo } from "react"
import { AlertCircle, AppWindow, Clock, ExternalLink, RefreshCw } from "lucide-react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { SkeletonLines } from "@/components/skeleton-lines"
import { UsageSparkline } from "@/components/usage-sparkline"
import { PluginError } from "@/components/plugin-error"
import { useNowTicker } from "@/hooks/use-now-ticker"
import { type ResetTimerDisplayMode } from "@/lib/settings"
import type { ManifestLine, MetricLine, PluginLink } from "@/lib/plugin-types"
import { groupLinesByType } from "@/lib/group-lines-by-type"
import { clamp01, formatCountNumber, formatFixedPrecisionNumber } from "@/lib/utils"
import { calculateDrift, calculatePaceStatus, type PaceStatus } from "@/lib/pace-status"
import { buildPaceDetailText, formatCompactDuration, getPaceStatusText, getRunsOutAtMs } from "@/lib/pace-tooltip"
import { formatAtLabel, formatResetAbsoluteLabel, formatResetRelativeLabel, formatResetTooltipText } from "@/lib/reset-tooltip"

interface ProviderCardProps {
  name: string
  plan?: string
  links?: PluginLink[]
  showSeparator?: boolean
  loading?: boolean
  error?: string | null
  /** Informational, not an error: e.g. the provider asked OpenUsage to wait. */
  notice?: string | null
  lines?: MetricLine[]
  skeletonLines?: ManifestLine[]
  lastUpdatedAt?: number | null
  onRetry?: () => void
  scopeFilter?: "overview" | "all"
  resetTimerDisplayMode?: ResetTimerDisplayMode
  onResetTimerDisplayModeToggle?: () => void
  /** Claude account instances (Windows, macOS): opens that account's Claude Desktop window. */
  onOpenClaudeDesktop?: () => void
  /** Why the last "Claude Desktop" click failed; shown under the buttons. */
  claudeDesktopError?: string | null
}

/** Same amber the plugins use for their own rate-limit badge. */
const NOTICE_COLOR = "#f59e0b"

const PACE_VISUALS: Record<PaceStatus, { dotClass: string }> = {
  ahead: { dotClass: "bg-green-500" },
  "on-track": { dotClass: "bg-yellow-500" },
  behind: { dotClass: "bg-red-500" },
}

function formatProgressValue(amount: number, format: Extract<MetricLine, { type: "progress" }>["format"]): string {
  if (format.kind === "percent") return `${Math.round(amount)}%`
  if (format.kind === "dollars") return `$${formatFixedPrecisionNumber(amount)}`
  return `${formatCountNumber(amount)} ${format.suffix}`
}

/** Signed value for the drift metric, e.g. "+5%", "-$1.20". */
function formatSignedProgressValue(
  value: number,
  format: Extract<MetricLine, { type: "progress" }>["format"]
): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : ""
  return `${sign}${formatProgressValue(Math.abs(value), format)}`
}

/** Colored dot indicator showing pace status */
function PaceIndicator({
  status,
  detailText,
  isLimitReached,
}: {
  status: PaceStatus
  detailText?: string | null
  isLimitReached?: boolean
}) {
  const colorClass = PACE_VISUALS[status].dotClass

  const statusText = getPaceStatusText(status)

  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <span
            {...props}
            className={`inline-block w-2 h-2 rounded-full ${colorClass}`}
            aria-label={isLimitReached ? "Limit reached" : statusText}
          />
        )}
      />
      <TooltipContent side="top" className="text-xs text-center">
        {isLimitReached ? (
          "Limit reached"
        ) : (
          <>
            <div>{statusText}</div>
            {detailText && <div className="text-[10px] opacity-60">{detailText}</div>}
          </>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

function formatRelativeTime(diffMs: number): string {
  const seconds = Math.floor(Math.max(0, diffMs) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function ProviderCard({
  name,
  plan,
  links = [],
  showSeparator = true,
  loading = false,
  error = null,
  notice = null,
  lines = [],
  skeletonLines = [],
  lastUpdatedAt,
  onRetry,
  scopeFilter = "all",
  resetTimerDisplayMode = "relative",
  onResetTimerDisplayModeToggle,
  onOpenClaudeDesktop,
  claudeDesktopError,
}: ProviderCardProps) {
  // Filter lines based on scope - match by label since runtime lines can differ from manifest
  const overviewLabels = new Set(
    skeletonLines
      .filter(line => line.scope === "overview")
      .map(line => line.label)
  )
  const filteredSkeletonLines = scopeFilter === "all"
    ? skeletonLines
    : skeletonLines.filter(line => line.scope === "overview")
  const filteredLines = scopeFilter === "all"
    ? lines
    : lines.filter(line => overviewLabels.has(line.label))

  const hasResetCountdown = filteredLines.some(
    (line) => line.type === "progress" && Boolean(line.resetsAt)
  )

  // "has ever loaded" — true if either we have a prior success timestamp,
  // or the parent is passing lines directly (tests + legacy state paths).
  const hasStaleData = lastUpdatedAt != null || filteredLines.length > 0
  const isRefreshingWithData = loading && hasStaleData

  const now = useNowTicker({
    enabled: hasResetCountdown,
    intervalMs: 30_000,
  })

  const visibleLinks = useMemo(
    () =>
      links
        .map((link) => ({
          label: link.label.trim(),
          url: link.url.trim(),
        }))
        .filter(
          (link) =>
            link.label.length > 0 &&
            link.url.length > 0 &&
            (link.url.startsWith("https://") || link.url.startsWith("http://"))
        ),
    [links]
  )

  return (
    <div>
      <div className="py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="relative flex items-center">
            <h2 className="text-lg font-semibold" style={{ transform: "translateZ(0)" }}>{name}</h2>
            {onRetry && (
              loading ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ml-1 pointer-events-none opacity-50"
                  style={{ transform: "translateZ(0)", backfaceVisibility: "hidden" }}
                  tabIndex={-1}
                >
                  <RefreshCw className="h-3 w-3 animate-spin" />
                </Button>
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    className="ml-1"
                    render={(props) => (
                      <Button
                        {...props}
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Retry"
                        onClick={(e) => {
                          e.currentTarget.blur()
                          onRetry()
                        }}
                        className="opacity-0 hover:opacity-100 focus-visible:opacity-100"
                        style={{ transform: "translateZ(0)", backfaceVisibility: "hidden" }}
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    )}
                  />
                  {lastUpdatedAt != null && (
                    <TooltipContent side="top">
                      Updated {formatRelativeTime(Date.now() - lastUpdatedAt)}
                    </TooltipContent>
                  )}
                </Tooltip>
              )
            )}
          </div>
          {plan && (
            <Badge
              variant="outline"
              className="truncate min-w-0 max-w-[50%]"
              title={plan}
            >
              {plan}
            </Badge>
          )}
        </div>
        {(visibleLinks.length > 0 || onOpenClaudeDesktop) && (
          <div className="mb-2 -mt-0.5 flex flex-wrap gap-1.5">
            {visibleLinks.map((link) => (
              <Button
                key={`${link.label}-${link.url}`}
                variant="outline"
                size="xs"
                className="h-6 max-w-full text-[11px]"
                onClick={() => {
                  openUrl(link.url).catch(console.error)
                }}
              >
                <span className="truncate">{link.label}</span>
                <ExternalLink className="size-3 opacity-70" />
              </Button>
            ))}
            {onOpenClaudeDesktop && (
              <Button
                variant="outline"
                size="xs"
                className="h-6 max-w-full text-[11px]"
                onClick={onOpenClaudeDesktop}
              >
                <span className="truncate">Claude Desktop</span>
                <AppWindow className="size-3 opacity-70" />
              </Button>
            )}
          </div>
        )}
        {claudeDesktopError ? <p role="alert" className="mb-2 text-xs text-destructive">{claudeDesktopError}</p> : null}
        {error && !hasStaleData && <PluginError message={error} />}

        {error && hasStaleData && (
          <Tooltip>
            <TooltipTrigger
              render={(props) => (
                <div
                  {...props}
                  className="flex items-center gap-1.5 mb-2 text-xs text-destructive"
                >
                  <AlertCircle className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{error}</span>
                </div>
              )}
            />
            <TooltipContent side="top" className="max-w-xs break-words text-xs">
              {error}
            </TooltipContent>
          </Tooltip>
        )}

        {notice && (
          <div
            role="status"
            className="flex items-center gap-1.5 mb-2 text-xs"
            style={{ color: NOTICE_COLOR }}
          >
            <Clock className="h-3 w-3 flex-shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {loading && !hasStaleData && !error && (
          <SkeletonLines lines={filteredSkeletonLines} />
        )}

        {hasStaleData && (
          <div className="space-y-4">
            {groupLinesByType(filteredLines).map((group, gi) =>
              group.kind === "text" ? (
                <div key={gi} className="space-y-1">
                  {group.lines.map((line, li) => (
                    <MetricLineRenderer
                      key={`${line.label}-${gi}-${li}`}
                      line={line}
                      resetTimerDisplayMode={resetTimerDisplayMode}
                      onResetTimerDisplayModeToggle={onResetTimerDisplayModeToggle}
                      now={now}
                      refreshing={isRefreshingWithData}
                    />
                  ))}
                </div>
              ) : (
                <Fragment key={gi}>
                  {group.lines.map((line, li) => (
                    <MetricLineRenderer
                      key={`${line.label}-${gi}-${li}`}
                      line={line}
                      resetTimerDisplayMode={resetTimerDisplayMode}
                      onResetTimerDisplayModeToggle={onResetTimerDisplayModeToggle}
                      now={now}
                      refreshing={isRefreshingWithData}
                    />
                  ))}
                </Fragment>
              )
            )}
          </div>
        )}

      </div>
      {showSeparator && <Separator />}
    </div>
  )
}

function MetricLineRenderer({
  line,
  resetTimerDisplayMode,
  onResetTimerDisplayModeToggle,
  now,
  refreshing,
}: {
  line: MetricLine
  resetTimerDisplayMode: ResetTimerDisplayMode
  onResetTimerDisplayModeToggle?: () => void
  now: number
  refreshing?: boolean
}) {
  if (line.type === "text") {
    return (
      <div>
        <div className="flex justify-between items-center h-[18px] gap-2">
          <span className="text-xs text-muted-foreground min-w-0 truncate" title={line.label}>
            {line.label}
          </span>
          <span
            className="text-xs text-muted-foreground truncate flex-shrink-0 max-w-[45%] text-right"
            style={line.color ? { color: line.color } : undefined}
            title={line.value}
          >
            {line.value}
          </span>
        </div>
        {line.subtitle && (
          <div className="text-[10px] text-muted-foreground text-right -mt-0.5">{line.subtitle}</div>
        )}
      </div>
    )
  }

  if (line.type === "badge") {
    return (
      <div>
        <div className="flex justify-between items-center h-[22px]">
          <span className="text-sm text-muted-foreground flex-shrink-0">{line.label}</span>
          <Badge
            variant="outline"
            className="truncate min-w-0 max-w-[60%]"
            style={
              line.color
                ? { color: line.color, borderColor: line.color }
                : undefined
            }
            title={line.text}
          >
            {line.text}
          </Badge>
        </div>
        {line.subtitle && (
          <div className="text-xs text-muted-foreground text-right -mt-0.5">{line.subtitle}</div>
        )}
      </div>
    )
  }

  if (line.type === "barChart") {
    return (
      <UsageSparkline label={line.label} points={line.points} note={line.note} color={line.color} />
    )
  }

  if (line.type === "progress") {
    const resetsAtMs = line.resetsAt ? Date.parse(line.resetsAt) : Number.NaN
    const periodDurationMs = line.periodDurationMs
    const hasPaceContext = Number.isFinite(resetsAtMs) && Number.isFinite(periodDurationMs)
    const hasTimeMarkerContext = hasPaceContext && periodDurationMs! > 0
    const drift = hasPaceContext
      ? calculateDrift(line.used, line.limit, resetsAtMs, periodDurationMs!, now)
      : null
    const periodStartMs = hasPaceContext ? resetsAtMs - periodDurationMs! : Number.NaN
    const elapsedFraction = hasPaceContext
      ? clamp01((now - periodStartMs) / periodDurationMs!)
      : null
    const expectedAmount = elapsedFraction !== null ? elapsedFraction * line.limit : null
    const percent = Math.round(clamp01(line.used / line.limit) * 10000) / 100

    const resetLabel = line.resetsAt
      ? resetTimerDisplayMode === "absolute"
        ? formatResetAbsoluteLabel(now, line.resetsAt)
        : formatResetRelativeLabel(now, line.resetsAt)
      : null
    const resetTooltipText = line.resetsAt
      ? formatResetTooltipText({
          nowMs: now,
          resetsAtIso: line.resetsAt,
          visibleMode: resetTimerDisplayMode,
        })
      : null

    const secondaryText =
      resetLabel ??
      (line.format.kind === "percent"
        ? `${line.limit}% cap`
        : line.format.kind === "dollars"
          ? `$${formatFixedPrecisionNumber(line.limit)} limit`
          : `${formatCountNumber(line.limit)} ${line.format.suffix}`)

    // Calculate pace status if we have reset time and period duration
    const paceResult = hasPaceContext
      ? calculatePaceStatus(line.used, line.limit, resetsAtMs, periodDurationMs!, now)
      : null
    const paceStatus = paceResult?.status ?? null
    // Expected-usage marker: always visible whenever the period is known.
    const paceMarkerValue =
      hasTimeMarkerContext && elapsedFraction !== null ? elapsedFraction * 100 : undefined
    const isLimitReached = line.used >= line.limit
    const paceDetailText =
      hasPaceContext && !isLimitReached
        ? buildPaceDetailText({
            paceResult,
            used: line.used,
            limit: line.limit,
            periodDurationMs: periodDurationMs!,
            resetsAtMs,
            nowMs: now,
          })
        : null

    const runsOutAtMs = hasPaceContext && !isLimitReached
      ? getRunsOutAtMs({
          paceResult,
          used: line.used,
          limit: line.limit,
          periodDurationMs: periodDurationMs!,
          resetsAtMs,
          nowMs: now,
        })
      : null
    // Mirrors the reset timer's relative/absolute toggle.
    const runsOutText = runsOutAtMs === null
      ? null
      : resetTimerDisplayMode === "absolute"
        ? `Runs out ${formatAtLabel(now, runsOutAtMs)}`
        : `Runs out in ${formatCompactDuration(runsOutAtMs - now)}`

    // All metrics under the bar: used, left, and (when the period is known)
    // drift vs. the ideal pace and the expected usage so far.
    const metricsParts = [
      `Used ${formatProgressValue(line.used, line.format)}`,
      `Left ${formatProgressValue(Math.max(0, line.limit - line.used), line.format)}`,
    ]
    if (drift !== null) metricsParts.push(`Drift ${formatSignedProgressValue(drift, line.format)}`)
    if (expectedAmount !== null) {
      metricsParts.push(`Expected ${formatProgressValue(expectedAmount, line.format)}`)
    }
    const metricsText = metricsParts.join(" · ")

    return (
      <div>
        <div className="text-sm font-medium mb-1.5 flex items-center gap-1.5">
          {line.label}
          {paceStatus && (
            <PaceIndicator status={paceStatus} detailText={paceDetailText} isLimitReached={isLimitReached} />
          )}
        </div>
        <Progress
          value={percent}
          indicatorColor={line.color}
          markerValue={paceMarkerValue}
          refreshing={refreshing}
        />
        <div className="flex flex-wrap justify-start items-center gap-x-3 gap-y-0.5 mt-1.5">
          <span className="text-xs text-muted-foreground tabular-nums">
            {metricsText}
          </span>
          {secondaryText && (
            resetTooltipText ? (
              <Tooltip>
                <TooltipTrigger
                  render={(props) =>
                    resetLabel && onResetTimerDisplayModeToggle ? (
                      <button
                        {...props}
                        type="button"
                        onClick={onResetTimerDisplayModeToggle}
                        className="text-xs text-muted-foreground tabular-nums hover:text-foreground transition-colors"
                      >
                        {secondaryText}
                      </button>
                    ) : (
                      <span {...props} className="text-xs text-muted-foreground tabular-nums">
                        {secondaryText}
                      </span>
                    )
                  }
                />
                <TooltipContent side="top">{resetTooltipText}</TooltipContent>
              </Tooltip>
            ) : resetLabel && onResetTimerDisplayModeToggle ? (
              <button
                type="button"
                onClick={onResetTimerDisplayModeToggle}
                className="text-xs text-muted-foreground tabular-nums hover:text-foreground transition-colors"
              >
                {secondaryText}
              </button>
            ) : (
              <span className="text-xs text-muted-foreground">
                {secondaryText}
              </span>
            )
          )}
        </div>
        {runsOutText && (
          <div className="flex justify-start items-center mt-0.5">
            <span className="text-xs text-muted-foreground tabular-nums">
              {runsOutText}
            </span>
          </div>
        )}
      </div>
    )
  }

  return null
}
