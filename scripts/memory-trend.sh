#!/usr/bin/env bash
# Records Opaline's memory over time: one breakdown row per process every INTERVAL seconds.
#
# Usage: scripts/memory-trend.sh INTERVAL COUNT OUT.csv
#   e.g. scripts/memory-trend.sh 600 48 /tmp/trend-8h.csv   (8 hours, every 10 minutes)
#
# Columns are those of `scripts/memory-breakdown.sh --csv` (kB). A summary of the first and last
# total per process is printed at the end, so a leak shows as a steady rise between them.
set -euo pipefail
export LC_ALL=C

interval="${1:?interval in seconds}"
count="${2:?number of samples}"
out="${3:?output csv}"
here="$(dirname "$0")"

"$here/memory-breakdown.sh" --csv >"$out"
for ((i = 1; i < count; i++)); do
  sleep "$interval"
  "$here/memory-breakdown.sh" --csv | tail -n +2 >>"$out" || echo "sample $i: Opaline not running" >&2
done

awk -F, 'NR > 1 {
  key = $3
  if (!(key in first)) first[key] = $11
  last[key] = $11
}
END {
  printf "%-18s %10s %10s %10s\n", "process", "first MB", "last MB", "change"
  for (k in first) printf "%-18s %10.1f %10.1f %+10.1f\n", k, first[k] / 1024, last[k] / 1024, (last[k] - first[k]) / 1024
}' "$out"
