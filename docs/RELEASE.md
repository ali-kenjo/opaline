# Opaline 2.0 Release Guide (Phase 10)

## 1. Building the `.deb` locally

```bash
./scripts/stage-deb-assets.sh
cd app && pnpm tauri build --bundles deb
dpkg-deb -c ../target/release/bundle/deb/Opaline_*_amd64.deb
dpkg-deb -I ../target/release/bundle/deb/Opaline_*_amd64.deb
```

Verify that the `.deb` includes:
- `/usr/bin/opaline` (core, layer, `ctl`, `validate`, `pack`, `--diagnose`, `--dump`, `--safe-mode`)
- `/usr/libexec/opaline/opaline-privileged`
- `/usr/share/applications/io.github.ali_kenjo.Opaline.desktop`
- `/usr/share/metainfo/io.github.ali_kenjo.Opaline.metainfo.xml`
- `/usr/share/icons/hicolor/scalable/apps/io.github.ali_kenjo.Opaline.svg`
- `/usr/share/dbus-1/system-services/io.github.ali_kenjo.Opaline.Privileged.service`
- `/usr/share/dbus-1/system.d/io.github.ali_kenjo.Opaline.Privileged.conf`
- `/usr/share/polkit-1/actions/io.github.ali_kenjo.opaline.policy`
- `/usr/share/gnome-shell/extensions/opaline-desktop@ali-kenjo.github.io/` (API v2 + compiled `schemas/gschemas.compiled`)
- `/usr/share/opaline/schemas/*.schema.json` & `/usr/share/opaline/themes/{opaline,classic}/theme.json`
- `/usr/share/bash-completion/completions/opaline`
- `/usr/share/zsh/vendor-completions/_opaline`
- `/usr/share/fish/vendor_completions.d/opaline.fish`

## 2. Setting up minisign keys (one-time, owner)

1. **Release signing key:**
   ```bash
   minisign -G -p opaline-release.pub -s opaline-release.key
   ```
   Copy the `RW...` public key line into `RELEASE_MINISIGN_PUBKEY` (`crates/opaline-core/src/updates.rs`) and configure GitHub Actions secrets `MINISIGN_SECRET_KEY` and `MINISIGN_PASSWORD`.
2. **Community gallery signing key (`ali-kenjo/opaline-gallery`):**
   ```bash
   minisign -G -p opaline-gallery.pub -s opaline-gallery.key
   ```
   Copy its `RW...` public key line into `GALLERY_MINISIGN_PUBKEY` (`crates/opaline-core/src/gallery.rs`).

## 3. Clean Ubuntu 26.04 VM & 1.1 → 2.0 migration checklist

On a fresh Ubuntu 26.04 LTS desktop VM (and on the owner's laptop with a backup of `~/.config/opaline`):
1. **Fresh install:** `sudo apt install ./Opaline_2.0.0_amd64.deb` → 7-step Onboarding over real wallpaper → Instant mode → re-login switches to Native Wayland (`Shell1` API v2).
2. **1.1 → 2.0 upgrade:** Install 2.0 over 1.1 → verify existing `settings.json` migrates cleanly to `version: 2`, `theme: "classic"`, blur migrated to 2.0 scale, and layouts preserved (covered by `crates/opaline-core/tests/migrations.rs`).
3. **Interactive features:** Edit mode + Inspector + Free mode + Widget Builder + Quick Controls + Profiles/Automation + `opaline ctl status --json` + Arabic RTL mode (grid never mirrors).
4. **Clean uninstall:** `sudo apt purge opaline` → confirm clean removal.

## 4. Tagging `v2.0.0`

1. Bump `version` to `"2.0.0"` in `Cargo.toml`, `app/package.json`, `app/src-tauri/tauri.conf.json`, and `packaging/metainfo/io.github.ali_kenjo.Opaline.metainfo.xml`.
2. Commit `release: v2.0.0`, push `main`, verify CI is green, then tag and push:
   ```bash
   git tag -a v2.0.0 -m "Opaline 2.0.0"
   git push origin v2.0.0
   ```
