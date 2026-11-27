// Reference Opaline 2.0 code widget worker (ADR 0014 sandbox).
// Runs in a dedicated Web Worker under opaline-plugin://template-pulse/ with zero network,
// zero eval, and zero Tauri IPC access.
"use strict";

self.onmessage = function (ev) {
  const msg = ev.data;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "ping") {
    self.postMessage({ type: "pong", at: msg.at });
    return;
  }

  if (msg.type === "topics") {
    const raw = msg.values && msg.values["cpu.load"];
    const pct = typeof raw === "number" ? Math.max(0, Math.min(100, raw)) : 0;
    const status = pct >= 80 ? "High load" : pct >= 40 ? "Busy" : "Calm";
    self.postMessage({
      type: "render",
      data: {
        title: "System Pulse",
        value: `${Math.round(pct)}%`,
        subtitle: status,
        progress: pct / 100,
      },
    });
  }
};
