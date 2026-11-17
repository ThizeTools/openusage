# Amp

Tracks Amp agent usage, orb hours, the free daily tier and individual credits.

## Sign-in

- Sign in from **Settings → Accounts** with an Amp device code. The browser opens `https://ampcode.com/auth/cli/device` with the code filled in.
- Refresh: WorkOS rotates the refresh token on each renewal. The access token lasts about 5 minutes, so it is renewed ahead of expiry (its own `exp`, since Amp sends no `expires_in`) and once on 401/403.
- Account name: the email from "Signed in as ..." in the usage text, or the `user.email` of the token response.

## API

**Usage:** `POST https://ampcode.com/api/internal?userDisplayBalanceInfo`

```
Authorization: Bearer <access_token>
Content-Type: application/json
Accept: application/json

{"method":"userDisplayBalanceInfo","params":{}}
```

The response carries `result.displayText`, the text `amp usage` prints. OpenUsage reads these rows:

- Tier row: `Amp <plan> Tier: agent usage $X of $Y remaining ... orb usage Ah of Bh ... period <start> to <end>`
- Free row: `Amp Free: $X/$Y remaining` or `Amp Free: N% remaining`
- Credits row: `Individual credits: $X remaining`

Refresh: `POST https://authapi.ampcode.com/user_management/authenticate` (JSON, `client_id`, `grant_type=refresh_token`, `refresh_token`).

## Displayed lines

| Line | Scope | Description |
|------|-------|-------------|
| Agent Usage | overview (primary 1) | Dollars used of the tier allowance; resets at period end. |
| Amp Free | overview (primary 2) | Free daily quota used, percent; 24-hour period. |
| Orb Hours | detail | Orb hours used of the tier allowance. |
| Credits | overview | Individual credits left, in dollars. |

The plan is the tier name (for example `Megawatt`), or `Free` when only Amp Free shows.

## Errors

| Condition | Message |
|-----------|---------|
| No credentials | "Sign in again in Settings → Accounts." |
| Refresh token refused, or 401/403 after retry | "Sign in again in Settings → Accounts." |
| Other HTTP error | "Amp usage request failed (HTTP {status}). Try again later." |
| Unreadable text | "Amp usage data is unreadable. Try again later." |
