// Spike S5 (PLAN-2 §4): what hostile plugin code can do where it runs. A classic script, loaded
// into workers (importScripts) and the plugin host page (<script>). Lab builds only.
self.runProbes = async function runProbes() {
  const out = { context: typeof document === "undefined" ? "worker" : "document" };
  const attempt = async (url, init) => {
    try {
      const r = await fetch(url, init);
      return `reached (${String(r.status)} ${r.type})`;
    } catch (e) {
      return `blocked (${e && e.name ? e.name : "error"})`;
    }
  };
  out.origin = self.origin;
  try {
    out.eval = (0, self.eval)("1 + 1") === 2 ? "allowed" : "odd";
  } catch (e) {
    out.eval = `blocked (${e.name})`;
  }
  try {
    out.newFunction = new self.Function("return 1")() === 1 ? "allowed" : "odd";
  } catch (e) {
    out.newFunction = `blocked (${e.name})`;
  }
  out.tauriInternals = "__TAURI_INTERNALS__" in self;
  // An opaque no-cors response only resolves if the request really left the process.
  out.internetNoCors = await attempt("https://example.com/", { mode: "no-cors" });
  out.internetCors = await attempt("https://example.com/");
  // A local service (CUPS on this machine): plugins must not reach localhost either.
  out.localhostNoCors = await attempt("http://127.0.0.1:631/", { mode: "no-cors" });
  const post = { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } };
  out.ipcScheme = await attempt("ipc://localhost/layer_report", post);
  out.ipcHttp = await attempt("http://ipc.localhost/layer_report", post);
  out.appFiles = await attempt("tauri://localhost/layer.html");
  out.assetScheme = await attempt("opaline-asset://wallpaper/none.png");
  out.xhr = await new Promise((resolve) => {
    try {
      const x = new XMLHttpRequest();
      x.open("GET", "https://example.com/");
      x.onload = () => resolve(`reached (${String(x.status)})`);
      x.onerror = () => resolve("blocked (error)");
      x.send();
    } catch (e) {
      resolve(`blocked (${e.name})`);
    }
  });
  out.webSocket = await new Promise((resolve) => {
    try {
      const ws = new WebSocket("ws://127.0.0.1:631/");
      ws.onopen = () => resolve("opened");
      ws.onerror = () => resolve("failed (error event)");
      setTimeout(() => resolve("no answer"), 3000);
    } catch (e) {
      resolve(`blocked (${e.name})`);
    }
  });
  out.indexedDB = typeof indexedDB !== "undefined";
  if (typeof document !== "undefined") {
    try {
      out.parentDocument = parent.document.body ? "readable" : "empty";
    } catch (e) {
      out.parentDocument = `blocked (${e.name})`;
    }
  }
  return out;
};
