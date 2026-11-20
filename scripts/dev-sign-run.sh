#!/bin/sh
# Cargo runner on macOS (see src-tauri/.cargo/config.toml). Signs the `openusage` dev binary with the same stable
# identity as install-mac-local.sh before running it, so Keychain "Always Allow" and Accessibility permission survive
# rebuilds (an ad-hoc signature changes on every build). Other binaries (tests) run as they are.
# Override with OPENUSAGE_SIGNING_IDENTITY (a certificate name or SHA-1 hash from `security find-identity`).
set -e

BIN="$1"
IDENTITY="${OPENUSAGE_SIGNING_IDENTITY:-5E74D8F429D652BD0AFC7B5647D04D63A0112D43}" # Apple Development: Giovani Lobato (CCJ4F5HWH5)

if [ "$(basename "$BIN")" = "openusage" ]; then
  if security find-identity -v -p codesigning | grep -q -- "$IDENTITY"; then
    codesign --force --sign "$IDENTITY" --identifier com.sunstory.openusage "$BIN" \
      || echo "dev-sign-run: codesign failed, running with the ad-hoc signature" >&2
  else
    echo "dev-sign-run: signing identity \"$IDENTITY\" not found, running with the ad-hoc signature" >&2
  fi
fi

exec "$@"
