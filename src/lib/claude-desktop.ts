import { invoke } from "@tauri-apps/api/core"
import { isMacPlatform, isWindowsPlatform } from "@/lib/platform"

const CLAUDE_INSTANCE_PREFIX = "claude@"

/** OpenUsage account id of a Claude account instance (`claude@<accountId>`), else null. */
export function claudeAccountId(pluginId: string): string | null {
  if (!pluginId.startsWith(CLAUDE_INSTANCE_PREFIX)) return null
  const accountId = pluginId.slice(CLAUDE_INSTANCE_PREFIX.length)
  return accountId === "" ? null : accountId
}

/** Account part of an account instance's name: "Claude · Work" -> "Work"; a name without " · " stays whole. */
export function accountLabel(name: string): string {
  const at = name.lastIndexOf(" · ")
  return at < 0 ? name : name.slice(at + 3)
}

/** Opens Claude Desktop signed in as that OpenUsage Claude account (Windows, macOS). */
export function openClaudeDesktop(accountId: string): Promise<void> {
  return invoke("open_claude_desktop", { accountId })
}

/** Claude Desktop accounts side by side work on Windows and macOS. */
export function claudeDesktopSupported(): boolean {
  return isWindowsPlatform() || isMacPlatform()
}
