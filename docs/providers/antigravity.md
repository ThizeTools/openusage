# Antigravity

Account plugin. Sign in from Settings > Accounts: Google OAuth (PKCE, loopback on `http://localhost:51121/oauth-callback`, `access_type=offline`, `prompt=consent`). The plugin reads only the saved credentials.

## Sign-in and credentials

- `auth`: `{ "kind": "oauth-pkce", authorizeUrl: https://accounts.google.com/o/oauth2/v2/auth, tokenUrl: https://oauth2.googleapis.com/token, clientId, clientSecret, scopes: cloud-platform + userinfo.email, redirectHost: localhost, redirectPort: 51121, redirectPath: /oauth-callback, authorizeParams: { access_type: offline, prompt: consent }, tokenEncoding: form }`
- The client id and secret are the installed-app pair shipped by the Antigravity app (same as the macOS app).
- Saved credentials: the token response (`access_token`, `refresh_token`, `expires_in`, `expiresAt`).

## Refresh

- `POST https://oauth2.googleapis.com/token` (form: `client_id`, `client_secret`, `refresh_token`, `grant_type=refresh_token`).
- Runs 5 minutes before `expiresAt` (only when a refresh token is present), and once when the quota read answers 401.
- Refused refresh (`invalid_grant` and similar): asks for sign-in. A failed early refresh with a still-valid token keeps the token and logs a warning.
- Saves merged credentials with `expiresAt = now + expires_in` (3600 s when absent).

## Endpoints

- `POST https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist` (plan and project). Falls back to `daily-cloudcode-pa`.
- `POST https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary`, then production `cloudcode-pa` when the daily answer is incomplete. Body: `{ project }` when known.
- Headers: `Authorization: Bearer <token>`, `User-Agent: antigravity/hub/2.24.0 (aidev_client; os_type=windows; arch=amd64)`.
- `GET https://www.googleapis.com/oauth2/v1/userinfo?alt=json` (account label, email).

## Metrics

| Line | Bucket | Scope |
|---|---|---|
| Gemini 5h | `gemini-5h` | overview, primary 1 |
| Gemini weekly | `gemini-weekly` | overview, primary 2 |
| Claude 5h | `3p-5h` | overview, primary 3 |
| Claude weekly | `3p-weekly` | overview, primary 4 |
| Argon weekly | group "Gemini 4 Argon", weekly window | detail |

All are percent lines (used = 100 minus remaining fraction) with the bucket reset time. Plan comes from `paidTier` / `currentTier`, mapped to Google AI Pro / Ultra / Ultra Lite.
