import { ProviderCard } from "@/components/provider-card"
import { Button } from "@/components/ui/button"
import type { PluginDisplayState } from "@/lib/plugin-types"
import { openSettingsTab } from "@/lib/settings-window"
import type { ResetTimerDisplayMode } from "@/lib/settings"

interface OverviewPageProps {
  plugins: PluginDisplayState[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  onRetryPlugin?: (pluginId: string) => void
  resetTimerDisplayMode: ResetTimerDisplayMode
  onResetTimerDisplayModeToggle?: () => void
}

export function OverviewPage({
  plugins,
  loading = false,
  error = null,
  onRetry,
  onRetryPlugin,
  resetTimerDisplayMode,
  onResetTimerDisplayModeToggle,
  }: OverviewPageProps) {
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 text-center text-muted-foreground py-8">
        <span>Failed to load providers</span>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="text-center text-muted-foreground py-8">
        Loading providers...
      </div>
    )
  }

  if (plugins.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 text-center text-muted-foreground py-8">
        <span>No providers enabled</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => openSettingsTab("accounts").catch((error) => console.error("Failed to open accounts settings:", error))}
        >
          Add an account
        </Button>
      </div>
    )
  }

  return (
    <div>
      {plugins.map((plugin, index) => (
        <ProviderCard
          key={plugin.meta.id}
          name={plugin.meta.name}
          plan={plugin.data?.plan}
          showSeparator={index < plugins.length - 1}
          loading={plugin.loading}
          error={plugin.error}
          notice={plugin.notice}
          lines={plugin.data?.lines ?? []}
          skeletonLines={plugin.meta.lines}
          lastUpdatedAt={plugin.lastUpdatedAt}
          onRetry={onRetryPlugin ? () => onRetryPlugin(plugin.meta.id) : undefined}
          scopeFilter="overview"
          resetTimerDisplayMode={resetTimerDisplayMode}
          onResetTimerDisplayModeToggle={onResetTimerDisplayModeToggle}
        />
      ))}
    </div>
  )
}
