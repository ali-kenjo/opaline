#!/usr/bin/env bash
# Builds auxiliary artifacts bundled into the .deb package before `pnpm tauri build --bundles deb`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Building opaline-privileged (release)..."
cargo build --release -p opaline-privileged --locked

echo "Compiling GNOME Shell helper GSettings schema..."
glib-compile-schemas "$ROOT/desktop-integration/schemas"

echo "Validating desktop entry and AppStream metainfo..."
if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "$ROOT/packaging/io.github.ali_kenjo.Opaline.desktop"
fi
if command -v appstreamcli >/dev/null 2>&1; then
  appstreamcli validate --no-net "$ROOT/packaging/metainfo/io.github.ali_kenjo.Opaline.metainfo.xml"
fi
