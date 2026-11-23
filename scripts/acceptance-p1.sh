#!/usr/bin/env bash
# Phase 1 acceptance: Opaline's values next to the reference tools (docs/PLAN.md, Phase 1).
# Usage: scripts/acceptance-p1.sh [path-to-opaline]   (default target/debug/opaline)
# Values are sampled a few seconds apart, so small differences in live numbers are expected.
set -uo pipefail
# Reference tools print localized labels and decimal commas otherwise.
export LC_ALL=C
bin="${1:-target/debug/opaline}"
dump() { "$bin" --dump "$1" 2>/dev/null; }
j() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
hr() { printf '\n== %s\n' "$1"; }

hr "CPU (top)"
dump cpu. | j "'opaline load %.1f %%, %.0f MHz avg, %.1f °C' % (d['cpu.load'], d['cpu.freq'], d['cpu.temp'])"
top -bn2 -d1 | grep -E '^%Cpu' | tail -1 | awk '{print "top     load " 100-$8 " % (idle " $8 ")"}'

hr "Memory (free -b)"
dump memory.usage | j "'opaline used %d available %d total %d' % (d['memory.usage']['usedB'], d['memory.usage']['availableB'], d['memory.usage']['totalB'])"
free -b | awk '/^Mem/ {print "free    used " $3 " available " $7 " total " $2}'

hr "Temperatures (hwmon, as sensors reads them)"
dump cpu.temp | j "'opaline cpu %.1f °C' % d['cpu.temp']"
for h in /sys/class/hwmon/hwmon*; do
  case "$(cat "$h/name")" in coretemp|k10temp|zenpower) echo "hwmon   $(cat "$h/name") $(( $(cat "$h/temp1_input") / 1000 )) °C";; esac
done
dump storage.temps | j "'opaline nvme ' + str(d['storage.temps'])"
for h in /sys/class/hwmon/hwmon*; do [ "$(cat "$h/name")" = nvme ] && echo "hwmon   nvme $(awk '{printf "%.2f", $1/1000}' "$h/temp1_input") °C"; done

hr "GPU (nvidia-smi)"
dump gpu.1 | j "'opaline load %s temp %s vram %s power %s' % (d['gpu.1.load'], d['gpu.1.temp'], d['gpu.1.vram'].get('usedB') if isinstance(d['gpu.1.vram'], dict) else d['gpu.1.vram'], d['gpu.1.power'])"
command -v nvidia-smi >/dev/null && nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,memory.used,power.draw,pstate --format=csv,noheader

hr "Storage (df -B1)"
dump storage.drives | j "'\n'.join('opaline %s %s used %s avail %s' % (p.get('mount'), p['name'], p.get('usedB'), p.get('availB')) for dr in d['storage.drives'] for p in dr['partitions'] if 'mount' in p)"
df -B1 --output=target,source,used,avail -x tmpfs -x squashfs -x devtmpfs -x overlay -x efivarfs | tail -n +2 | awk '{print "df      " $1 " " $2 " used " $3 " avail " $4}'

hr "Network (ip -s link)"
dump network.interfaces | j "'opaline ' + ', '.join('%s %s %s' % (i['name'], i['kind'], 'up' if i['up'] else 'down') for i in d['network.interfaces'])"
ip -br link | awk '$1 != "lo" {print "ip      " $1 " " $2}'
dump network.wifi | j "'opaline wifi signal %s band %s bitrate %s Mbit/s' % (d['network.wifi'].get('signal'), d['network.wifi'].get('band'), d['network.wifi'].get('bitrateMbps')) if isinstance(d['network.wifi'], dict) else 'opaline ' + str(d['network.wifi'])"
command -v nmcli >/dev/null && nmcli -t -f IN-USE,SIGNAL,FREQ,RATE dev wifi | awk -F: '$1=="*" {print "nmcli   wifi signal " $2 " freq " $3 " rate " $4}'

hr "Battery (upower -d)"
dump power.battery | j "'opaline %s %% %s, capacity %.1f %%' % (d['power.battery']['percent'], d['power.battery']['state'], d['power.battery']['capacityPercent']) if isinstance(d['power.battery'], dict) else 'opaline ' + str(d['power.battery'])"
upower -d | awk '/battery_/{b=1} b && /percentage|state|capacity:/ {print "upower  " $1 " " $2} /^$/{b=0}' | head -3

hr "Docker (docker ps -a)"
dump docker. | j "'opaline ' + str(d['docker.state']) + '\n' + '\n'.join('opaline %s %s %s' % (c['name'], c['image'], c['state']) for c in (d['docker.containers'] if isinstance(d['docker.containers'], list) else []))"
command -v docker >/dev/null && docker --context desktop-linux ps -a --format 'docker  {{.Names}} {{.Image}} {{.State}}' 2>&1 | head -20
