#!/bin/sh
# Cargo runner on macOS (see src-tauri/.cargo/config.toml). Signs the `openusage` dev binary with the same stable
# self-signed identity as install-mac-local.sh before running it, so the Accessibility permission survives rebuilds
# (an ad-hoc signature changes on every build). Other binaries (tests) run as they are.
# Override with OPENUSAGE_SIGNING_IDENTITY (a certificate name or SHA-1 hash from `security find-identity`).
set -e

BIN="$1"
IDENTITY="${OPENUSAGE_SIGNING_IDENTITY:-A8541F368ACC8F3CB17E6A149C59A03364467871}" # OpenUsage Local Signing (self-signed)

if [ "$(basename "$BIN")" = "openusage" ]; then
  # No `-v`: the self-signed certificate is not trusted on purpose, and codesign does not need it to be.
  if security find-identity -p codesigning | grep -q -- "$IDENTITY"; then
    codesign --force --sign "$IDENTITY" --identifier com.sunstory.openusage "$BIN" \
      || echo "dev-sign-run: codesign failed, running with the ad-hoc signature" >&2
  else
    echo "dev-sign-run: signing identity \"$IDENTITY\" not found, running with the ad-hoc signature" >&2
  fi
fi

exec "$@"
