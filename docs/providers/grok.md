# Grok

Tracks Grok weekly credit usage and the pay-as-you-go cap.

> Reverse-engineered, undocumented API. May change without notice.

## Sign-in

- Sign in from **Settings → Accounts** with an xAI device code.
- Scopes: `openid email offline_access grok-cli:access`. OpenUsage does not ask for `api:access`, which would let the token run Grok models.
- Refresh: the access token is renewed about 5 minutes before `expiresAt`, and once on 401/403. A rotated refresh token is saved. A refused refresh token asks you to sign in again.
- Account name: the `email` in the `id_token`, when present.

## API

**Base URL:** `https://cli-chat-proxy.grok.com/v1`

| Endpoint | Use |
|----------|-----|
| `GET /billing?format=credits` | Weekly period, used percent, pay-as-you-go cap |
| `GET /settings` | `subscription_tier_display`, used as the plan |

Headers on both: `Authorization: Bearer <access_token>`, `X-XAI-Token-Auth: xai-grok-cli`, `Accept: application/json`, `User-Agent: OpenUsage`.

Refresh: `POST https://auth.x.ai/oauth2/token` (form body, `grant_type=refresh_token`, `client_id`, `refresh_token`).

## Displayed lines

| Line | Scope | Description |
|------|-------|-------------|
| Weekly | overview (primary 1) | Weekly included credits used, percent. Shown for weekly periods only. |
| Extra Usage | detail | Badge "Pay as you go" with the cap in the subtitle. Shown only when a cap is set. |

Team accounts without a personal quota show a "Notice" text line instead.

## Errors

| Condition | Message |
|-----------|---------|
| No credentials | "Sign in again in Settings → Accounts." |
| Refresh token refused, or 401/403 after retry | "Sign in again in Settings → Accounts." |
| Other HTTP error | "Grok usage request failed (HTTP {status}). Try again later." |
| Unreadable response | "Grok usage data is unreadable. Try again later." |
