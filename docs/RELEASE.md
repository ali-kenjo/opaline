# Opaline Release Guide (Phase 8)

## 1. Building the `.deb` locally

```bash
./scripts/stage-deb-assets.sh
cd app && pnpm tauri build --bundles deb
dpkg-deb -c ../target/release/bundle/deb/Opaline_*_amd64.deb
dpkg-deb -I ../target/release/bundle/deb/Opaline_*_amd64.deb
```

Verify that the `.deb` includes:
- `/usr/bin/opaline`
- `/usr/libexec/opaline/opaline-privileged`
- `/usr/share/applications/io.github.ali_kenjo.Opaline.desktop`
- `/usr/share/metainfo/io.github.ali_kenjo.Opaline.metainfo.xml`
- `/usr/share/icons/hicolor/scalable/apps/io.github.ali_kenjo.Opaline.svg`
- `/usr/share/dbus-1/system-services/io.github.ali_kenjo.Opaline.Privileged.service`
- `/usr/share/dbus-1/system.d/io.github.ali_kenjo.Opaline.Privileged.conf`
- `/usr/share/polkit-1/actions/io.github.ali_kenjo.opaline.policy`
- `/usr/share/gnome-shell/extensions/opaline-desktop@ali-kenjo.github.io/` (including `schemas/gschemas.compiled`)

## 2. Setting up the minisign release signing key (one-time, owner)

1. Install `minisign` (`sudo apt install minisign`) and generate your release key pair offline (keep `opaline-release.key` private and backed up securely):
   ```bash
   minisign -G -p opaline-release.pub -s opaline-release.key
   ```
2. Copy the single base64 public key line (starting with `RW...`) from `opaline-release.pub` into `RELEASE_MINISIGN_PUBKEY` in `crates/opaline-core/src/updates.rs`.
3. Add two GitHub Actions repository secrets on `ali-kenjo/opaline`:
   - `MINISIGN_SECRET_KEY`: full contents of `opaline-release.key`
   - `MINISIGN_PASSWORD`: passphrase used to encrypt `opaline-release.key`

## 3. Clean Ubuntu 26.04 VM verification checklist

On a fresh Ubuntu 26.04 LTS desktop VM:
1. **Install:** `sudo apt install ./Opaline_1.0.0_amd64.deb`
2. **Instant mode first run:** Launch Opaline from the app grid → complete Onboarding → confirm widgets appear above desktop icons, below windows, click-through works, Peek (`Super+Alt+W`) and Edit (`Super+Alt+E`) work.
3. **Native mode switch:** Log out and back in → confirm Opaline switches automatically to **Native** in **Settings → Desktop integration** and `opaline --diagnose` reports `helper_running: true`.
4. **Upgrade:** Install a newer `.deb` over an older one (`sudo apt install ./Opaline_1.0.1_amd64.deb`) → verify settings and layouts stay intact.
5. **Clean uninstall:** `sudo apt remove opaline` (and `sudo apt purge opaline`) → verify no stray system files or broken GNOME Shell state remain.

## 4. Tagging `v1.0.0`

1. Bump `version` to `"1.0.0"` in `Cargo.toml`, `app/package.json`, `app/src-tauri/tauri.conf.json`, and `packaging/metainfo/io.github.ali_kenjo.Opaline.metainfo.xml`.
2. Commit `release: v1.0.0`, push `main`, and verify CI is green.
3. Tag and push:
   ```bash
   git tag -a v1.0.0 -m "Opaline 1.0.0"
   git push origin v1.0.0
   ```
   `.github/workflows/release.yml` will build the `.deb`, generate `SHA256SUMS` + `SHA256SUMS.minisig`, and publish the GitHub Release.
