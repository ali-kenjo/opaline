# ADR 0013: What the layer's WebKitGTK supports (spike S2)

Status: accepted · 2026-11-26 (Opaline 2.0, Phase 1)

## Context
The 2.0 brief (§15) asks to verify, before depending on them: CSS container queries, variable-font axes on system
fonts, OffscreenCanvas in workers, and whether the Content Security Policy applies to workers. Machine: Ubuntu
26.04.1, WebKitGTK 2.52.6 (`libwebkit2gtk-4.1-0 2.52.6-0ubuntu0.26.04.2`), Tauri 2.12, both monitors.

## How it was measured
`lab.html?spike=webkit` (`app/src/lab/spike/`) loaded inside the real layer windows of a debug build
(`OPALINE_LAYER_PAGE='lab.html?spike=webkit'`, Native mode), reporting to the layer log as `key="spike-webkit"`.
A module worker from the app's own origin (`spikeWorker.ts`) probes the worker side. Results were identical in the
`HDMI-2` window (dpr 1) and the `eDP-1` window (dpr 2).

## Results

| Feature | Result | Use in 2.0 |
| - | - | - |
| CSS container queries and `cq*` units | ✅ work | composition breakpoints for free sizes (P2, P5) |
| `:has()`, `color-mix()`, `@property`, `text-wrap: balance`, `clip-path: path()` | ✅ | shape masks for art and photos, titles |
| View transitions | ✅ | candidate for theme switching (P3) |
| `backdrop-filter` | ✅ supported | still not used for the desktop glass (the brief says so; the WebGL compositor stays) |
| WebGL2 in the page | ✅ max texture 16384, float colour buffers, float linear filtering | full-resolution wallpapers fit (S1) |
| Variable axes of **bundled** fonts (`@font-face`, Roboto Flex `wdth` 25–151) | ✅ work (after the font is loaded) | the per-size width axis of the type scale |
| Variable axes of **system** fonts (Ubuntu Sans `wght`/`wdth` via `font-variation-settings`) | ❌ no effect (the family resolves, the axes don't move) | system fonts get weight and width only through named instances; the width axis is a bundled-font feature |
| `OffscreenCanvas` and `transferControlToOffscreen` | ✅ in the page and in workers | |
| 2D context in a worker | ✅ | possible for plugin visuals |
| WebGL2 context in a worker | ❌ `getContext("webgl2")` returns null | plugins can't draw WebGL in a worker |
| `requestIdleCallback` | ❌ missing | use the motion scheduler or timers |
| `CompressionStream`, `structuredClone` | ✅ | packages, plugin messages |
| **CSP in workers** | ❌ **not applied**: `eval` works in a worker, and a worker's `fetch("https://example.com/", { mode: "no-cors" })` **reaches the network**, while the same call from the page is blocked | see below |
| Tauri internals in a worker | ✅ absent (`__TAURI_INTERNALS__` not defined) | |
| Worker to Tauri's IPC endpoint (`http://ipc.localhost`) | ✅ blocked (worker origin `tauri://localhost`, cross-origin, no invoke key) | |

## Decisions
1. **Compositions use CSS container queries** for in-between sizes (no measured-breakpoint JavaScript needed).
2. **The type scale's width axis applies to bundled variable fonts only.** For a system font the inspector offers
   weight and the font's named widths, and hides the width slider.
3. **The plugin sandbox (spike S5) can't rely on the page's CSP.** A plain Web Worker from the app's origin can reach
   the internet. Before any plugin code, S5 must prove one of: (a) workers created from a script served with its own
   `Content-Security-Policy` response header (for example through Opaline's custom protocol), if WebKitGTK honours
   it; (b) a sandboxed iframe with an opaque origin and a CSP of its own, hosting the worker; (c) a network-level
   block for the plugin's context. The hostile-plugin suite must include a `no-cors` fetch and `eval`.
4. Plugin visuals in workers are **2D only** (OffscreenCanvas 2D); WebGL visuals stay first-party Canvas blocks.

## Consequences
- The brief's assumption "verify that CSP applies to workers" is answered **no**; PLAN-2 spike S5 gets the extra
  checks above.
- Re-run `lab.html?spike=webkit` after WebKitGTK updates (the page and its log key stay in the Lab for that).
