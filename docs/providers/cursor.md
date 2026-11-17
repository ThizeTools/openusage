# Cursor

Account plugin. Sign in from Settings > Accounts (Cursor CLI browser login, poll). The plugin reads only the saved credentials and never local Cursor files.

## Sign-in and credentials

- `auth`: `{ "kind": "cursor" }`
- Saved credentials: the poll response, `accessToken` and `refreshToken` (both a 60-day JWT). `expiresAt` is taken from the JWT `exp`.

## Refresh

- `POST https://api2.cursor.sh/oauth/token` (JSON: `grant_type`, `client_id`, `refresh_token`).
- Runs 7 days before JWT `exp`, and once on 401/403 from the usage read.
- Response has `access_token` only; the new JWT becomes the next refresh token.
- `shouldLogout`, or `invalid_grant` and similar refusals: throws the sign-in message.
- If an early refresh fails while the token is still valid, the current token is kept and a warning is logged.
- Saves with `ctx.account.saveCredentials` (old fields merged, `expiresAt` recomputed).

## Endpoints

Connect RPC (`POST`, `Authorization: Bearer <accessToken>`, `Connect-Protocol-Version: 1`, body `{}`), base `https://api2.cursor.sh/aiserver.v1.DashboardService/`:

- `GetCurrentPeriodUsage` (required)
- `GetPlanInfo` (plan name)
- `GetCreditGrantsBalance` (Credits)
- `GetSandUsageStatus` (Grok Bot)

Cookie reads (`Cookie: WorkosCursorSessionToken=<userId>%3A%3A<accessToken>`, `userId` from JWT `sub`):

- `https://cursor.com/api/usage-summary` (membership, team/on-demand fallback)
- `https://cursor.com/api/usage?user=<userId>` (request-based fallback)
- `https://cursor.com/api/auth/stripe` (prepaid balance, added to Credits)
- `https://cursor.com/api/auth/me` (account label, email)

Optional reads that fail are logged and skipped.

## Metrics

| Line | Type | Source | Scope |
|---|---|---|---|
| Total Usage | percent (dollars for team) | `planUsage.totalPercentUsed` | overview, primary 1 |
| Cursor Models | percent | `planUsage.autoPercentUsed` | overview, primary 2 |
| Other Models | percent | `planUsage.apiPercentUsed` | overview, primary 3 |
| Requests | count (requests) | `/api/usage` `gpt-4` (fallback only) | overview, primary 4 |
| Credits | text, `$X left` | grants + Stripe balance | overview |
| Extra Usage | dollars (text when no limit) | `spendLimitUsage` / summary on-demand | detail |
| Grok Bot | percent | `GetSandUsageStatus` | detail |

Fallback to request-based usage is used for team, enterprise, and plans without a usable limit, as in the macOS app.

## Not ported

- Unified (merged Cursor, X, Grok) accounts: `usage-status`, `GetComplatCreditBalance`.
- Usage events history: `get-filtered-usage-events` is paged; skipped.
- Rate-limit and plan read caching: every probe reads fresh.
