# Sensors and platform inventory: reference machine

Inspected on 2026-11-22 on the reference laptop (§1.4 of the brief), as a normal user without sudo.
Serial numbers, MAC addresses, SSIDs and user paths are redacted. Everything below was read on
this machine; nothing is taken from the brief without checking.

Legend: ✅ works unprivileged · 🔒 needs root · ⚠️ differs from the brief · ❌ not present

## 1. System

| Item | Found | Notes |
| - | - | - |
| OS | Ubuntu 26.04.1 LTS (Resolute Raccoon) | |
| Kernel | 7.0.0-44-generic | |
| GNOME Shell | 50.1 | Mutter typelib is `Meta-18` (`/usr/lib/x86_64-linux-gnu/mutter-18/`) |
| Session | Wayland, `XDG_CURRENT_DESKTOP=ubuntu:GNOME` | |
| Mutter experimental features | `scale-monitor-framebuffer`, `xwayland-native-scaling` | Fractional scaling on; Xwayland clients get native-resolution scaling (affects Instant mode, see §9) |
| Workspaces | static, 1 workspace (`dynamic-workspaces=false`, `num-workspaces=1`) | Still test with several workspaces |
| GJS | 1.88.0 | |
| `gnome-shell --devkit` | flag exists ("Run development kit") | Launching a nested devkit session is still to be tried in P4 |

## 2. CPU

| Source | Status | Value / detail |
| - | - | - |
| Model | ✅ | Intel Core i5-10300H, 4 cores / 8 threads |
| `/proc/stat` | ✅ | per-CPU lines `cpu0`–`cpu7` |
| cpufreq | ✅ | `policy0`–`policy7`, driver `intel_pstate`, governor `powersave`, EPP `performance`, range 800 MHz–4.5 GHz, `scaling_cur_freq` readable |
| hwmon `coretemp` | ✅ | `hwmon5`: `temp1` = "Package id 0", `temp2..5` = "Core 0".."Core 3" (one sensor per physical core, not per thread) |
| Thermal zones | ✅ | `x86_pkg_temp`, `acpitz` ×2, `SEN2`–`SEN4`, `INT3400 Thermal`, `pch_cometlake`, `B0D4` (fallback only; `SEN4` reads 0.05 °C, which is not a real value, so filter implausible zones) |
| Throttling | ✅ | `/sys/devices/system/cpu/cpu*/thermal_throttle/{core,package}_throttle_count` plus `*_max_time_ms` and `*_total_time_ms` (currently 0) |
| RAPL | 🔒 | `intel-rapl:0` (package-0) with sub-zones `core`, `uncore`, `dram`; `intel-rapl:1` (psys); also `intel-rapl-mmio:0`. `energy_uj` is mode `0400 root` → **Permission denied**; `max_energy_range_uj` and `name` are world-readable |
| `/proc/loadavg`, `/proc/uptime`, `/proc/cpuinfo` | ✅ | |
| PSI | ✅ | `/proc/pressure/{cpu,memory,io}` all present |

## 3. Memory

| Source | Status | Notes |
| - | - | - |
| `/proc/meminfo` | ✅ | MemTotal ≈ 14.9 GiB usable (16 GB installed), `Zswap`/`Zswapped` lines present but zswap is disabled (`/sys/module/zswap/parameters/enabled = N`) |
| Swap | ✅ | 4 GiB |
| `/proc/pressure/memory` | ✅ | `some` and `full` lines |
| `smaps_rollup` | ✅ | readable for the user's own processes (`Rss`, `Pss`) |

## 4. GPUs

| | iGPU | dGPU |
| - | - | - |
| DRM card | `card1` | `card2` |
| PCI | `0000:00:02.0`, `8086:9bc4` (UHD 630, CometLake-H GT2) | `0000:01:00.0`, `10de:2191` (GTX 1660 Ti Max-Q, TU116M) |
| Driver | `i915` | `nvidia` 595.99.02, **open kernel module** |
| `boot_vga` | 1 | 0 |
| Connectors | `eDP-1` connected, `DP-1`, `HDMI-A-1` disconnected | **`HDMI-A-2` connected** (the external monitor is wired to the NVIDIA GPU) |
| `power/control` | auto | auto |
| `power/runtime_status` | active | **active** (audio function `01:00.1` is `suspended`) |
| `runtime_suspended_time` | | **0**: the dGPU has never runtime-suspended since boot |
| PRIME profile | `prime-select query` → `on-demand` | |

**NVIDIA details**
- NVML: ✅ `libnvidia-ml.so.1` present in `/usr/lib/x86_64-linux-gnu/`. `nvidia-smi` reads P8, 3 % load, 43 °C, 4.9 W, 33 MiB / 6144 MiB VRAM.
- `/proc/driver/nvidia/gpus/0000:01:00.0/power`: **`Runtime D3 status: Not supported`**, "Video Memory Off: Supported".
- `gnome-shell` and `xdg-desktop-portal-gnome` hold `/dev/nvidia0`, `/dev/nvidiactl` and `/dev/nvidia-modeset` open, because the shell drives the HDMI monitor through the NVIDIA GPU.

> ⚠️ **The dGPU acceptance check in §6 ("the NVIDIA GPU reaches `suspended` within 60 s") cannot pass on
> this laptop as it is set up today.** RTD3 is reported as not supported, and an external monitor is attached
> to the NVIDIA HDMI port, so the compositor keeps the GPU awake anyway. The runtime-PM rule is still
> implemented exactly as written, and it is still important on other hybrid laptops. A replacement
> acceptance check is proposed in `docs/adr/0003-dgpu-sleep-acceptance.md`.

**Intel details**
- ✅ `card1/gt_act_freq_mhz` (350), `gt_cur_freq_mhz`, `gt_max_freq_mhz` (1050), `gt_min_freq_mhz`, RP0/RP1/RPn.
- ✅ `card1/gt/gt0/rc6_residency_ms` readable → utilization ≈ 1 − ΔRC6/Δt, labeled "approx.".
- ✅ DRM fdinfo readable for the user's own processes: `drm-driver: i915`, `drm-pdev`, `drm-client-id`, `drm-engine-{render,copy,video,…}` in ns. Processes of other users are not readable, and that's fine.
- The NVIDIA proprietary/open driver does not expose `drm-engine-*` in fdinfo here; per-process NVIDIA usage comes from NVML.

## 5. Displays

`org.gnome.Mutter.DisplayConfig.GetCurrentState` ✅ works as a normal session client (no special permission).

| Connector (Mutter) | DRM name | Vendor | Product | Serial | Mode | Logical position | Scale | Primary | Built-in |
| - | - | - | - | - | - | - | - | - | - |
| `eDP-1` | `card1-eDP-1` | AUO | `0x82ed` | `0x00000000` | 1920×1080 @ 60.08 | (0, 0), 1536×864 logical | **1.25** | yes | yes |
| `HDMI-2` | `card2-HDMI-A-2` | MSI | MAG 272F | `0x00000000` | 1920×1080 @ 60 (supports up to 200 Hz) | (1536, 0) | 1.0 | no | no |

- `layout-mode = 1` (logical), so positions are in logical pixels.
- ⚠️ **Both monitors report serial `0x00000000`.** The layout key "connector + vendor/product/serial" (§2.4) still works, but the serial adds nothing here. Two identical monitors without serials can only be told apart by connector; the key format handles that (see ARCHITECTURE §5).
- ⚠️ Mutter connector names (`HDMI-2`) differ from DRM sysfs names (`card2-HDMI-A-2`). Monitor identity always comes from Mutter; sysfs connector names are only used to find which GPU drives which display.
- **Mixed scale (1.25 + 1.0) across two monitors.** This is the real test case for per-monitor layer windows.

## 6. Storage

| Drive | Bus | Size | Partitions | Mounted |
| - | - | - | - | - |
| Samsung MZVLQ512HALU (PM991a, DRAM-less) `nvme0n1` | NVMe | 476.9 GiB | `p1` vfat 1 GiB → `/boot/efi`, `p2` ext4 → `/` | yes |
| ⚠️ Samsung SSD 870 QVO 1 TB `sda` | SATA (internal, not removable) | 931.5 GiB | `sda1` NTFS | **no** |

The brief lists only the NVMe drive. The second, internal SATA SSD is a useful test case: an unmounted drive (health shown, space "Not mounted") and a SATA SMART path.

- `/proc/self/mountinfo`: **58 snap loop devices** with squashfs, plus tmpfs, nsfs, sysfs, tracefs etc. Only `nvme0n1p1` (vfat) and `nvme0n1p2` (ext4) are real. The exclusion rule in §6 is needed and confirmed.
- `/proc/diskstats` ✅ has `nvme0n1` and `sda`.
- hwmon `nvme` ✅ (`hwmon3`): `temp1` = "Composite", `temp2` = "Sensor 1".
- **UDisks2 NVMe SMART ✅ works without root.** `org.freedesktop.UDisks2.NVMe.Controller`:
  - properties `SmartTemperature` (in kelvin, see the note below), `SmartCriticalWarning` (`as`, empty), `SmartPowerOnHours` (8005), `SmartUpdated`, `SmartSelftestStatus`;
  - method `SmartGetAttributes(a{sv})` returned without a polkit prompt: `avail_spare` 100, `spare_thresh` 5, `percent_used` 16, `total_data_read/written`, `ctrl_busy_time`, `power_cycles`, `unsafe_shutdowns`, `media_errors` 0, `num_err_log_entries`, `temp_sensors`, `wctemp` 352 K, `cctemp` 355 K, `warning_temp_time`, `critical_temp_time`.
  - ⚠️ **This drive reports an implausibly low temperature.** hwmon `temp1`/`temp2` read 7.85 °C and UDisks2 `SmartTemperature` reads 280 K (6.85 °C) on a running laptop, while the limits look normal (`temp1_max` 78.85 °C, `temp1_crit` 81.85 °C, `wctemp` 352 K, `cctemp` 355 K). Both sources agree, so it is the drive's firmware, not our parsing. Following "honest data", we show the reported value and add a small "Reported by drive, may be inaccurate" hint when an NVMe reads below 15 °C while the CPU package is above 35 °C. This is a good fixture case.
  - UDisks2 caches SMART data (`SmartUpdated`), so **live temperature comes from hwmon and health from UDisks2**.
- **UDisks2 ATA SMART ✅** for `sda`: `SmartSupported`, `SmartEnabled`, `SmartTemperature` (294 K), `SmartFailing` false, `SmartPowerOnSeconds`.
- `Drive` properties `ConnectionBus`, `Removable`, `Ejectable`, `CanPowerOff` available for eject decisions.

> ⚠️ Because UDisks2 SMART works unprivileged, the privileged helper's `GetNvmeSmart` method is not needed on this
> machine. See `docs/adr/0004-privileged-helper-scope.md`.

## 7. Network

| Interface | Kind | State |
| - | - | - |
| `wlo1` | Wi-Fi (Realtek RTL8822CE), physical | connected, `<ssid>` |
| `eno1` | Ethernet (Realtek RTL8111), physical | no carrier; `speed` reads `-1` when down (handle it) |
| `lo` | loopback | excluded |

- No `docker0`/`veth*`/`br-*` right now (Docker Desktop runs its engine in a VM, so those interfaces won't appear on the host even when it runs). Virtual-interface classification needs synthetic fixtures.
- Physical vs. virtual: `/sys/class/net/<if>/device` exists only for physical ones ✅; `wireless/` dir marks Wi-Fi ✅.
- NetworkManager ✅ on the system bus; connectivity `full`. Wi-Fi signal, frequency and bitrate available via `nmcli`/D-Bus.
- Unprivileged ICMP ✅: `net.ipv4.ping_group_range = 0 2147483647`, so ICMP datagram sockets work for any user.
- Bluetooth adapter present, disconnected at inspection time. A Bluetooth audio sink was paired earlier (PipeWire lists `bluez_output.*`).

## 8. Power

- **UPower ✅**: `battery_BAT1` (HP, Li-ion), `line_power_ACAD`, `DisplayDevice`. At inspection: fully charged, 100 %, energy-full 39.38 Wh vs design 52.5 Wh → **capacity 75 %**, energy-rate 0 W, `charge-cycles: N/A` (show "Not reported").
- hwmon also exposes `BAT1` (`in0`, `power1`) and `ACAD`; UPower is the source of truth.
- **Power profiles ✅**: both `org.freedesktop.UPower.PowerProfiles` and the legacy `net.hadess.PowerProfiles` names are on the bus. Current profile `performance`; profiles `performance`, `balanced`, `power-saver` (CpuDriver `intel_pstate`, PlatformDriver `placeholder`). Use the `org.freedesktop.UPower.PowerProfiles` name and fall back to `net.hadess`.
- No peripheral batteries right now (no Bluetooth device connected). Needs fixtures.

## 9. Fans

- hwmon `hp` (`hwmon6`, `hp-wmi` platform driver) ✅: `fan1_input`, `fan2_input`, **no labels**. Name them "Fan 1"/"Fan 2"; on HP laptops these are typically CPU and GPU fans, but we don't guess.

## 10. Audio and media

- **PipeWire 1.6.2** (compiled and linked). WirePlumber `wpctl` works; `pactl` is not installed (we don't need it).
- Sinks: "Internes Audio Analoges Stereo" (default) and the NVIDIA HDMI audio sink. The default sink's monitor port is the capture target.
- ⚠️ The NVIDIA HDMI audio sink belongs to the dGPU's audio function `01:00.1`. Opening its monitor would wake that function; we only ever capture the **default** sink, so this matters only if the user makes HDMI audio the default.
- Microphone privacy indicator while capturing a sink monitor: **not yet tested** (needs a running capture; done in P1).
- **MPRIS ✅**: `org.mpris.MediaPlayer2.chromium.instance<pid>` was playing, with `CanControl`, `CanSeek`, `mpris:artUrl`, `mpris:length`, `xesam:title`.

## 11. Desktop, shell and portals

| Item | Found |
| - | - |
| Enabled extensions | `ding@rastersoft.com` (DING, **ACTIVE**), `ubuntu-dock`, `ubuntu-appindicators`, `tiling-assistant`, `gsconnect`, `drive-menu`, `snapd-prompting`, `snapd-search-provider`, `web-search-provider` |
| DING | Running as `gjs …/ding@rastersoft.com/app/ding.js`; `shell-version` 46–50. Uses `Meta.WaylandClient.new_subprocess(global.context, launcher, argv)`, `owns_window()`, `hide_from_window_list()`, `window.stick()`, and **`window.lower()` repeatedly** to stay at the bottom (`emulateX11WindowType.js`). License: GPL-3.0 (compatible with ours, but we write our own code) |
| `org.gnome.Shell.Extensions` | ✅ `EnableExtension`, `DisableExtension`, `ShellVersion = '50.1'`, `UserExtensionsEnabled = true` |
| Meta-18 API (typelib strings) | ✅ `WaylandClient.new_subprocess`, `owns_window`, `hide_from_window_list`, `stick`, `make_above`/`unmake_above`, `lower`, `minimize`/`unminimize`, `is_skip_taskbar`, `get_work_area_for_monitor`, `restacked` signal, `add_keybinding`. ⚠️ **No `make_below`**: stay-below is done by lowering on `restacked`, like DING |
| AppIndicator / tray | ✅ `org.kde.StatusNotifierWatcher` on the session bus (ubuntu-appindicators); `libayatana-appindicator3` 0.5.94 installed |
| Notifications | ✅ `org.freedesktop.Notifications` |
| ScreenSaver | ✅ `org.gnome.ScreenSaver.GetActive` → false |
| Portals | ✅ `GlobalShortcuts` v1, `Settings` v2, `Location` v1, `Background` v2, `Notification` v1 |
| Settings portal | ✅ `org.freedesktop.appearance color-scheme` = 1 (dark), `accent-color` = (0.93, 0.36, 0.0) |
| GeoClue2 | ✅ on the system bus; `/etc/geoclue/geoclue.conf` has an allow-list of apps; an unlisted app must go through the Location portal → use the portal |
| Evolution Data Server | ✅ `Sources5`, `Calendar8` on the session bus; configured sources: `system-calendar`, `birthdays` (no online accounts right now) |
| `org.gnome.Shell.CalendarServer` | present (the shell's own EDS proxy; considered in the calendar ADR) |

**Appearance settings (GSettings)**
- `org.gnome.desktop.background`: `picture-uri` = `picture-uri-dark` = a PNG in `~/.local/share/backgrounds/`, `picture-options = 'zoom'`, `primary-color`/`secondary-color` `#000000`, `color-shading-type = 'solid'`.
- `org.gnome.desktop.interface`: `color-scheme = 'prefer-dark'`, `accent-color = 'orange'`, `enable-animations = true`, `text-scaling-factor = 1.0`, `clock-format = '24h'`.
- `org.gnome.desktop.a11y.interface high-contrast = false`.

## 12. Docker / Podman

| Item | Found |
| - | - |
| Docker CLI | 29.10.0 |
| Docker Desktop | installed; user unit `docker-desktop.service` **disabled and inactive** |
| Contexts | `default` (current, `unix:///var/run/docker.sock`) and `desktop-linux` (`unix:///home/<user>/.docker/desktop/docker.sock`) |
| Sockets | `/var/run/docker.sock` ❌, Docker Desktop socket ❌ (not running), Podman ❌ (not installed) |
| `DOCKER_HOST` | unset |
| User in `docker` group | no |

⚠️ The brief says Docker Desktop "runs n8n". That is out of date: the n8n container and its data were deleted in October and Docker Desktop starts empty. The **current context is `default`, not `desktop-linux`**, so the endpoint order in §6 would try `/var/run/docker.sock` first and fail. The resolver therefore also probes the `desktop-linux` context socket when the current context's socket is missing, and reports "Docker Desktop is stopped" (with a Start action via `systemctl --user start docker-desktop`) when that unit exists but is inactive. Recorded in `docs/adr/0005-docker-endpoint-resolution.md`.

## 13. Processes and app grouping

- `/proc/[pid]/{stat,statm,status,cmdline,cgroup}` ✅.
- cgroup v2 unified: apps live in `…/app.slice/app-<app-id>-<pid>.scope` (e.g. `app-com.anthropic.Claude-<pid>.scope`); the shell lives in `session.slice/org.gnome.Shell@ubuntu.service`. Snaps use `snap.<name>.<app>-<uuid>.scope`. Grouping works with these patterns.

## 14. Build toolchain (for P0)

| Tool | Found | Needed |
| - | - | - |
| rustc / cargo | 1.98.0 | ✅ edition 2024 OK |
| rustup | 1.29.0 | ✅ |
| Node | 24.19.0 | ✅ |
| npm | 11.17.0 | ✅ |
| pnpm | ❌ | install via `corepack enable` (no sudo) |
| Tauri CLI | ❌ | `cargo install tauri-cli --version "^2"` or `pnpm add -D @tauri-apps/cli@^2` (no sudo) |
| `libwebkit2gtk-4.1-dev` | 2.52.6 | ✅ |
| `libgtk-3-dev` | 3.24.52 | ✅ |
| `libayatana-appindicator3-dev` | 0.5.94 | ✅ |
| `librsvg2-dev`, `build-essential`, libclang 21 | ✅ | |
| `libpipewire-0.3-dev` | ❌ | **sudo apt install** (needed by the `pipewire` crate) |
| `libsqlite3-dev` | ❌ | not needed if `rusqlite` uses its `bundled` feature (planned) |
| `libssl-dev` | unknown | not needed: use `rustls` everywhere |
| Podman | ❌ | optional, only to test the Podman path |

Latest versions checked on crates.io/npm today: Tauri **2.x stable** (CLI 2.12.6; crates.io's newest is `3.0.0-alpha`, which we will not use, see ADR 0002), zbus 6.5, nvml-wrapper 0.13, pipewire 0.10, rustfft 6.4, bollard 0.21, rusqlite 0.43, rmp-serde 1.3, ashpd 0.14, gio 0.22, image 0.25, jxl-oxide 0.12, libblur 0.24, fast_image_resize 6.2, tokio 1.54; React 19.3, Vite 8.3, Zustand 5.1, motion 14.14, uPlot 1.6, `@material/material-color-utilities` 0.4.

## 15. Still to verify (scheduled in PLAN.md)

- WebGL2 inside a Tauri/WebKitGTK 2.52 webview on this machine (P2 acceptance).
- Microphone privacy indicator during sink-monitor capture (P1).
- `gnome-shell --devkit` nested session actually starts and loads a test helper (P4).
- Instant mode under Xwayland with `xwayland-native-scaling` at 1.0 / 1.25 / 1.5 / 2.0 (P4).
- Spring token values against androidx `MotionScheme` source (P2).
- EDS read access path (ADR in P1).
