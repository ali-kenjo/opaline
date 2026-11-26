# ADR 0014: Where plugin code runs (spike S5)

Status: accepted · 2026-11-26 (Opaline 2.0, Phase 2)

## Context
Plugins (P9) run code from other people inside the widget layer. The 2.0 brief (§9, §15) asks for a sandbox, and
the composition format must work across its boundary (plain JSON, so it does). S2 (ADR 0013) found that the layer
page's Content-Security-Policy does **not** reach a Web Worker from the app's origin: such a worker can `eval` and
reach the internet. S5 had to find a design that holds, with a hostile test plugin that tries `eval`, a `no-cors`
fetch, localhost, Tauri's IPC, the app's files and the parent page, and with a busy loop.

## How it was measured
`lab.html?spike=sandbox` (`app/src/lab/spike/SpikeSandbox.tsx`) inside the real layer windows of a debug build
(`OPALINE_LAYER_PAGE='lab.html?spike=sandbox'`, Native mode), reporting to the layer log as `key="spike-sandbox"`.
The hostile probes are plain scripts in `app/lab-public/plugin-spike/` (Lab builds only). A debug-only scheme,
`opaline-plugin://spike/` (`app/src-tauri/src/layer/spike.rs`), serves them with this response header:

```
Content-Security-Policy: default-src 'none'; script-src 'self'; worker-src 'self' blob:;
                         connect-src 'self'; frame-ancestors tauri://localhost
```

The layer page's own CSP got `frame-src opaline-plugin:` so it may embed that origin. Machine and WebKitGTK as in
ADR 0013 (2.52.6, Tauri 2.12). The `HDMI-2` (dpr 1) and `eDP-1` (dpr 2) windows gave identical results. A control in
WebKit confirmed the network probe: a `no-cors` fetch to a closed port is rejected, so "reached" means the request
really left the process.

## Results

| Probe | Worker from the app's origin | Blob worker from the page | `opaline-plugin://` host page | its worker (URL and blob) |
| - | - | - | - | - |
| `eval`, `new Function` | ❌ allowed | — (can't start: the page's CSP blocks fetching its code) | ✅ blocked | ✅ blocked |
| internet (`no-cors` fetch to example.com) | ❌ reached | — | ✅ blocked | ✅ blocked |
| localhost (CUPS on `127.0.0.1:631`) | ❌ reached | — | ✅ blocked | ✅ blocked |
| Tauri IPC (`ipc://localhost/…`) | ⚠️ answers 500 (rejected, but reachable) | — | ✅ blocked | ✅ blocked |
| the app's files (`tauri://localhost/…`) | ❌ readable | — | ✅ blocked | ✅ blocked |
| WebSocket | fails | — | ✅ blocked (SecurityError) | ✅ blocked |
| parent page's DOM | — | — | ✅ blocked (SecurityError) | — |
| `__TAURI_INTERNALS__` | absent | — | absent | absent |

The host page iframe, more:
- **Plain iframe** (no `sandbox`): its script **navigated the whole layer window** (`top.location`). Not acceptable.
- **`sandbox="allow-scripts"`**: the origin becomes opaque, `'self'` matches nothing, and none of its scripts run.
- **`sandbox="allow-scripts allow-same-origin"`**: keeps its own origin (`opaline-plugin://spike`), every probe
  above stays blocked, and **top navigation is refused** (SecurityError). The usual warning about this pair applies
  to a frame from the parent's own origin, which could remove its sandbox; this frame is another scheme.

Busy loops:
- A 1.5 s loop in a plugin **worker** delayed the layer's 20 ms timer by at most **24 ms**; `terminate()` ended an
  endless loop and the layer kept its pace.
- A 0.5 s loop in the **host page** froze the layer for **501–513 ms**: the iframe shares the layer's main thread
  (WebKitGTK has no per-site process for it).

A network block for the whole web process was tried as defense in depth: pointing it at a dead proxy (WebKit's
`set_network_proxy_settings`, both on the existing view and through Tauri's `proxy_url` before the view exists) did
**not** stop a worker's requests. WebKit's content filters could, but they're only reachable through raw FFI, which
the workspace's `unsafe_code = "deny"` rules out. Not pursued.

## Decision
1. **Plugin code runs only in a dedicated Web Worker, started by an Opaline-owned host page** served from
   `opaline-plugin://<plugin-id>/` with the CSP above on every response. Each plugin gets its own origin, so its
   storage is its own. The host page is our code: it starts the worker, relays messages and never runs plugin code.
2. **The host iframe has `sandbox="allow-scripts allow-same-origin"`**, and is never served from the layer's origin.
3. **The layer accepts a message only if** `event.source` is that plugin's frame and `event.origin` is
   `opaline-plugin://<plugin-id>`. Messages are structured data. A plugin gets the topic values it declared and was
   approved for (§4.5 of the brief), and acts only through the composition command allowlist (docs/COMPOSITION.md).
4. **Watchdog:** the worker answers a heartbeat; one that misses it for 2 s, or takes too long on a message, is
   terminated, its block shows "unavailable" and it restarts with backoff (`terminate()` was shown to end an endless
   loop). A worker's memory can't be capped per plugin; the web process limit (ADR 0009) is the backstop.
5. **The layer page's CSP keeps `frame-src opaline-plugin:`** and gets no `blob:` workers; nothing else changes.
6. For P9, as defense in depth: a main-frame navigation guard on the layer windows (only the layer page may load).

## Consequences
- P9 builds the real `opaline-plugin://<id>/` scheme (package files instead of Lab assets, the same headers), the
  host page, the message protocol and the watchdog. The spike's scheme stays debug-only, so the page and its log key
  can be re-run after WebKitGTK updates.
- Plugin visuals are OffscreenCanvas 2D in the worker (ADR 0013), or compositions the plugin returns as data.
