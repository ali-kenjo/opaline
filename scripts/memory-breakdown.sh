#!/usr/bin/env bash
# Splits the PSS of every Opaline process by kind of mapping, to see where memory goes.
#
# Usage: scripts/memory-breakdown.sh [--csv]
#
# Categories (from /proc/<pid>/smaps):
#   heap      [heap] and anonymous mappings (malloc arenas, JS heap, GPU staging in RAM)
#   gpu       /dev/dri/*, /dev/nvidia*, dmabuf and DRM mappings (EGL/GL buffers)
#   shm       memfd:, /dev/shm, SYSV segments (Wayland/X11 window buffers)
#   libs      shared libraries (*.so*), charged by PSS share
#   files     other file-backed mappings (fonts, caches, icu data)
#   stack     [stack] and thread stacks
#   other     everything else ([vdso], [vvar], …)
set -euo pipefail
export LC_ALL=C

csv=0
[[ "${1:-}" == "--csv" ]] && csv=1

opaline_pids() {
  local pid
  for pid in $(pgrep -x opaline || true); do
    echo "$pid"
    pgrep -P "$pid" || true
  done | sort -un
}

mapfile -t pids < <(opaline_pids)
if [[ ${#pids[@]} -eq 0 ]]; then
  echo "Opaline is not running." >&2
  exit 1
fi

breakdown() {
  # Prints: heap gpu shm libs files stack other total (kB)
  awk '
    /^[0-9a-f]+-[0-9a-f]+ / {
      name = ""
      for (i = 6; i <= NF; i++) name = name (i > 6 ? " " : "") $i
      if (name == "" || name == "[heap]" || name ~ /^\[anon/) cat = "heap"
      else if (name ~ /^\/dev\/(dri|nvidia)/ || name ~ /dmabuf|^\/drm|anon_inode:dmabuf/) cat = "gpu"
      else if (name ~ /^\/memfd:|^\/dev\/shm|SYSV|^memfd:/) cat = "shm"
      else if (name ~ /\.so(\.|$)/) cat = "libs"
      else if (name ~ /^\[stack/) cat = "stack"
      else if (name ~ /^\//) cat = "files"
      else cat = "other"
      next
    }
    /^Pss:/ { kb[cat] += $2; total += $2 }
    END {
      printf "%d %d %d %d %d %d %d %d\n", kb["heap"], kb["gpu"], kb["shm"], kb["libs"], kb["files"], kb["stack"], kb["other"], total
    }' "/proc/$1/smaps"
}

mb() { awk -v k="$1" 'BEGIN { printf "%.1f", k / 1024 }'; }

if [[ $csv -eq 1 ]]; then
  echo "time,pid,process,heap,gpu,shm,libs,files,stack,other,total"
else
  printf '%-8s %-18s %8s %8s %8s %8s %8s %8s %8s %9s\n' PID PROCESS heap gpu shm libs files stack other "PSS (MB)"
fi
now="$(date -Iseconds)"
sum=0
for pid in "${pids[@]}"; do
  [[ -r /proc/$pid/smaps ]] || continue
  read -r heap gpu shm libs files stack other total <<<"$(breakdown "$pid")"
  sum=$((sum + total))
  comm="$(cat "/proc/$pid/comm")"
  args="$(tr '\0' ' ' <"/proc/$pid/cmdline")"
  [[ "$args" == *"--layer"* ]] && comm="opaline --layer"
  if [[ $csv -eq 1 ]]; then
    echo "$now,$pid,$comm,$heap,$gpu,$shm,$libs,$files,$stack,$other,$total"
  else
    printf '%-8s %-18s %8s %8s %8s %8s %8s %8s %8s %9s\n' "$pid" "$comm" \
      "$(mb "$heap")" "$(mb "$gpu")" "$(mb "$shm")" "$(mb "$libs")" "$(mb "$files")" \
      "$(mb "$stack")" "$(mb "$other")" "$(mb "$total")"
  fi
done
[[ $csv -eq 1 ]] || printf '\nTotal PSS: %s MB   budget: 280 MB\n' "$(mb "$sum")"
