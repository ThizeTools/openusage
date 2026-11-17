# Copilot Org

Tracks one organization's Copilot billing for the current month.

## Sign-in

- Add it from **Settings → Accounts** as an API key account: enter the organization name and a GitHub token.
- Create a fine-grained token at https://github.com/settings/tokens with Organization permissions: Administration, Read-only. Use a token from an organization owner or billing manager.
- The token is saved as given. The first read happens on the next refresh, so a bad token shows as an error only then.

## API

**Endpoint:** `GET https://api.github.com/organizations/{org}/settings/billing/ai_credit/usage`

```
Authorization: Bearer <token>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
User-Agent: OpenUsage
```

The plugin sums the `usageItems` whose `product` is `Copilot`: `grossQuantity` is credits, `netAmount` is dollars billed beyond the included pool.

## Displayed lines

| Line | Scope | Description |
|------|-------|-------------|
| Org Credits | overview | AI credits the organization used this month. No limit, so no percent. |
| Org Spend | overview | Dollars billed beyond the included pool. |

The account is named after the organization.

## Errors

| Condition | Message |
|-----------|---------|
| Missing org or token | "Sign in again in Settings → Accounts." |
| 401/403 | "Sign in again in Settings → Accounts." |
| 404 | "GitHub has no organization “{org}” this token can read." |
| Other HTTP error | "Request failed (HTTP {status}). Try again later." |
| Unexpected report | "Unexpected GitHub billing response. Try again later." |
