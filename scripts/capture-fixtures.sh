#!/usr/bin/env bash
# Captures a redacted snapshot of what Opaline's providers read (sysfs, procfs, D-Bus) into
# fixtures/<name>/ for the parser tests. Run as your normal user, not root.
#
# Usage: scripts/capture-fixtures.sh [name]   (default: hp-i5-10300h, the reference laptop)
#
# Review the diff before committing: the script redacts MAC addresses, serials, UUIDs, SSIDs,
# connection names, the user and host name, but check anyway.
set -euo pipefail
exec python3 -I "$(dirname "$0")/capture_fixtures.py" "$@"
