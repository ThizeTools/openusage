# Releasing and auto-update

## How the user updates

1. The app checks for a new version when it opens and every 15 minutes (`src/hooks/use-app-update.ts`).
2. If there is one, it downloads in the background. The panel footer shows "Downloading update 42%".
3. When done, the footer shows a **Restart to update** button.
4. One click installs and reopens the app. Nothing else to do.

Updates are verified with a signature: the app only accepts files signed by the private key that matches the
`pubkey` in `src-tauri/tauri.conf.json`.

## One-time setup (already done on this Mac)

- Key pair: `~/.tauri/openusage-updater.key` (private), `~/.tauri/openusage-updater.key.pub` (public, already in
  `tauri.conf.json`), password in `~/.tauri/openusage-updater.password`. Back them up: if the key or password is
  lost, existing installs can never update again.
- GitHub repo secrets (Settings > Secrets and variables > Actions > New repository secret):
  - `TAURI_SIGNING_PRIVATE_KEY`: the content of `openusage-updater.key` (`pbcopy < ~/.tauri/openusage-updater.key`).
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the content of `openusage-updater.password`
    (`pbcopy < ~/.tauri/openusage-updater.password`).
- Optional, Mac only: `APPLE_CERTIFICATE` (base64 of a `.p12`), `APPLE_CERTIFICATE_PASSWORD`,
  `KEYCHAIN_PASSWORD`, `APPLE_SIGNING_IDENTITY`. Without them the Mac build is ad-hoc signed, which works, but macOS
  asks for Keychain access again after each update. Signing with the same Apple certificate every time avoids that.

## Publish a new version

```bash
bun scripts/release.mjs 0.7.1     # bumps package.json, tauri.conf.json, Cargo.toml, Cargo.lock
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "Release v0.7.1"
git tag v0.7.1
git push && git push origin v0.7.1
```

The `Publish` workflow (`.github/workflows/publish.yml`) builds Windows, Mac Apple Silicon and Mac Intel, creates the
GitHub release and uploads `latest.json` plus the `.sig` files. Installed apps find it at
`https://github.com/ThizeTools/openusage/releases/latest/download/latest.json`.

The tag, `package.json`, `tauri.conf.json` and `Cargo.toml` versions must match, or the workflow fails.

## First install

Apps installed before this setup were built with the old public key, so they cannot update. Install the first release
by hand from the GitHub release (Windows installer, Mac `.dmg`); updates are automatic from then on.
On Mac you can also keep using `scripts/install-mac-local.sh` for local builds.
