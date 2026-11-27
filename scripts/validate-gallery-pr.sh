#!/usr/bin/env bash
# Validates a submitted package folder for the ali-kenjo/opaline-gallery PR CI check.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <package-dir> [opaline-bin]" >&2
  exit 2
fi

PKG_DIR="$1"
OPALINE_BIN="${2:-opaline}"

if ! command -v "$OPALINE_BIN" >/dev/null 2>&1; then
  echo "Building opaline binary to run validation..."
  cargo build --bin opaline --locked
  OPALINE_BIN="./target/debug/opaline"
fi

echo "Validating package directory: $PKG_DIR"
"$OPALINE_BIN" validate "$PKG_DIR"

TMP_OUT="$(mktemp -u /tmp/opaline-gallery-check-XXXXXX.opaline-plugin)"
trap 'rm -f "$TMP_OUT"' EXIT
"$OPALINE_BIN" pack "$PKG_DIR" --out "$TMP_OUT"
echo "Gallery PR check passed cleanly."
