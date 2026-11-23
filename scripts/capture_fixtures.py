"""Captures a redacted snapshot of the sysfs/procfs files and D-Bus replies Opaline's providers
read, for the parser tests (docs/PLAN.md task 1.3).

Run through scripts/capture-fixtures.sh. Output: fixtures/<name>/ with the same paths as on
the machine (proc/…, sys/…) plus dbus/*.json (busctl --json output).

Redacted: MAC addresses, serial numbers, WWNs, UUIDs, SSIDs and connection names, the user
name, the host name and home paths. Files that can't be read without root are skipped.
"""

import getpass
import glob
import json
import os
import re
import shutil
import socket
import subprocess
import sys
from pathlib import Path

MAX_FILE = 1 << 20

# Paths are globs; each match that is a readable regular file is copied.
FILES = [
    # CPU, memory, load
    "/proc/stat", "/proc/loadavg", "/proc/uptime", "/proc/cpuinfo", "/proc/meminfo",
    "/proc/pressure/cpu", "/proc/pressure/memory", "/proc/pressure/io", "/proc/swaps",
    "/sys/devices/system/cpu/online", "/sys/devices/system/cpu/present",
    "/sys/devices/system/cpu/cpufreq/policy*/scaling_cur_freq",
    "/sys/devices/system/cpu/cpufreq/policy*/scaling_min_freq",
    "/sys/devices/system/cpu/cpufreq/policy*/scaling_max_freq",
    "/sys/devices/system/cpu/cpufreq/policy*/cpuinfo_max_freq",
    "/sys/devices/system/cpu/cpufreq/policy*/cpuinfo_min_freq",
    "/sys/devices/system/cpu/cpufreq/policy*/scaling_driver",
    "/sys/devices/system/cpu/cpufreq/policy*/scaling_governor",
    "/sys/devices/system/cpu/cpufreq/policy*/affected_cpus",
    "/sys/devices/system/cpu/cpu[0-9]*/thermal_throttle/*",
    "/sys/devices/system/cpu/cpu[0-9]*/topology/core_id",
    "/sys/devices/system/cpu/cpu[0-9]*/topology/physical_package_id",
    "/sys/module/zswap/parameters/enabled",
    # Sensors
    "/sys/class/hwmon/hwmon*/name",
    "/sys/class/hwmon/hwmon*/temp*_input", "/sys/class/hwmon/hwmon*/temp*_label",
    "/sys/class/hwmon/hwmon*/temp*_max", "/sys/class/hwmon/hwmon*/temp*_crit",
    "/sys/class/hwmon/hwmon*/fan*_input", "/sys/class/hwmon/hwmon*/fan*_label",
    "/sys/class/hwmon/hwmon*/fan*_max", "/sys/class/hwmon/hwmon*/power*_input",
    "/sys/class/hwmon/hwmon*/power*_average", "/sys/class/hwmon/hwmon*/power*_cap",
    "/sys/class/thermal/thermal_zone*/type", "/sys/class/thermal/thermal_zone*/temp",
    "/sys/class/powercap/intel-rapl*/name",
    "/sys/class/powercap/intel-rapl*/max_energy_range_uj",
    # GPUs
    "/sys/class/drm/card[0-9]*/device/vendor", "/sys/class/drm/card[0-9]*/device/device",
    "/sys/class/drm/card[0-9]*/device/boot_vga", "/sys/class/drm/card[0-9]*/device/uevent",
    "/sys/class/drm/card[0-9]*/device/power/runtime_status",
    "/sys/class/drm/card[0-9]*/device/power/control",
    "/sys/class/drm/card[0-9]*/device/power/runtime_suspended_time",
    "/sys/class/drm/card[0-9]*/device/power/runtime_active_time",
    "/sys/class/drm/card[0-9]*-*/status",
    "/sys/class/drm/card[0-9]*/gt_*_freq_mhz",
    "/sys/class/drm/card[0-9]*/gt/gt*/rc6_residency_ms",
    "/sys/class/drm/card[0-9]*/device/gpu_busy_percent",
    "/sys/class/drm/card[0-9]*/device/mem_info_vram_used",
    "/sys/class/drm/card[0-9]*/device/mem_info_vram_total",
    "/proc/driver/nvidia/gpus/*/power",
    # Storage
    "/proc/self/mountinfo", "/proc/diskstats",
    "/sys/block/*/size", "/sys/block/*/removable", "/sys/block/*/ro",
    "/sys/block/*/queue/rotational", "/sys/block/*/device/model", "/sys/block/*/device/vendor",
    "/sys/block/*/*/partition", "/sys/block/*/*/size",
    # Network
    "/proc/net/dev", "/proc/net/route",
    "/sys/class/net/*/statistics/rx_bytes", "/sys/class/net/*/statistics/tx_bytes",
    "/sys/class/net/*/speed", "/sys/class/net/*/operstate", "/sys/class/net/*/type",
    "/sys/class/net/*/carrier", "/sys/class/net/*/flags",
    # Power
    "/sys/class/power_supply/*/type", "/sys/class/power_supply/*/online",
    "/sys/class/power_supply/*/status", "/sys/class/power_supply/*/capacity",
]

# Directories whose presence (not content) matters, e.g. "is this interface physical?".
MARKERS = ["/sys/class/net/*/device", "/sys/class/net/*/wireless", "/sys/class/net/*/bridge",
           "/sys/class/net/*/tun_flags", "/sys/block/*/device"]

# Loop devices: keep two, so the "exclude snaps" rule is exercised without 60 copies.
LOOP_KEEP = {"loop0", "loop1"}

REDACT_KEYS = {
    "Serial", "WWN", "Id", "UUID", "IdUUID", "Ssid", "HwAddress", "PermHwAddress",
    "Symlinks", "Uuid", "SerialNumber", "Hostname", "Ip4Address", "Ip6Address",
    "xesam:url", "mpris:artUrl", "Address", "Name", "Alias", "NativePath",
}


def redact_text(text: str) -> str:
    user = getpass.getuser()
    host = socket.gethostname()
    text = re.sub(r"(?i)\b([0-9a-f]{2}:){5}[0-9a-f]{2}\b", "00:00:00:00:00:00", text)
    text = text.replace(f"/home/{user}", "/home/user")
    if len(user) > 2:
        text = re.sub(rf"\b{re.escape(user)}\b", "user", text)
    if len(host) > 2 and host not in ("ubuntu", "localhost"):
        text = re.sub(rf"\b{re.escape(host)}\b", "host", text)
    return text


def skip(path: str) -> bool:
    parts = path.split("/")
    return any(p.startswith("loop") and p not in LOOP_KEEP for p in parts)


def copy_files(dest: Path) -> int:
    count = 0
    for pattern in FILES:
        for src in sorted(glob.glob(pattern)):
            if skip(src) or not os.path.isfile(src):
                continue
            try:
                with open(src, "rb") as f:
                    data = f.read(MAX_FILE)
            except OSError:
                continue  # root-only (RAPL energy, some debug files) or vanished
            target = dest / src.lstrip("/")
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                target.write_text(redact_text(data.decode("utf-8")))
            except UnicodeDecodeError:
                target.write_bytes(data)
            count += 1
    for pattern in MARKERS:
        for src in glob.glob(pattern):
            if skip(src) or not os.path.exists(src):
                continue
            target = dest / src.lstrip("/")
            target.mkdir(parents=True, exist_ok=True)
            (target / ".present").write_text("")
    return count


def redact_json(node):
    if isinstance(node, dict):
        out = {}
        for key, value in node.items():
            if key in REDACT_KEYS and isinstance(value, dict) and "type" in value:
                out[key] = {"type": value["type"], "data": placeholder(value["type"])}
            else:
                out[key] = redact_json(value)
        return out
    if isinstance(node, list):
        return [redact_json(v) for v in node]
    if isinstance(node, str):
        return redact_text(node)
    return node


def placeholder(sig: str):
    if sig == "s" or sig == "o":
        return "/redacted" if sig == "o" else "redacted"
    if sig == "ay":
        return list(b"redacted")
    if sig.startswith("a"):
        return []
    return 0 if sig in "ybnqiuxtd" else "redacted"


def busctl(bus: str, *args: str):
    try:
        out = subprocess.run(["busctl", f"--{bus}", "--json=short", *args],
                             capture_output=True, text=True, timeout=10, check=True).stdout
        return json.loads(out)
    except (subprocess.SubprocessError, json.JSONDecodeError, OSError):
        return None


def get_all(bus, service, path, iface):
    return busctl(bus, "call", service, path, "org.freedesktop.DBus.Properties", "GetAll", "s",
                  iface)


def secrets(node, found: set):
    """Collects the string values of redacted keys, which also appear elsewhere (UDisks2 puts
    the drive serial into object paths)."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key in REDACT_KEYS and isinstance(value, dict):
                data = value.get("data")
                for item in data if isinstance(data, list) else [data]:
                    if isinstance(item, str) and len(item) >= 6:
                        found.add(item)
            secrets(value, found)
    elif isinstance(node, list):
        for value in node:
            secrets(value, found)
    return found


def save(dest: Path, name: str, reply) -> int:
    if reply is None:
        return 0
    text = json.dumps(redact_json(reply), indent=1, sort_keys=True)
    # Each secret gets its own placeholder, so two drives keep two distinct object paths.
    for i, secret in enumerate(sorted(secrets(reply, set()), key=len, reverse=True), 1):
        text = text.replace(json.dumps(secret)[1:-1], f"redacted{i}")
        # Object paths escape non-alphanumerics as _xx; serials are alphanumeric anyway.
        text = text.replace(re.sub(r"[^A-Za-z0-9]", "_", secret), f"redacted{i}")
    target = dest / "dbus" / f"{name}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text + "\n")
    return 1


def drop_loops(reply):
    """Keeps two snap loop devices out of ~60 in a UDisks2 object dump."""
    if not reply:
        return reply
    objects = reply["data"][0]
    reply["data"][0] = {path: v for path, v in objects.items()
                        if not skip(path.rsplit("/", 1)[-1])}
    return reply


def capture_dbus(dest: Path) -> int:
    n = 0
    # UPower: devices and their properties.
    devices = busctl("system", "call", "org.freedesktop.UPower", "/org/freedesktop/UPower",
                     "org.freedesktop.UPower", "EnumerateDevices")
    n += save(dest, "upower-devices", devices)
    for path in (devices or {}).get("data", [[]])[0]:
        n += save(dest, "upower-" + path.rsplit("/", 1)[-1],
                  get_all("system", "org.freedesktop.UPower", path, "org.freedesktop.UPower.Device"))
    n += save(dest, "upower-display", get_all("system", "org.freedesktop.UPower",
              "/org/freedesktop/UPower/devices/DisplayDevice", "org.freedesktop.UPower.Device"))
    n += save(dest, "upower", get_all("system", "org.freedesktop.UPower", "/org/freedesktop/UPower",
              "org.freedesktop.UPower"))
    # Power profiles.
    n += save(dest, "power-profiles", get_all("system", "org.freedesktop.UPower.PowerProfiles",
              "/org/freedesktop/UPower/PowerProfiles", "org.freedesktop.UPower.PowerProfiles"))
    # NetworkManager: root, devices, active connections, access points.
    nm = get_all("system", "org.freedesktop.NetworkManager", "/org/freedesktop/NetworkManager",
                 "org.freedesktop.NetworkManager")
    n += save(dest, "nm", nm)
    props = (nm or {}).get("data", [{}])[0]
    for path in props.get("Devices", {}).get("data", []):
        tag = "nm-device-" + path.rsplit("/", 1)[-1]
        n += save(dest, tag, get_all("system", "org.freedesktop.NetworkManager", path,
                  "org.freedesktop.NetworkManager.Device"))
        wifi = get_all("system", "org.freedesktop.NetworkManager", path,
                       "org.freedesktop.NetworkManager.Device.Wireless")
        if wifi:
            n += save(dest, tag + "-wireless", wifi)
            ap = wifi.get("data", [{}])[0].get("ActiveAccessPoint", {}).get("data")
            if ap and ap != "/":
                n += save(dest, "nm-ap-" + ap.rsplit("/", 1)[-1],
                          get_all("system", "org.freedesktop.NetworkManager", ap,
                                  "org.freedesktop.NetworkManager.AccessPoint"))
    for path in props.get("ActiveConnections", {}).get("data", []):
        n += save(dest, "nm-active-" + path.rsplit("/", 1)[-1],
                  get_all("system", "org.freedesktop.NetworkManager", path,
                          "org.freedesktop.NetworkManager.Connection.Active"))
    # UDisks2: every object (drives, block devices, NVMe controllers).
    n += save(dest, "udisks2-objects", drop_loops(busctl(
        "system", "call", "org.freedesktop.UDisks2", "/org/freedesktop/UDisks2",
        "org.freedesktop.DBus.ObjectManager", "GetManagedObjects")))
    return n


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    name = sys.argv[1] if len(sys.argv) > 1 else "hp-i5-10300h"
    dest = root / "fixtures" / name
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    files = copy_files(dest)
    replies = capture_dbus(dest)
    print(f"fixtures/{name}: {files} files, {replies} D-Bus replies")
    return 0


if __name__ == "__main__":
    sys.exit(main())
