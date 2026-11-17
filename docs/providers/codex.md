# ChatGPT (Codex)

> Undocumented API. May change without notice.

## Sign-in

Settings → Accounts → Add → ChatGPT. OAuth 2.0 authorization code + PKCE with a loopback redirect on fixed port `1455`, path `/auth/callback`. The device-code fallback is not used. The app stores the token response; the plugin never reads Codex CLI's files or keychain.

- Authorize: `https://auth.openai.com/oauth/authorize` (extra params `id_token_add_organizations=true`, `codex_cli_simplified_flow=true`, `originator=pi`)
- Token: `POST https://auth.openai.com/oauth/token`, form body
- Scopes: `openid profile email offline_access`
- Client ID: `app_EMoamEEZ73f0CkXaXp7hrann`

## Identity

- Label: `email` claim of `id_token`.
- `ChatGPT-Account-Id` header: `chatgpt_account_id` from the `https://api.openai.com/auth` claim of `access_token`.

## Refresh

Proactive ~5 min before `expiresAt`, and once on 401/403.

```
POST https://auth.openai.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&client_id=app_EMoamEEZ73f0CkXaXp7hrann&refresh_token=…
```

The merged response is saved; `expiresAt` = now + `expires_in`, or the access token's `exp` when `expires_in` is absent.

## Endpoints

### GET https://chatgpt.com/backend-api/wham/usage

Headers: `Authorization: Bearer <access_token>`, `Accept: application/json`, `User-Agent: OpenUsage`, `ChatGPT-Account-Id` (when present).

Used: `plan_type`, `rate_limit.primary_window` / `secondary_window` (matched by `limit_window_seconds`, with `x-codex-*-used-percent` headers as fallback), `additional_rate_limits[]` entry whose `limit_name` or `metered_feature` contains "spark", `credits` (`has_credits`, `balance`), `spend_control.individual_limit`.

## Metrics

| Line | Source | Notes |
|---|---|---|
| Session | `rate_limit` 5h window | percent (overview) |
| Weekly | `rate_limit` 7d window | percent (overview) |
| Spark | Spark entry, 5h window | percent (detail) |
| Spark Weekly | Spark entry, 7d window | percent (detail) |
| Extra Usage | `credits.balance` | text: dollars at $0.04 per credit, subtitle = credit count |
| Credit Limit | `spend_control.individual_limit` | count of credits, with reset time |

Plan: `plan_type` mapped (`prolite` → Pro 100, `pro` → Pro 200, `promax` → Pro 500, `self_serve_business_prolite` → Business Premium, else title-cased).

## Not included

Rate-limit reset credits (read and consume), the code-review limit, the Reviews line, the Today / Yesterday / Last 30 Days history (`wham/analytics/*` and `wham/usage/*` reports) and the usage trend chart.
