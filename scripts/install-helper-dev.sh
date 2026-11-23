#!/usr/bin/env bash
# Installs the desktop integration helper for this user only (~/.local, no sudo), for testing
# Native mode before there is a .deb. GNOME Shell loads it after the next login; Opaline enables
# it on its next start (Extensions API, else enabled-extensions). Remove with --remove.
set -euo pipefail
UUID="opaline-desktop@ali-kenjo.github.io"
SRC="$(cd "$(dirname "$0")/../desktop-integration" && pwd)"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

if [[ "${1:-}" == "--remove" ]]; then
  gnome-extensions disable "$UUID" 2>/dev/null || true
  rm -rf "$DEST"
  echo "Removed $DEST (log out and back in to unload it from the running shell)."
  exit 0
fi

mkdir -p "$DEST/schemas"
cp "$SRC"/metadata.json "$SRC"/*.js "$DEST/"
cp "$SRC"/schemas/*.gschema.xml "$DEST/schemas/"
glib-compile-schemas --strict "$DEST/schemas"
echo "Installed to $DEST"
echo "Log out and back in, then start Opaline: it switches to Native mode by itself."
