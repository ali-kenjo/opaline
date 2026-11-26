// Spike S5 (PLAN-2 §4, ADR 0014): where plugin code can run safely in the layer's WebKitGTK.
// `lab.html?spike=sandbox`. It runs the same hostile probes (lab-public/plugin-spike/) in each
// candidate design and measures what a busy loop does to the layer. Inside the real layer
// (debug build, OPALINE_LAYER_PAGE) the results go to the layer log as key="spike-sandbox".
import { useEffect, useState } from "react";
import { report } from "../../layer/bridge";

type Results = Record<string, unknown>;

const inTauri = "__TAURI_INTERNALS__" in window;
const params = new URLSearchParams(location.search);
const BASE = "/plugin-spike";

/** The longest gap between 20 ms ticks of the page's own timer while `during` runs. */
async function lag(during: () => Promise<unknown>): Promise<number> {
  let last = performance.now();
  let worst = 0;
  const id = setInterval(() => {
    const now = performance.now();
    worst = Math.max(worst, now - last);
    last = now;
  }, 20);
  await during();
  await new Promise((r) => setTimeout(r, 60));
  clearInterval(id);
  return Math.round(worst);
}

function ask(worker: Worker, message: string, timeout = 10_000): Promise<Results> {
  return new Promise((resolve) => {
    worker.onmessage = (e: MessageEvent<Results>) => {
      resolve((e.data.probes as Results | undefined) ?? e.data);
    };
    worker.onerror = (e) => {
      resolve({ error: e.message || "error event" });
    };
    setTimeout(() => {
      resolve({ error: `no answer in ${String(timeout / 1000)} s` });
    }, timeout);
    worker.postMessage(message);
  });
}

/** A worker: its probes, a 1.5 s busy loop, and whether terminate() ends an endless one. */
async function workerDesign(make: () => Worker): Promise<Results> {
  let worker: Worker;
  try {
    worker = make();
  } catch (e) {
    return { error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
  const probes = await ask(worker, "run");
  const spinLagMs = await lag(() => ask(worker, "spin"));
  worker.postMessage("forever");
  await new Promise((r) => setTimeout(r, 200));
  worker.terminate();
  // After terminate() the page's timers keep their pace, and the worker answers nothing more.
  const afterTerminate = await ask(worker, "run", 1500);
  return { probes, spinLagMs, terminated: "error" in afterTerminate };
}

async function blobWorker(): Promise<Results> {
  const code = await (await fetch(`${BASE}/probes.js`)).text();
  const handler = `
self.onmessage = async (e) => {
  if (e.data === "run") self.postMessage({ probes: await self.runProbes() });
  if (e.data === "spin") { const t = Date.now(); while (Date.now() - t < 1500) {} self.postMessage({ spun: true }); }
  if (e.data === "forever") { for (;;) {} }
};`;
  const url = URL.createObjectURL(new Blob([code, handler], { type: "text/javascript" }));
  return workerDesign(() => new Worker(url));
}

/** The plugin host page in an iframe from `opaline-plugin://` (optionally sandboxed). */
function iframeDesign(sandbox: boolean): Promise<Results> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    // Cross-origin (another scheme), so allow-same-origin keeps its own origin, not the layer's.
    if (sandbox) frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.style.cssText = "width:1px;height:1px;border:0;position:absolute;left:-10px";
    const result: Results = { sandbox };
    let spinStarted = 0;
    const done = (extra: Results) => {
      window.removeEventListener("message", onMessage);
      frame.remove();
      resolve({ ...result, ...extra });
    };
    const onMessage = (e: MessageEvent<Results>) => {
      if (e.source !== frame.contentWindow || e.data.spike !== "s5") return;
      result.messageOrigin = e.origin;
      if (e.data.ready) frame.contentWindow?.postMessage("run", "*");
      else if (e.data.page) {
        Object.assign(result, {
          page: e.data.page,
          worker: e.data.worker,
          blobWorker: e.data.blobWorker,
        });
        spinStarted = performance.now();
        void lag(
          () =>
            new Promise<void>((r) => {
              const wait = (ev: MessageEvent<Results>) => {
                if (ev.source === frame.contentWindow && ev.data.spun) {
                  window.removeEventListener("message", wait);
                  r();
                }
              };
              window.addEventListener("message", wait);
              frame.contentWindow?.postMessage("spin", "*");
            }),
        ).then((ms) => {
          done({ hostSpinLagMs: ms, hostSpinTotalMs: Math.round(performance.now() - spinStarted) });
        });
      }
    };
    window.addEventListener("message", onMessage);
    frame.onerror = () => {
      done({ error: "iframe failed to load" });
    };
    setTimeout(() => {
      done({ error: "no answer in 30 s" });
    }, 30_000);
    frame.src = "opaline-plugin://spike/host.html";
    document.body.append(frame);
  });
}

/** Last: can the plugin host navigate the layer itself? (It reloads with a marker if so.) */
function navigationTest(sandbox: boolean): Promise<Results> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    // Cross-origin (another scheme), so allow-same-origin keeps its own origin, not the layer's.
    if (sandbox) frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.style.cssText = "width:1px;height:1px;border:0;position:absolute;left:-10px";
    const onMessage = (e: MessageEvent<Results>) => {
      if (e.source !== frame.contentWindow || e.data.spike !== "s5") return;
      if (e.data.ready) {
        frame.contentWindow?.postMessage(`navigate:${sandbox ? "sandboxed" : "plain"}`, "*");
      } else if (e.data.navigation) {
        setTimeout(() => {
          window.removeEventListener("message", onMessage);
          frame.remove();
          resolve({ sandbox, navigation: e.data.navigation });
        }, 1500);
      }
    };
    window.addEventListener("message", onMessage);
    setTimeout(() => {
      resolve({ sandbox, navigation: "no answer" });
    }, 10_000);
    frame.src = "opaline-plugin://spike/host.html";
    document.body.append(frame);
  });
}

/** Runs every design, reporting each as soon as it's done (a navigation must not lose them). */
async function run(publish: (r: Results) => void): Promise<Results> {
  const all: Results = { userAgent: navigator.userAgent };
  const step = async (name: string, f: () => Promise<Results>) => {
    const r = await f().catch((e: unknown) => ({ error: String(e) }));
    all[name] = r;
    publish({ design: name, ...r });
  };
  await step("appWorker", () => workerDesign(() => new Worker(`${BASE}/worker.js`)));
  await step("blobWorker", blobWorker);
  await step("pluginIframe", () => iframeDesign(false));
  await step("sandboxedPluginIframe", () => iframeDesign(true));
  await step("navigationSandboxed", () => navigationTest(true));
  await step("navigationPlain", () => navigationTest(false));
  return all;
}

export function SpikeSandbox() {
  const [results, setResults] = useState<Results | null>(null);
  useEffect(() => {
    // A page the plugin navigated to only reports that it happened (no second round).
    const publish = (r: Results) => {
      if (inTauri) void report("spike-sandbox", r);
    };
    const work = params.has("navigated-by-plugin")
      ? Promise.resolve<Results>({ navigatedByPlugin: params.get("navigated-by-plugin") })
      : run(publish);
    void work.then((r) => {
      setResults(r);
      if (params.has("navigated-by-plugin")) publish(r);
    });
  }, []);
  return (
    <section aria-label="Plugin sandbox check">
      <h2>Spike S5: plugin sandbox</h2>
      <pre data-testid="spike-sandbox">
        {results ? JSON.stringify(results, null, 2) : "running…"}
      </pre>
    </section>
  );
}
