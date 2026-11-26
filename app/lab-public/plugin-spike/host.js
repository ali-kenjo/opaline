// The plugin host page for spike S5, served from opaline-plugin:// with its own CSP header. It
// probes its own document, then the workers it can start, and answers its parent.
const ask = (worker) =>
  new Promise((resolve) => {
    worker.onmessage = (e) => resolve(e.data.probes ?? e.data);
    worker.onerror = (e) => resolve({ error: e.message || "error event" });
    setTimeout(() => resolve({ error: "no answer in 10 s" }), 10000);
    worker.postMessage("run");
  });

self.addEventListener("message", async (e) => {
  if (e.data === "run") {
    const page = await self.runProbes();
    let worker;
    try {
      worker = await ask(new Worker("worker.js"));
    } catch (err) {
      worker = { error: `${err.name}: ${err.message}` };
    }
    let blobWorker;
    try {
      const code = await (await fetch("probes.js")).text();
      const handler = `self.onmessage = async () => self.postMessage({ probes: await self.runProbes() });`;
      const url = URL.createObjectURL(new Blob([code, "\n", handler], { type: "text/javascript" }));
      blobWorker = await ask(new Worker(url));
    } catch (err) {
      blobWorker = { error: `${err.name}: ${err.message}` };
    }
    parent.postMessage({ spike: "s5", page, worker, blobWorker }, "*");
  }
  if (typeof e.data === "string" && e.data.startsWith("navigate:")) {
    // Last test: if this works, the layer reloads the spike page with this marker.
    try {
      top.location.href = `tauri://localhost/lab.html?spike=sandbox&navigated-by-plugin=${e.data.slice(9)}`;
      parent.postMessage({ spike: "s5", navigation: "attempted, page still here" }, "*");
    } catch (err) {
      parent.postMessage({ spike: "s5", navigation: `blocked (${err.name})` }, "*");
    }
  }
  if (e.data === "spin") {
    const t = Date.now();
    while (Date.now() - t < 500) {
      // busy on the host page's thread
    }
    parent.postMessage({ spike: "s5", spun: true }, "*");
  }
});
parent.postMessage({ spike: "s5", ready: true }, "*");
