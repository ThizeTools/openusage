# Muse Code

Tracks [Muse Code](https://dev.meta.ai/usage) Session and Weekly usage.

## Sign in

- Add the account from Settings → Accounts and choose Muse Code. A Meta device code opens in the browser.
- The sign-in takes no scopes. The account takes the email Muse reports.

## Endpoints

| Purpose | Request |
|---|---|
| Device start | `POST https://auth.meta.com/oidc/device/authorization/` (form; `client_id=1031625952748946`) |
| Token poll | `POST https://auth.meta.com/oidc/device/token/` |
| Usage and plan | `POST https://api.meta.ai/muse-code/key` (bearer, `x-api-version: 1.0.0`, body `{"onboard":false}`) |

## Metrics

- **Session** (5 hours) and **Weekly**: percent used, with reset times.
- The plan name Muse reports (`subs_tier_name`).
- An account without a Muse Code subscription shows an error saying so.

## Secrets

- The usage response also carries the account's Model API key. The plugin reads only the subscription, usage and email fields, and never logs or stores that key.

## Limits of the port

- The sign-in has no refresh token. When the token expires or Meta refuses it, the account needs **Sign in again** in Settings → Accounts.
- Muse omits usage while the 5-hour window is idle. The plugin reads 0% for a window Muse does not report. It does not keep the last values it read, since the plugin keeps no state.
