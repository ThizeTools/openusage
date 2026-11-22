import { useState } from "react"
import { errorMessage } from "@/lib/accounts"
import { claudeAccountId, claudeDesktopSupported, openClaudeDesktop } from "@/lib/claude-desktop"

/** "Claude Desktop" button of Claude account cards: the click handler per plugin (undefined when the plugin is not a
 * Claude account or the platform has no Claude Desktop accounts) and the last failure, shown under that card. */
export function useOpenClaudeDesktop() {
  const [failure, setFailure] = useState<{ pluginId: string; message: string } | null>(null)
  const handlerFor = (pluginId: string): (() => void) | undefined => {
    const accountId = claudeDesktopSupported() ? claudeAccountId(pluginId) : null
    if (!accountId) return undefined
    return () => {
      setFailure(null)
      openClaudeDesktop(accountId).catch((err) => {
        console.error("Failed to open Claude Desktop:", err)
        setFailure({ pluginId, message: errorMessage(err) })
      })
    }
  }
  const errorFor = (pluginId: string) => (failure?.pluginId === pluginId ? failure.message : null)
  return { handlerFor, errorFor }
}
