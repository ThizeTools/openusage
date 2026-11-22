import { ProviderCard } from "@/components/provider-card"
import { useOpenClaudeDesktop } from "@/hooks/use-open-claude-desktop"
import type { PluginDisplayState } from "@/lib/plugin-types"
import type { ResetTimerDisplayMode } from "@/lib/settings"

interface ProviderDetailPageProps {
  plugin: PluginDisplayState | null
  onRetry?: () => void
  resetTimerDisplayMode: ResetTimerDisplayMode
  onResetTimerDisplayModeToggle?: () => void
}

export function ProviderDetailPage({
  plugin,
  onRetry,
  resetTimerDisplayMode,
  onResetTimerDisplayModeToggle,
}: ProviderDetailPageProps) {
  const { handlerFor, errorFor } = useOpenClaudeDesktop()

  if (!plugin) {
    return (
      <div className="text-center text-muted-foreground py-8">
        Provider not found
      </div>
    )
  }

  const pluginId = plugin.meta.id

  return (
    <ProviderCard
      name={plugin.meta.name}
      plan={plugin.data?.plan}
      links={plugin.meta.links}
      showSeparator={false}
      loading={plugin.loading}
      error={plugin.error}
      notice={plugin.notice}
      lines={plugin.data?.lines ?? []}
      skeletonLines={plugin.meta.lines}
      lastUpdatedAt={plugin.lastUpdatedAt}
      onRetry={onRetry}
      scopeFilter="all"
      resetTimerDisplayMode={resetTimerDisplayMode}
      onResetTimerDisplayModeToggle={onResetTimerDisplayModeToggle}
      onOpenClaudeDesktop={handlerFor(pluginId)}
      claudeDesktopError={errorFor(pluginId)}
    />
  )
}
