# Track all your AI coding subscriptions in one place

See your usage at a glance from your menu bar. No digging through dashboards.

![OpenUsage Screenshot](screenshot.png)

## Download

[**Download the latest release**](https://github.com/robinebers/openusage/releases/latest) (macOS, Apple Silicon & Intel)

The app auto-updates. Install once and you're set.

## What It Does

OpenUsage lives in your menu bar and shows you how much of your AI coding subscriptions you've used. Progress bars, badges, and clear labels. No mental math required.

- **One glance.** All your AI tools, one panel.
- **Always up-to-date.** Refreshes automatically on a schedule you pick.
- **Sign in inside the app.** Add accounts in Settings → Accounts (browser sign-in, device code or API key). Several accounts per provider. No CLI files needed.
- **Taskbar widget.** Usage lives right on the Windows taskbar, next to the clock: one icon per provider with Session / Weekly as used/expected, colored by pace. Hover for details, click for the stats panel, right-click for options. Same customization as the macOS menu bar widget in Settings: layout styles, background, text and pace colors, providers and metrics.
- **Dock overlay (macOS).** Usage drawn right on each provider's app icon in the Dock (Claude, Codex, Cursor, OpenCode, Kiro), one line per metric as used/expected. Follows the icon when apps open or quit. Needs Accessibility permission.
- **Pace thresholds and per-surface overrides.** Choose when usage counts as Healthy, Close to limit or Over pace; the Dock and the menu bar can each use their own providers and colors.
- **Global shortcuts.** Separate customizable shortcuts to toggle the stats popup and the taskbar widget from anywhere.
- **Dedicated Settings window.** Settings open in their own resizable window with custom Windows controls; the tray popup stays focused on your usage.
- **Lightweight.** Opens instantly, stays out of your way.
- **Plugin-based.** New providers get added without updating the whole app.
- **[Local HTTP API](docs/local-http-api.md).** Other apps can read your usage data from `127.0.0.1:6736`.
- **[Proxy support](docs/proxy.md).** Route provider HTTP requests through a SOCKS5 or HTTP proxy.

## Supported Providers

Sign in from Settings → Accounts:

- [**Amp**](docs/providers/amp.md) / agent usage, Amp Free, Orb hours, credits (device code)
- [**Antigravity**](docs/providers/antigravity.md) / Gemini, Claude and Argon windows (Google sign-in)
- [**ChatGPT / Codex**](docs/providers/codex.md) / session, weekly, Spark, extra usage (browser sign-in)
- [**Claude**](docs/providers/claude.md) / session, weekly, Sonnet, Fable, extra usage (browser sign-in)
- [**Copilot**](docs/providers/copilot.md) / credits, chat, completions (GitHub device code)
- [**Copilot Org**](docs/providers/copilot-org.md) / organization credits and spend (token)
- [**Cursor**](docs/providers/cursor.md) / total usage, Cursor/other models, extra usage, credits (browser sign-in)
- [**Devin**](docs/providers/devin.md) / daily, weekly, extra usage (browser sign-in)
- [**Grok**](docs/providers/grok.md) / weekly, pay-as-you-go (device code)
- [**Muse Code**](docs/providers/muse.md) / session, weekly (device code)
- [**Ollama**](docs/providers/ollama.md) / session, weekly, monthly, credits, history (API key)
- [**OpenCode**](docs/providers/opencode-go.md) / session, weekly, monthly (device code)
- [**OpenRouter**](docs/providers/openrouter.md) / balance, spend history, key limits (API key)
- [**Z.ai**](docs/providers/zai.md) / session, weekly, web searches (API key)

Read from local files (enable in Settings → Plugins):

- [**Factory / Droid**](docs/providers/factory.md) / standard, premium tokens
- [**JetBrains AI Assistant**](docs/providers/jetbrains-ai-assistant.md) / quota, remaining
- [**Kiro**](docs/providers/kiro.md) / credits, bonus credits, overages
- [**Kimi Code**](docs/providers/kimi.md) / session, weekly
- [**MiniMax**](docs/providers/minimax.md) / coding plan session
- [**Synthetic**](docs/providers/synthetic.md) / rate limits, subscription

Community contributions welcome.

Want a provider that's not listed? [Open an issue.](https://github.com/robinebers/openusage/issues/new)

## Open Source, Community Driven

OpenUsage is built by its users. Hundreds of people use it daily, and the project grows through community contributions: new providers, bug fixes, and ideas.

I maintain the project as a guide and quality gatekeeper, but this is your app as much as mine. If something is missing or broken, the best way to get it fixed is to contribute by opening an issue, or submitting a PR.

Plugins are currently bundled as we build our the API, but soon will be made flexible so you can build and load their own.

<a href="https://www.star-history.com/?repos=robinebers%2Fopenusage&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=robinebers/openusage&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=robinebers/openusage&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=robinebers/openusage&type=date&legend=top-left" />
 </picture>
</a>

### How to Contribute

- **Add a provider.** Each one is just a plugin. See the [Plugin API](docs/plugins/api.md).
- **Fix a bug.** PRs welcome. Provide before/after screenshots.
- **Request a feature.** [Open an issue](https://github.com/robinebers/openusage/issues/new) and make your case.

Keep it simple. No feature creep, no AI-generated commit messages, test your changes.

## Built Entirely with AI

Not a single line of code in this project was read or written by hand. 100% AI-generated, AI-reviewed, AI-shipped — using [Cursor](https://cursor.com), [Claude Code](https://docs.anthropic.com/en/docs/claude-code), and [Codex CLI](https://github.com/openai/codex).

OpenUsage is a real-world example of what I teach in the [AI Builder's Blueprint](https://itsbyrob.in/EBDqgJ6) — a proven process for building and shipping software with AI, no coding background required.

## Sponsors

OpenUsage is supported by our sponsors. Become a sponsor to get your logo here and on [openusage.ai](https://openusage.ai).

[Become a Sponsor](https://github.com/sponsors/robinebers)

<!-- Add sponsor logos here -->

## Credits

Inspired by [CodexBar](https://github.com/steipete/CodexBar) by [@steipete](https://github.com/steipete). Same idea, very different approach.

## License

[MIT](LICENSE)

---

<details>
<summary><strong>Build from source</strong></summary>

> **Warning**: The `main` branch may not be stable. It is merged directly without staging, so users are advised to use tagged versions for stable builds. Tagged versions are fully tested while `main` may contain unreleased features.

### Stack

- Bun
- Vite + React
- Tauri v2
- Rust

### Windows local build

Windows releases are not published automatically yet, but you can build locally from source:

```powershell
bun install
bun run bundle:plugins
bun run build
bun tauri build
```

For release builds with `.env` signing variables loaded:

```powershell
bun run build:release
```

The app uses the Windows tray and a native taskbar widget. Account tokens are encrypted with Windows DPAPI in the app data folder (`accounts/`).
