import { invoke } from "@tauri-apps/api/core"
import { isMacPlatform, isWindowsPlatform } from "@/lib/platform"

const CLAUDE_INSTANCE_PREFIX = "claude@"

/** OpenUsage account id of a Claude account instance (`claude@<accountId>`), else null. */
export function claudeAccountId(pluginId: string): string | null {
  if (!pluginId.startsWith(CLAUDE_INSTANCE_PREFIX)) return null
  const accountId = pluginId.slice(CLAUDE_INSTANCE_PREFIX.length)
  return accountId === "" ? null : accountId
}

/** Opens Claude Desktop signed in as that OpenUsage Claude account (Windows, macOS). */
export function openClaudeDesktop(accountId: string): Promise<void> {
  return invoke("open_claude_desktop", { accountId })
}

/** Claude Desktop accounts side by side work on Windows and macOS. */
export function claudeDesktopSupported(): boolean {
  return isWindowsPlatform() || isMacPlatform()
}
