# Handoff: where Opaline 2.0 stands (2026-11-27)

For whoever continues this work (person or AI tool). Read this first, then `CLAUDE.md`, `OPALINE_2_BRIEF.md` (the
2.0 brief), `docs/PLAN-2.md`, `docs/DESIGN-2.md`, `docs/PROGRESS.md`, `docs/SECURITY.md`, `docs/DBUS.md`,
`docs/SDK.md`, `docs/RELEASE.md`, and the ADRs in `docs/adr/` (`0001`–`0019`).

---

## 1. The project in one paragraph
Opaline is a desktop-widgets app for Ubuntu 26.04 LTS / GNOME 50: glass widgets on the wallpaper, above the desktop
icons (DING) and below application windows. Rust core (sensor engine, settings, layouts, custom sources, profiles,
automation, plugins, IPC, D-Bus v2) + Tauri 2 layer process (one transparent WebKitGTK window per monitor, React 19
frontend) + a small GNOME Shell helper (`opaline-desktop@ali-kenjo.github.io`, Shell1 API v2) for "Native mode".
`v1.0.0` and `v1.1.0` are released. **All 11 phases (P0–P10) of Opaline 2.0 are implemented and verified.**

---

## 2. Exact Git & Phase Status

- **Repository:** `/home/allousch/Dokumente/vs-code-projects/widgets-app`, branch `main`
- **`origin/main` = local `main`:** all phases **P0–P10** signed off (2026-11-27) and pushed.
- **Untracked:** `.claude/` — **NEVER stage or commit `.claude/`**.

### Phase-by-phase summary

| Phase | Scope | Status |
| - | - | - |
| **P0** | Stabilize (RAM budget 450 MB PSS, Playwright harness, `LayerApp` split) | ✅ Signed off & pushed |
| **P1** | Design language & Glass 2.0 (ADR 0012/0013, Looks, zero-truncation/contrast) | ✅ Signed off & pushed |
| **P2** | Composition engine & `opaline-expr` (Rust↔TS conformance + fuzz) | ✅ Signed off & pushed |
| **P3** | 14 redesigned widgets + 10 first-party themes (Classic matches 1.1 baselines) | ✅ Signed off & pushed |
| **P4** | Style model 2.0, theme/rice `.zip` packages, user CSS, live reload (S9), JSON Schemas | ✅ Signed off & pushed |
| **P5** | Code-split Inspector (`33 KB`), Edit upgrades, Free mode & z-order, Smart Stacks, Widget Gallery, Settings search, 7-step Onboarding | ✅ Signed off & pushed |
| **P6** | Custom sources (Command, File, SSRF-pinned HTTP/JSON + JSONPath, D-Bus, MQTT + TLS, Variables), GNOME Keyring (ADR 0019), Trust approvals, code-split Widget Builder (`22 KB`) | ✅ Signed off & pushed |
| **P7** | 16 new built-in widgets (30 total) + 6 core providers: Quick Controls (ADR 0016), Notes, To-do, Timers/Pomodoro, Countdown, World Clock, Photo Frame (≤ 640 px thumbnails + EXIF), Sun & Moon, Quote, Aura, Decoration, GitHub, Home Assistant, MQTT, Feeds (HTML-stripped), n8n | ✅ Signed off & pushed |
| **P8** | Desktop Profiles, `opaline-expr` Automation rules (hysteresis, min-duration, manual override + Resume), Shell1 Helper API v2 (`ActiveWorkspaceChanged`, `FocusedAppChanged`, `FullscreenChanged`, `SetRaisedMonitor`, N−1 compat + Instant EWMH), `opaline ctl` CLI + bash/zsh/fish completions, D-Bus API v2 + `docs/DBUS.md`, Settings → Profiles & automation | ✅ Signed off & pushed |
| **P9** | Production `opaline-plugin://` ADR 0014 sandbox + main-frame nav guard, manifest/permission SHA-256 trust, frontend host + 2 s watchdog + hostile-plugin suite, Community Gallery SHA-256 + minisign verifier & Settings UI, `opaline pack` / `opaline validate`, `docs/SDK.md`, `examples/template-plugin/` | ✅ Signed off & pushed |
| **P10** | Full en/de/ar 2.0 i18n parity + package translations + RTL Inspector/Builder (LTR grid invariant), `docs/SECURITY.md` 2.0 threat model + `crates/opaline-core/tests/security.rs`, `README.md` & `docs/RELEASE.md` 2.0 | ✅ Signed off & pushed |

---

## 3. Verified Suite Health (as of `224de09`)

All checks pass cleanly with zero warnings/errors:
- **Rust (`cargo test --workspace --offline`):** **261 passed**, 0 failed, 1 ignored (`nvml` live-GPU test):
  - `opaline` binary: 9 (`instant`, `assets`, `windows`, `plugin_scheme` CSP/unapproved/nav-guard)
  - `opaline-compose`: 8 (incl. schema currency)
  - `opaline-core` lib: 206 (all providers, sources, keyring, profiles, automation, plugins, gallery, desktop N/N−1, ctl)
  - `opaline-core` integration: `migrations` (2), `schemas` (8), `security` (6)
  - `opaline-expr`: 7 (2 unit + 1 conformance corpus + 4 fuzz)
  - `opaline-ipc`: 12
  - `opaline-privileged`: 3
- **Rust lints:** `cargo clippy --workspace --all-targets --offline -- -D warnings` ✅, `cargo fmt --all --check` ✅
- **GNOME Shell helper:** `glib-compile-schemas --strict --dry-run desktop-integration/schemas` ✅, `cd app && pnpm lint:helper` ✅
- **Frontend:** `pnpm typecheck` (`tsc -b --noEmit`) ✅, `pnpm lint` (`eslint` strictTypeChecked + React Compiler + `prettier --check`) ✅, `pnpm test` (**318 Vitest**, 1 skipped, incl. `hostile.test.ts` & `i18n.test.ts`) ✅, `pnpm build` ✅
- **E2E (`cd app && pnpm test:e2e`):** **90/90 Playwright WebKit** tests passing (including `p7-widgets`, `p8-automation`, `p9-plugins`, `p10-quality`, `builder`, `inspector`, `edit-free`, `shell` across all 16 Settings sections, and all classic 1.1 Lab screenshot baselines).

---

## 4. What to Do Next (In Exact Order)

1. ~~Owner sign-off on Phase 10 and push~~ — done 2026-11-27.
2. **Owner-gated release preparation (`docs/RELEASE.md`)** — ask the owner before doing any of these:
   - **Minisign keys (Open Item #1):** Help the owner mint the release signing key (`RELEASE_MINISIGN_PUBKEY` in `crates/opaline-core/src/updates.rs` + GitHub Actions secrets `MINISIGN_SECRET_KEY`, `MINISIGN_PASSWORD`) and the gallery key (`GALLERY_MINISIGN_PUBKEY` in `crates/opaline-core/src/gallery.rs`, plus creating `ali-kenjo/opaline-gallery`). Both verifiers fail closed until configured.
   - **Real-desktop live verification (optional, with owner OK only):**
     - Run a 2.0 debug/release build against a **copy** of config (`XDG_CONFIG_HOME=/tmp/opaline-2-test`), NEVER against `~/.config/opaline/` (1.1.0 is still installed and treats v2 settings as read-only).
     - Test Quick Controls (Wi-Fi/Bluetooth/volume/brightness), Notes/Photos folders, local Docker Desktop / n8n (`localhost:5678`), `opaline ctl status --json`, and record fresh RAM/CPU via `scripts/measure-budget.sh 60` (budget: ≤ 450 MB PSS, ≤ 0.5% idle CPU).
     - To test Shell1 API v2 (`ActiveWorkspaceChanged`, `FocusedAppChanged`, `FullscreenChanged`), copy `desktop-integration/` into `~/.local/share/gnome-shell/extensions/opaline-desktop@ali-kenjo.github.io/` and have the owner re-login once.
   - **Version bump, `.deb` build, VM test, and `v2.0.0` tag:**
     - Bump `1.1.0` → `2.0.0` in `Cargo.toml`, `app/package.json`, `app/src-tauri/tauri.conf.json`, and `packaging/metainfo/io.github.ali_kenjo.Opaline.metainfo.xml`.
     - Run `./scripts/stage-deb-assets.sh && cd app && pnpm tauri build --bundles deb` and verify `dpkg-deb -c` includes all schemas, themes, helper v2, and bash/zsh/fish completions.
     - Run the clean Ubuntu 26.04 VM & 1.1 → 2.0 upgrade checklist (`docs/RELEASE.md`), tag `v2.0.0`, and push tag so `.github/workflows/release.yml` publishes the signed GitHub Release.

---

## 5. Open / Deferred Items (Known & Documented)

1. **Minisign keys empty (`updates.rs`, `gallery.rs`):** Both fail closed by design until the owner mints keys.
2. **Memory levers documented but deferred (ADR 0009):** Recycle WebKit web process while hidden, size GTK windows to widget bounding box outside Edit/Peek, glibc tunables for core. Current budget is **450 MB PSS** (owner-approved in P0).
3. **GNOME 51 readiness:** `desktop-integration/metadata.json` currently declares `shell-version: ["50"]`.
4. **ADR 0015 focus hand-back:** Works in Native mode via `ReleaseFocus`; Instant mode (Xwayland) cannot refocus another app's window.
5. **Builder live folder hot-reload:** Declarative themes & custom widgets in `~/.config/opaline/` hot-reload via `watcher.rs` (with S9 `WriteLedger`); an explicit "Watch local plugin folder" button inside `WidgetBuilder.tsx` is optional polish if the owner wants it.

---

## 6. Key Architecture Map (Phases 5–10 Additions)

- **Core (`crates/opaline-core/src/`):**
  - `sources/{model,parsers,runners,mqtt,manager}.rs` — 6 custom source types + Trust approvals + custom widget packages
  - `secrets.rs` — GNOME Keyring (`org.freedesktop.secrets`) over `zbus 6`, `{{secret:name}}` templates & `redact_text`
  - `providers/{controls,notes,todos,timers,photos,integrations}.rs` — Phase 7 providers (Quick Settings, Markdown notes, todo.txt, core timers/Pomodoro, ≤ 640 px photo thumbnails + EXIF, sanitized RSS/Atom/JSON Feed, HA, n8n)
  - `profiles.rs`, `automation.rs` — Named profiles (`profiles.json`) & `opaline-expr` rules engine (`automation.json`) with hysteresis/min-duration/manual override
  - `app_service.rs`, `ctl.rs`, `desktop.rs`, `shortcuts.rs` — D-Bus API v2 (`io.github.ali_kenjo.Opaline1`), `opaline ctl` + completions, Shell1 v2 (N & N−1 compat) + Instant EWMH watcher
  - `plugins.rs`, `gallery.rs` — Plugin manifest/trust/pack/validate + Gallery SHA-256 & minisign verifier
  - `tests/{migrations,schemas,security}.rs` — 1.1 migration fixtures, JSON Schema staleness, and §12 security suite
- **Tauri binary (`app/src-tauri/src/`):**
  - `main.rs`, `ctl.rs`, `core_mode.rs`, `shell.rs` — CLI (`ctl`, `validate`, `pack`, `--safe-mode`, `--diagnose`, `--dump`) + Shell commands
  - `layer/{plugin_scheme.rs,assets.rs,windows.rs}` — Production `opaline-plugin://` ADR 0014 scheme, `opaline-asset://photos/`, main-frame navigation guard
- **Frontend (`app/src/`):**
  - `inspector/Inspector.tsx` (lazy 33 KB), `builder/WidgetBuilder.tsx` (lazy 22 KB) — both RTL-aware
  - `widgets/{controls,notes,todo,timers,countdown,worldClock,photoFrame,sunMoon,quote,aura,decoration,devWidgets}.tsx` — 16 Phase 7 widgets
  - `plugins/{pluginSandbox.ts,PluginWidget.tsx,hostile.test.ts}` — ADR 0014 sandbox bridge, 2 s watchdog, hostile-plugin suite
  - `settings/{LooksSection,DataSourcesSection,AccountsSection,ProfilesSection,GallerySection}.tsx`, `settingsIndex.ts` — 16 searchable Settings sections
  - `i18n/{messages.ts,index.ts,i18n.test.ts}` — Full en/de/ar parity + `resolvePackageString`
- **Packaging & Docs:** `packaging/completions/{opaline.bash,_opaline,opaline.fish}`, `scripts/validate-gallery-pr.sh`, `examples/template-plugin/`, `docs/{DBUS.md,SDK.md,GALLERY_CONTRIBUTING.md,SECURITY.md,RELEASE.md}`.

---

## 7. Critical Rules, Machine State & Gotchas

- **Commits:** Conventional commits, author `ali-kenjo <285495463+ali-kenjo@users.noreply.github.com>`. **NEVER add `Co-Authored-By` or "Generated with" lines.** Never commit `.claude/`.
- **Live user config:** Installed `opaline 1.1.0` runs against `~/.config/opaline/`. **NEVER let tests or dev runs write to `~/.config/opaline/`**; always use `XDG_CONFIG_HOME=<temp copy>`.
- **Rust lints:** Workspace denies `unsafe_code`, `unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented`, `dbg_macro`; `clippy -D warnings`; `rustfmt`. Use `cargo ... --offline` when sandboxed (all dependencies are cached in `Cargo.lock`). Use `zbus::{OwnedObjectPath, OwnedVariant, Variant}` (not deprecated `zbus::zvariant::*`).
- **TypeScript / React 19 lints:** Strict TS 6 (`exactOptionalPropertyTypes: true`), ESLint `strictTypeChecked` + React Compiler rules:
  - Never allocate a new object inside `host.useValues(selector)` (breaks `useSyncExternalStore`) — select `(all) => all` and memoize with `useMemo`.
  - Never call `setState` synchronously in `useEffect` (use `.then()` with `let alive = true`), and never call `Date.now()` directly inside a render body.
- **Playwright fixtures:** Always pass custom layouts into `fakeInit([...])` (matches `MONITOR_KEY`), and mutate `init.settings.*` (not `init.values.settings`). Never break classic 1.1 Lab baselines (`app/e2e/lab.spec.ts-snapshots/`).
- **Expressions & Compositions:** Change `spec/expressions/*.json` first for expressions; change `crates/opaline-compose/src/model.rs` → `OPALINE_UPDATE_SCHEMA=1 cargo test -p opaline-compose` → `cd app && pnpm gen:types` for compositions.
- **Communication:** The owner prefers plain, short explanations with clickable links. Always ask for sign-off before pushing or touching the live desktop.
