# ADR 0002: Stay on Tauri 2 stable

Status: accepted · 2026-11-22

## Context
On 2026-11-22 the newest `tauri` crate on crates.io is `3.0.0-alpha.6`. The newest stable line is 2.x (CLI 2.12.6
on npm). The brief asks for Tauri 2 and links `libwebkit2gtk-4.1` + GTK 3, which Ubuntu 26.04 ships
(webkit2gtk 2.52.6, GTK 3.24.52 installed here).

## Decision
Use the latest Tauri **2.x stable** (`tauri = "2"`, `@tauri-apps/cli@^2`) and its v2 plugins. Don't use 3.0 alphas.

## Consequences
- The GTK 3 window handle is available for input shapes (`gdk_window_input_shape_combine_region`) and the X11
  keep-below hints in Instant mode.
- We'll look at Tauri 3 again after 1.0 ships, once it is stable. Any GTK 4 move would affect the input-region and
  Instant-mode code, which sit behind `DesktopBackend` and a small `platform/gtk.rs` module.
