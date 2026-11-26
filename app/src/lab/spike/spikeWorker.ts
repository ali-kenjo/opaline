// Spike S2 (PLAN-2 §4): what a Web Worker can do inside the layer's WebKitGTK webview. Runs as a
// module worker from the app's own origin and answers one message with its findings.

interface Probe {
  offscreenCanvas: boolean;
  context2d: boolean;
  webgl2: boolean;
  tauriInternals: boolean;
  evalAllowed: boolean;
  fetchRemote: string;
  fetchRemoteNoCors: string;
  fetchIpc: string;
  origin: string;
  indexedDb: boolean;
}

async function attempt(url: string, init?: RequestInit): Promise<string> {
  try {
    const r = await fetch(url, init);
    return `reached (HTTP ${String(r.status)})`;
  } catch (e) {
    return `blocked (${e instanceof Error ? e.name : "error"})`;
  }
}

self.onmessage = (event: MessageEvent<{ canvas?: OffscreenCanvas }>) => {
  void (async () => {
    const canvas = event.data.canvas;
    let context2d = false;
    let webgl2 = false;
    if (canvas) {
      // A transferred canvas can only have one context: try WebGL2 first, then a fresh one for 2D.
      webgl2 = canvas.getContext("webgl2") !== null;
    }
    if (typeof OffscreenCanvas !== "undefined") {
      context2d = new OffscreenCanvas(8, 8).getContext("2d") !== null;
    }
    const evalAllowed = (() => {
      try {
        // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval -- the point is to see CSP block it
        return (new Function("return 1") as () => number)() === 1;
      } catch {
        return false;
      }
    })();
    const probe: Probe = {
      offscreenCanvas: typeof OffscreenCanvas !== "undefined",
      context2d,
      webgl2,
      tauriInternals: "__TAURI_INTERNALS__" in self,
      evalAllowed,
      fetchRemote: await attempt("https://example.com/"),
      // An opaque no-cors request resolves only if it actually left the process: this tells a CSP
      // block apart from a CORS refusal.
      fetchRemoteNoCors: await attempt("https://example.com/", { mode: "no-cors" }),
      origin: self.location.origin,
      // Tauri's IPC endpoint on Linux; a worker has no invoke key, so it must not get through.
      fetchIpc: await attempt("http://ipc.localhost/layer_report", {
        method: "POST",
        body: JSON.stringify({ key: "spike-worker-ipc", value: '"a worker reached IPC"' }),
        headers: { "Content-Type": "application/json" },
      }),
      indexedDb: typeof indexedDB !== "undefined",
    };
    self.postMessage(probe);
  })();
};
