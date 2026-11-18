#!/bin/sh
# Builds OpenUsage.app for this Mac, signs it with a stable local identity and installs it in /Applications.
#
# Keychain items are partitioned by the signer's Team ID. Signing with an Apple Development certificate
# (Team ID 976MRYMX47) keeps "Always Allow" approvals across rebuilds; ad-hoc or self-signed builds have no
# Team ID, so macOS ties the approval to each build's hash and asks again after every install.
# Override with OPENUSAGE_SIGNING_IDENTITY (a certificate name or SHA-1 hash from `security find-identity`).
set -e

IDENTITY="${OPENUSAGE_SIGNING_IDENTITY:-5E74D8F429D652BD0AFC7B5647D04D63A0112D43}" # Apple Development: Giovani Lobato (CCJ4F5HWH5), team 976MRYMX47
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/src-tauri/target/release/bundle/macos/OpenUsage.app"
DEST="/Applications/OpenUsage.app"

if ! security find-identity -v -p codesigning | grep -q -- "$IDENTITY"; then
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
