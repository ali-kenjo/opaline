# Opaline

Glass widgets for your Ubuntu desktop.

Opaline puts Android-style home-screen widgets on the Ubuntu desktop: add, move, resize, stack and remove them right
on the wallpaper. They look like glass, move with springs, follow your GNOME theme, and cost almost nothing to run.

> **Status: early development (Phase 0 of 8).** Nothing to install yet. See [`docs/PLAN.md`](docs/PLAN.md) and
> [`docs/PROGRESS.md`](docs/PROGRESS.md).

- **Platform:** Ubuntu 26.04 LTS (GNOME 50, Wayland). Any x86_64 hardware.
- **Privacy:** no telemetry. Network access only for weather, update checks, album art and an opt-in public-IP lookup.
- **License:** GPL-3.0-or-later.

## Building

Requirements: Rust (stable), Node 24 with pnpm (`corepack enable`), and
`libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libpipewire-0.3-dev`.

```bash
pnpm install
cd app && pnpm tauri build --bundles deb
```
