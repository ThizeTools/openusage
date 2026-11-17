# Z.ai

Tracks [Z.ai](https://z.ai) GLM Coding Plan quotas.

## Sign in

- Paste an API key from the [Z.ai key list](https://z.ai/manage-apikey/apikey-list) when adding the account.
- The key is stored in the app. The app does not read environment variables such as `ZAI_API_KEY`.

## Endpoints

| Purpose | Request |
|---|---|
| Quota | `GET https://api.z.ai/api/monitor/usage/quota/limit` (bearer) |
| Plan | `GET https://api.z.ai/api/biz/subscription/list` (bearer) |

## Metrics

- **Session** (windows shorter than a day) and **Weekly** (longer windows): percent used, with reset times.
- **Web Searches** (detail view): searches used out of the monthly limit.
- Plan name from the subscription list. A failed plan lookup leaves the plan out.
- A key without a GLM Coding Plan shows an error saying so.

## Not ported

- Limit Resets (banking and spending resets) is out of scope for the in-app sign-in port.

## Errors

- A rejected or missing key means **Sign in again** in Settings → Accounts.
