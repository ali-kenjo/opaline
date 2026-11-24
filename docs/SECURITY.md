# Opaline 1.0 Security Review (Phase 7.4)

Date: 2026-11-24

This audit verifies every security and privacy control specified in `OPALINE_BUILD_PROMPT.md` §5.8 and `docs/ARCHITECTURE.md` §7.

## 1. Tauri capabilities & least privilege
- **Layer windows (`app/src-tauri/capabilities/layer.json`):** Scoped strictly to `["layer-*"]`. Grants only the 9 explicit layer IPC commands (`layer_attach`, `layer_subscribe`, `layer_command`, `layer_set_raised`, `layer_set_peek`, `layer_set_edit`, `layer_asset`, `layer_set_input_region`, `layer_report`). Zero filesystem, shell, HTTP, or general Tauri plugin permissions.
- **Core shell windows (`app/src-tauri/capabilities/shell.json`):** Scoped strictly to `["settings", "onboarding"]`. Grants only the explicit `shell_*` commands declared in `app/src-tauri/build.rs`.
- **Custom asset loader (`app/src-tauri/src/layer/assets.rs`):** `safe_name()` allows only `[A-Za-z0-9._-]+` ending in `.png`/`.jpg`/`.jpeg`/`.webp` inside Opaline's `wallpaper/` or `art/` cache subdirectories (rejects `..`, `/`, leading `.`, and unknown kinds; unit tested).

## 2. Content Security Policy (CSP)
Configured in `app/src-tauri/tauri.conf.json`:
- `default-src 'self'`, `script-src 'self'`, `font-src 'self'`
- `img-src 'self' data: blob:` (webviews never load remote URLs; core fetches & caches album art and wallpaper textures)
- `connect-src ipc: http://ipc.localhost` (zero outbound webview network access)
- `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`
- `freezePrototype: true`, `withGlobalTauri: false`

## 3. Local IPC (`crates/opaline-ipc` & `crates/opaline-core/src/ipc_server.rs`)
- Runtime directory `$XDG_RUNTIME_DIR/opaline/` created with mode `0700`; `ipc.sock` set to mode `0600` (unit tested).
- Every incoming connection is checked with `SO_PEERCRED` (`peer_cred().uid() == own_uid`); other UIDs are rejected before reading a frame.
- Frame codec enforces a hard maximum payload cap without pre-allocating untrusted lengths (fuzz/oversize/EOF unit tested).

## 4. Command validation (`crates/opaline-core/src/commands.rs`)
- **Process signals (`EndTask`):** Validates both UID ownership and `/proc/<pid>/stat` start time to defeat PID reuse; refuses foreign or changed processes (unit tested).
- **Drive actions (`DriveEject`, `DrivePowerOff`), Docker actions (`Container`), MPRIS (`Media`), Power profiles (`SetPowerProfile`):** Validated against core's own live device/container/player/profile listings.
- **Settings & Layouts (`UpdateSettings`, `UpdateLayouts`, `backup::import_json`):** Schema-validated (value ranges, IP address format, `https://` / `webcal://` calendar schemes, non-overlapping grid bounds, version protection) before atomic write (`tmp` → `fsync` → `rename` → dir `fsync`).

## 5. Privileged helper (`crates/opaline-privileged`)
- System D-Bus service `io.github.ali_kenjo.Opaline.Privileged1`, read-only, D-Bus activated, exits after 60 s idle.
- Strict RAPL sysfs allow-list only (`intel-rapl:*`, no arbitrary paths — unit tested).
- Polkit action `io.github.ali_kenjo.opaline.read-sensors` (`packaging/polkit/`): restricted to active local sessions only.
- Per-caller rate limiting enforced in process (unit tested); only contacted when `settings.privacy.privilegedSensors` is explicitly enabled by the user.

## 6. Network hygiene & verified updates (`crates/opaline-core/src/http.rs`, `updates.rs`)
- Single shared HTTP client (`rustls` + system CA store, generic `Opaline/<version>` user agent, 10 s timeout).
- `fetch_limited()` refuses non-HTTPS URLs (`http://`, `file://`), enforces MIME prefixes, and caps download sizes (unit tested).
- Outbound network requests occur only for opt-in/explicit features: Open-Meteo weather, opt-in public IP (off by default), streamed album art, and opt-out daily GitHub Releases check. Zero telemetry.
- Updates verify the minisign Ed25519 + BLAKE2b-512 signature on `SHA256SUMS` *before* downloading the `.deb`, then verify the `.deb` SHA-256 digest before invoking `pkexec apt install` (unit tested, including RFC 7693 vector and tamper rejection).
- `opaline --diagnose` and Settings → Diagnostics strip topic values (no SSIDs, IPs, hostnames, usernames, or monitor serial numbers).
