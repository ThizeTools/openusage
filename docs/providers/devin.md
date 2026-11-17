# Devin

Account plugin. Sign in from Settings > Accounts: browser PKCE login on a loopback callback (`http://127.0.0.1:<port>/callback`), then a code exchange. The plugin reads only the saved credentials.

## Sign-in and credentials

- `auth`: `{ "kind": "oauth-pkce", authorizeUrl: https://app.devin.ai/auth/cli/continue, tokenUrl: https://api.devin.ai/auth/cli/token, redirectHost: 127.0.0.1, redirectPath: /callback, authorizeParams: { prompt: select_account }, tokenEncoding: json, tokenParams: [code, code_verifier] }`
- Saved credentials: the exchange response, `token`. The API key is `devin-session-token$<token>` (prefix added when missing).
- No refresh. A refused key (401/403) asks for sign-in.

## Endpoints

- `POST https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus` (JSON body with `metadata.apiKey`, `ideName`, `extensionName`, `ideVersion` 1.108.2). `api_server_url` in credentials overrides the host.

## Metrics

| Line | Type | Source | Scope |
|---|---|---|---|
| Weekly quota | percent | `weeklyQuotaRemainingPercent`, reset `weeklyQuotaResetAtUnix` | overview, primary 1 |
| Daily quota | percent | `dailyQuotaRemainingPercent`, reset `dailyQuotaResetAtUnix` | overview, primary 2 |
| Extra usage balance | text, `$X left` | `overageBalanceMicros` | detail |

When `planInfo.hideDailyQuota` is true, the daily quota is shown as the Weekly row.
The label is set to `userStatus.email`. Plan name is `planInfo.planName`.
