#!/bin/sh
# Builds OpenUsage.app for this Mac, signs it with a stable local identity and installs it in /Applications.
#
# The identity is a self-signed certificate made on this Mac (no Apple account; files in ~/.openusage-signing).
# Its designated requirement pins the certificate, so the Accessibility permission survives rebuilds. The Keychain
# is only used through Apple's `security` tool (see accounts/store.rs), so a new build never asks for the password.
# macOS shows an "unverified developer" warning the first time it opens. Not trusted on purpose: codesign does not
# need it, so the check below skips `-v`.
# Override with OPENUSAGE_SIGNING_IDENTITY (a certificate name or SHA-1 hash from `security find-identity`).
set -e

IDENTITY="${OPENUSAGE_SIGNING_IDENTITY:-A8541F368ACC8F3CB17E6A149C59A03364467871}" # OpenUsage Local Signing (self-signed)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/src-tauri/target/release/bundle/macos/OpenUsage.app"
DEST="/Applications/OpenUsage.app"

if ! security find-identity -p codesigning | grep -q -- "$IDENTITY"; then
  echo "error: code signing identity \"$IDENTITY\" not found in the keychain" >&2
  exit 1
fi

cd "$ROOT"
bun run bundle:plugins
APPLE_SIGNING_IDENTITY="$IDENTITY" bun tauri build --bundles app \
  --config '{"bundle":{"createUpdaterArtifacts":false}}'

codesign --verify --deep --strict "$APP"

osascript -e 'tell application "OpenUsage" to quit' 2>/dev/null || true
sleep 2
rm -rf "$DEST"
ditto "$APP" "$DEST"
open -a "$DEST"
echo "Installed $DEST (signed with \"$IDENTITY\")"
