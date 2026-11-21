import { useState } from "react"
import { ProviderCard } from "@/components/provider-card"
import { errorMessage } from "@/lib/accounts"
import { claudeAccountId, claudeDesktopSupported, openClaudeDesktop } from "@/lib/claude-desktop"
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
  const [desktopError, setDesktopError] = useState<{ pluginId: string; message: string } | null>(null)

  if (!plugin) {
    return (
      <div className="text-center text-muted-foreground py-8">
        Provider not found
      </div>
    )
  }

  const pluginId = plugin.meta.id
  const accountId = claudeDesktopSupported() ? claudeAccountId(pluginId) : null
  const handleOpenClaudeDesktop = accountId
    ? () => {
        setDesktopError(null)
        openClaudeDesktop(accountId).catch((err) => {
          console.error("Failed to open Claude Desktop:", err)
          setDesktopError({ pluginId, message: errorMessage(err) })
        })
      }
    : undefined

  return (
    <>
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
        onOpenClaudeDesktop={handleOpenClaudeDesktop}
      />
      {desktopError?.pluginId === pluginId ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {desktopError.message}
        </p>
      ) : null}
    </>
  )
}
