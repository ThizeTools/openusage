# GitHub Copilot

Tracks your personal GitHub Copilot quota.

## Sign-in

- Sign in from **Settings → Accounts** with a GitHub device code (github.com only).
- Scope: `read:user`. GitHub ignores the scopes a GitHub App asks for, so OpenUsage cannot narrow the token.
- GHE.com domains are not supported by this plugin.
- No refresh token: GitHub OAuth tokens do not expire here. A 401/403 asks you to sign in again.

## API

**Endpoint:** `GET https://api.github.com/copilot_internal/user`

```
Authorization: token <access_token>
Accept: application/json
Editor-Version: vscode/1.96.2
Editor-Plugin-Version: copilot-chat/0.26.7
User-Agent: GitHubCopilotChat/0.26.7
X-Github-Api-Version: 2025-04-01
```

**Login (account name):** `GET https://api.github.com/user` with `Authorization: Bearer <access_token>`. Its `login` field names the account.

## Displayed lines

| Line | Scope | Description |
|------|-------|-------------|
| Credits | overview (primary 1) | Premium interactions used, percent. Hidden when unlimited. |
| Chat | overview (primary 2) | Chat quota used, percent. |
| Completions | overview | Completions quota used, percent. |
| Extra Usage | detail | Overage count, shown only when the plan allows overage. |

Free-tier accounts without `quota_snapshots` use `limited_user_quotas` / `monthly_quotas` for Chat and Completions. Accounts with token-based billing show Credits as a count.

Progress lines carry `resetsAt` (from `quota_reset_date`) and a 30-day `periodDurationMs`.

## Errors

| Condition | Message |
|-----------|---------|
| No credentials | "Sign in again in Settings → Accounts." |
| 401/403 | "Sign in again in Settings → Accounts." |
| Other HTTP error | "Request failed (HTTP {status}). Try again later." |
| No usable data | "Copilot usage data is unavailable for this account." |
