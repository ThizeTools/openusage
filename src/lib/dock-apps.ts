/** macOS bundle ids of each provider's desktop app, by base plugin id. */
const DOCK_APP_BUNDLE_IDS: Record<string, string[]> = {
  claude: ["com.anthropic.claudefordesktop"],
  "opencode-go": ["ai.opencode.desktop"],
  codex: ["com.openai.codex"],
  cursor: ["com.todesktop.230313mzl4w4u92"],
  kiro: ["dev.kiro.desktop"],
}

/** Bundle ids of the provider's Dock app; the account suffix is ignored ("claude@1a2b" -> "claude"). Unknown -> []. */
export function dockBundleIdsFor(providerId: string): string[] {
  return DOCK_APP_BUNDLE_IDS[providerId.split("@")[0]] ?? []
}
