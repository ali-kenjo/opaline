#!/usr/bin/env bash
# Measures Opaline's own CPU and memory against the budgets in the brief (§7).
#
# Usage: scripts/measure-budget.sh [seconds]   (default 60)
#
# CPU is the summed utime+stime of every Opaline process (core, layer, WebKit helpers spawned
# by the layer) over the window, as a percentage of the whole machine (all logical CPUs).
# Memory is the summed PSS at the end of the window.
set -euo pipefail

window="${1:-60}"
hz="$(getconf CLK_TCK)"
cpus="$(nproc)"

opaline_pids() {
  local pid
  # Works in both Instant mode (core → layer → WebKit) and Native mode (gnome-shell → layer → WebKit).
  for pid in $(pgrep -x opaline || true); do
    echo "$pid"
    pgrep -P "$pid" || true
  done | sort -un
}

ticks() {
  local total=0 pid f
  for pid in "$@"; do
    f="/proc/$pid/stat"
    [[ -r "$f" ]] || continue
    # Fields 14 and 15 are utime and stime; strip "pid (comm)" first because comm may hold spaces.
    read -r -a fields <<<"$(sed 's/^.*) //' "$f")"
    total=$((total + fields[11] + fields[12]))
  done
  echo "$total"
}

mapfile -t pids < <(opaline_pids)
if [[ ${#pids[@]} -eq 0 ]]; then
  echo "Opaline is not running." >&2
  exit 1
fi

start="$(ticks "${pids[@]}")"
sleep "$window"
mapfile -t pids_end < <(opaline_pids)
end="$(ticks "${pids_end[@]}")"

cpu="$(awk -v d=$((end - start)) -v hz="$hz" -v w="$window" -v n="$cpus" \
  'BEGIN { printf "%.3f", 100 * d / hz / w / n }')"

pss_total=0
printf '%-8s %-18s %10s\n' PID PROCESS "PSS (MB)"
for pid in "${pids_end[@]}"; do
  [[ -r /proc/$pid/smaps_rollup ]] || continue
  pss="$(awk '/^Pss:/ { print $2 }' "/proc/$pid/smaps_rollup")"
  pss_total=$((pss_total + pss))
  printf '%-8s %-18s %10.1f\n' "$pid" "$(cat "/proc/$pid/comm")" "$(awk -v k="$pss" 'BEGIN { print k / 1024 }')"
done
printf '\nCPU over %ss: %s %% of the machine (%s logical CPUs)   budget idle: 0.5 %%\n' "$window" "$cpu" "$cpus"
printf 'Memory (PSS): %.1f MB   budget: 450 MB\n' "$(awk -v k="$pss_total" 'BEGIN { print k / 1024 }')"
