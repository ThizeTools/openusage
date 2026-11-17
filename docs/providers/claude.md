# Claude

> Undocumented API. May change without notice.

## Sign-in

Settings → Accounts → Add → Claude. OAuth 2.0 authorization code + PKCE with a loopback redirect (`http://localhost:<any free port>/callback`). The app stores the token response; the plugin never reads Claude Code's files or keychain.

- Authorize: `https://claude.ai/oauth/authorize` (extra param `code=true`)
- Token: `POST https://platform.claude.com/v1/oauth/token`, JSON body
- Scopes: `user:profile user:inference`
- Client ID: `9d1c250a-e61b-44d9-88ed-5944d1962f5e`

## Refresh

Proactive ~5 min before `expiresAt`, and once on 401/403.

```
POST https://platform.claude.com/v1/oauth/token
Content-Type: application/json

{"grant_type":"refresh_token","refresh_token":"…","client_id":"9d1c…","scope":"user:profile user:inference"}
```

If Anthropic answers 400 `invalid_scope`, the refresh repeats with `scope: "user:profile"`. The merged response (old fields + new) is saved with `expiresAt` = now + `expires_in`.

## Endpoints

### GET https://api.anthropic.com/api/oauth/usage

Headers: `Authorization: Bearer <access_token>`, `Accept: application/json`, `Content-Type: application/json`, `anthropic-beta: oauth-2025-04-20`, `User-Agent: claude-cli/2.1.294 (external, cli)`.

Used: `five_hour`, `seven_day`, `seven_day_sonnet`, `limits[]` (`kind: "weekly_scoped"`, `scope.model.display_name: "Fable"`), `extra_usage` (`is_enabled`, `used_credits` and `monthly_limit` in minor units, `decimal_places`, `currency`).

### GET https://api.anthropic.com/api/oauth/profile

Headers: `Authorization`, `Accept`, `anthropic-beta`. Used for the account label (`account.email`, or `email`) and the plan (`organization.organization_type`, `organization.rate_limit_tier`).

## Metrics

| Line | Source | Notes |
|---|---|---|
| Session | `five_hour` | percent, 5h period |
| Weekly | `seven_day` | percent, 7d period |
| Sonnet | `seven_day_sonnet` | percent, 7d period (detail) |
| Fable | `limits[]` Fable entry | percent, 7d period (detail) |
| Extra Usage | `extra_usage` | dollars with progress if `monthly_limit` > 0; text for other currencies |

Plan: `Ultra`, `Max`, or `<Type> <N>x` from the rate-limit tier (Pro, Team, Enterprise, ...).

HTTP 429 shows a `Status` badge "Rate limited, retry in ~Nm".

## Not included

Rate-limit reset grants and claiming, and the Claude Design line (`seven_day_omelette`) are not ported.
