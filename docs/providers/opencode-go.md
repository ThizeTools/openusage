# OpenCode

Tracks [OpenCode Go](https://opencode.ai/docs/go/) session, weekly and monthly usage caps.

## Sign in

- Add the account from Settings → Accounts and choose OpenCode. A device code opens the OpenCode Console.
- Pick the workspace on the page that opens. The account takes your Console email.
- Each workspace is a separate account; add the account again to track another workspace.
- The app never reads OpenCode's local `auth.json` or `opencode.db`.

## Endpoints

| Purpose | Request |
|---|---|
| Device start | `POST https://opencode.ai/console/auth/device/code` (form; `client_id=opencode-cli`, `supports_org_scope=true`) |
| Token poll and renewal | `POST https://opencode.ai/console/auth/device/token` |
| Caps | `GET https://opencode.ai/zen/go/v1/usage` (bearer, `x-opencode-org-id`) |
| Plan | `GET https://opencode.ai/console/api/go/status` (bearer, `x-org-id`) |
| Account name | `GET https://opencode.ai/console/api/user` (bearer, `x-org-id`) |

The workspace id is the `org_id` field of the token response.

## Metrics

- **Session** (5 hours), **Weekly** and **Monthly**: percent of each cap used, with reset times.
- Session shows no reset while its window is untouched.
- Plan: Go, Go Plus or Go Teams, as OpenCode names it. A failed plan lookup leaves the plan out.
- An account without a Go subscription shows a badge saying so.

## Refresh

- Renewed about 5 minutes before expiry, and once more on a 401/403, using the refresh token.
- A refused refresh token means **Sign in again** in Settings → Accounts.
