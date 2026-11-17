# Account-based plugins (sign in inside the app)

Like robinebers/openusage 0.8+: the user signs in from Settings → Accounts;
the plugin never reads other tools' files, keychains or databases.

## plugin.json → `auth`

One of (fields are camelCase; see `src-tauri/src/accounts/login.rs`):

- `oauth-pkce`: `authorizeUrl`, `tokenUrl`, `clientId?`, `clientSecret?`,
  `scopes` (space-separated), `redirectHost` (`localhost` default; use
  `127.0.0.1` if the provider requires it), `redirectPort` (0 = any free port),
  `redirectPath` (default `/callback`), `authorizeParams` (extra query),
  `tokenEncoding` (`form` default | `json`), `tokenParams` (subset of
  `grant_type, client_id, client_secret, code, state, redirect_uri,
  code_verifier`; default = all set except `state`).
- `device` (RFC 8628): `deviceUrl`, `tokenUrl`, `clientId`, `scope?`,
  `encoding` (`form` | `json`), `deviceParams`, `tokenParams` (extra fields),
  `verificationUrl?` (`{user_code}` replaced; else the response's
  `verification_uri_complete` / `verification_uri`).
- `cursor`: Cursor CLI browser login (no fields).
- `api-key`: `keyUrl?` (where to create a key), `fields?`
  (`[{ name, label, secret }]`, default one field `apiKey`).

Credentials saved after sign-in = the token endpoint's JSON response
(snake_case as the provider sends it, e.g. `access_token`, `refresh_token`,
`id_token`, `expires_in`) plus `expiresAt` (ms epoch, when `expires_in` is
present) and `obtainedAt` (ms). Cursor: its poll response (`accessToken`,
`refreshToken`, ...). API key: `{ <field name>: value }`.

## Runtime

With `auth`, the plugin runs once per account (instance id
`<plugin>@<account>`); with no accounts it is hidden. `ctx.account`:

- `id`, `label`, `credentials` (object above)
- `saveCredentials(jsonString)` → persist refreshed tokens (returns bool).
  Always save the full object (merge new fields over the old ones and
  recompute `expiresAt`).
- `setLabel(text)` → set the account name shown in the app, e.g. the email
  (ignored after the user renames it). Call it when the identity is known.

Missing/invalid credentials → `throw "Sign in again in Settings → Accounts."`.
Refresh ~5 min before `expiresAt`, and once on 401/403
(`ctx.util.retryOnceOnAuth`). Tests: `makeAccount()` in
`plugins/test-helpers.js`.
