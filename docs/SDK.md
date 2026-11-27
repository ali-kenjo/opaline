# Opaline 2.0 Plugin & Package SDK

Opaline supports two kinds of community packages:

1. **Declarative packages** (recommended first): themes (`.opaline-theme`), rices (`.opaline-rice`), custom widget compositions (`composition.json`), and custom data source definitions. Pure JSON, assets, and safe Opaline expressions — zero arbitrary JavaScript.
2. **Sandboxed code widgets** (`.opaline-plugin`): JavaScript widgets for visuals or stateful logic beyond declarative expressions, running inside Opaline's **ADR 0014 Web Worker sandbox**.

---

## 1. Quick Start (`examples/template-plugin`)

Copy `examples/template-plugin/` as your starting point:

```bash
cp -r examples/template-plugin my-widget
opaline validate my-widget
opaline pack my-widget
```

Install the generated `.opaline-plugin` file in **Settings → Plugins & Gallery → Install from package file**, review the declared permissions, and click **Approve**.

---

## 2. Manifest Format (`plugin.json`)

```json
{
  "version": 1,
  "id": "my-widget",
  "name": "My Widget",
  "pluginVersion": "1.0.0",
  "author": "Your Name",
  "license": "GPL-3.0-or-later",
  "minOpalineVersion": "2.0.0",
  "kind": "code-widget",
  "entry": "worker.js",
  "sizes": ["S", "M"],
  "description": "One-sentence summary shown in the Gallery.",
  "translations": {
    "de": { "title": "Mein Widget" },
    "ar": { "title": "أداتي" }
  },
  "permissions": {
    "topics": ["cpu.load", "memory.percent"],
    "sources": [],
    "actions": ["media-toggle"]
  }
}
```

### Permission & Trust Model

- **Topics:** Your worker ONLY receives topic keys explicitly listed in `permissions.topics`. All other core topics (calendar, notes, public IP, etc.) are filtered out before crossing the bridge.
- **Actions:** Only actions listed in **both** Opaline's safe composition allowlist (`media-toggle`, `media-next`, `media-prev`, `power-profile`, `control-toggle`, `timer-action`, `todo-toggle`, `note-toggle-checkbox`, `ha-toggle-entity`, `n8n-set-workflow-active`) **and** your manifest's `permissions.actions` may be dispatched.
- **Re-approval on change:** Core hashes `(id, pluginVersion, permissions, entry script)` with SHA-256. Any change to code or permissions automatically revokes trust until the user approves the updated package.

---

## 3. Sandbox Architecture & Worker Protocol (ADR 0014)

Code widgets run strictly inside a dedicated Web Worker started by an Opaline-owned host frame served from `opaline-plugin://<plugin-id>/` with:

```http
Content-Security-Policy: default-src 'none'; script-src 'self'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors tauri://localhost
```

- **No direct network (`fetch` / `WebSocket` blocked).** Need remote data? Declare a core HTTP/MQTT/D-Bus custom source and subscribe to its `source.<id>` topic.
- **No `eval` / `new Function`, no DOM, no Tauri IPC (`__TAURI_INTERNALS__` is absent), no top-level navigation.**
- **2 s Watchdog:** Answer `{ type: "ping" }` with `{ type: "pong" }` promptly. Workers that busy-loop or hang for > 2 s are terminated and restarted with backoff without affecting other desktop widgets.

### Worker Message Contract

Incoming messages (`self.onmessage`):
- `{ type: "ping", at: number }` → reply `self.postMessage({ type: "pong", at: msg.at })`
- `{ type: "topics", values: Record<string, unknown> }` → compute structured output and reply:

```js
self.postMessage({
  type: "render",
  data: {
    title: "System Pulse",
    value: "42%",
    subtitle: "CPU load",
    progress: 0.42
  }
});
```

Optional allow-listed action dispatch:
```js
self.postMessage({ type: "action", cmd: "media-toggle" });
```

---

## 4. Author CLI Tools

- **`opaline validate <dir>`**: Verifies `plugin.json` schema, semver, entry file presence & size caps (≤ 512 KiB JS), safe relative paths (no symlinks / zip-slip), CSS safety (no remote `@import` or `url(https:...)`), and action allowlists.
- **`opaline pack <dir> [-o out.opaline-plugin]`**: Runs validation, packs deterministic ZIP archive, and prints the file count, byte size, and SHA-256 digest ready for Gallery submission.
- **Live config reload**: While developing declarative themes or custom widgets under `~/.config/opaline/`, core's file watcher automatically reloads valid edits live.
