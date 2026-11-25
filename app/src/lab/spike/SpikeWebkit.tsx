// Spike S2 (PLAN-2 §4, ADR 0013): which web-platform features the layer's WebKitGTK supports.
// `lab.html?spike=webkit`. Inside the real layer (debug build, OPALINE_LAYER_PAGE) the results go
// to the layer log as key="spike-webkit"; in a browser they're shown on the page.
import { useEffect, useState } from "react";
import { report } from "../../layer/bridge";

type Results = Record<string, unknown>;

const inTauri = "__TAURI_INTERNALS__" in window;

/** Width of a text in a font with given variation settings, in px. */
function measure(family: string, variation: string): number {
  const span = document.createElement("span");
  span.textContent = "Opaline 0123456789 widgets";
  span.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:24px "${family}";font-variation-settings:${variation}`;
  document.body.append(span);
  const w = span.getBoundingClientRect().width;
  span.remove();
  return Math.round(w * 10) / 10;
}

function containerQueryWorks(): boolean {
  const style = document.createElement("style");
  style.textContent =
    ".s2-box{container-type:inline-size;width:300px}" +
    "@container (min-width: 200px){.s2-child{color:rgb(1, 2, 3)}}";
  const box = document.createElement("div");
  box.className = "s2-box";
  const child = document.createElement("div");
  child.className = "s2-child";
  box.append(child);
  document.head.append(style);
  document.body.append(box);
  const ok = getComputedStyle(child).color === "rgb(1, 2, 3)";
  box.remove();
  style.remove();
  return ok;
}

function webgl(): Results {
  const gl = document.createElement("canvas").getContext("webgl2");
  if (!gl) return { webgl2: false };
  return {
    webgl2: true,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    colorBufferFloat: gl.getExtension("EXT_color_buffer_float") !== null,
    floatLinear: gl.getExtension("OES_texture_float_linear") !== null,
  };
}

async function workerProbe(): Promise<Results> {
  const worker = new Worker(new URL("./spikeWorker.ts", import.meta.url), { type: "module" });
  const canvas = document.createElement("canvas");
  const transferable = "transferControlToOffscreen" in canvas;
  const answer = new Promise<Results>((resolve) => {
    worker.onmessage = (e: MessageEvent<Results>) => {
      resolve(e.data);
    };
    worker.onerror = (e) => {
      resolve({ error: e.message });
    };
    setTimeout(() => {
      resolve({ error: "no answer in 5 s" });
    }, 5000);
  });
  if (transferable) {
    const off = canvas.transferControlToOffscreen();
    worker.postMessage({ canvas: off }, [off]);
  } else {
    worker.postMessage({});
  }
  const result = await answer;
  worker.terminate();
  return { transferControlToOffscreen: transferable, ...result };
}

async function run(): Promise<Results> {
  await document.fonts.load('24px "Roboto Flex Variable"');
  const fallbackMono = measure("monospace", "normal");
  const fallbackSerif = measure("serif", "normal");
  const ubuntuPlain = measure("Ubuntu Sans", "normal");
  const thin = measure("Ubuntu Sans", '"wght" 100');
  const heavy = measure("Ubuntu Sans", '"wght" 900');
  const narrow = measure("Ubuntu Sans", '"wdth" 75');
  const wide = measure("Ubuntu Sans", '"wdth" 100');
  const flexNarrow = measure("Roboto Flex Variable", '"wdth" 25');
  const flexWide = measure("Roboto Flex Variable", '"wdth" 151');
  return {
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    pageFetchRemoteNoCors: await fetch("https://example.com/", { mode: "no-cors" }).then(
      () => "reached",
      (e: unknown) => `blocked (${e instanceof Error ? e.name : "error"})`,
    ),
    css: {
      containerQueries: containerQueryWorks(),
      containerUnits: CSS.supports("width", "10cqw"),
      hasSelector: CSS.supports("selector(:has(a))"),
      colorMix: CSS.supports("color", "color-mix(in oklch, red, blue)"),
      textWrapBalance: CSS.supports("text-wrap", "balance"),
      clipPathPath: CSS.supports("clip-path", 'path("M0 0L1 1Z")'),
      backdropFilter: CSS.supports("backdrop-filter", "blur(2px)"),
      atProperty: "registerProperty" in CSS,
      viewTransitions: "startViewTransition" in document,
    },
    fonts: {
      ubuntuSansResolved: {
        width: ubuntuPlain,
        monospace: fallbackMono,
        serif: fallbackSerif,
        resolved: ubuntuPlain !== fallbackMono && ubuntuPlain !== fallbackSerif,
      },
      systemVariableWeight: { thin, heavy, works: heavy > thin + 1 },
      systemVariableWidth: { narrow, wide, works: wide > narrow + 1 },
      robotoFlexWidth: { narrow: flexNarrow, wide: flexWide, works: flexWide > flexNarrow + 1 },
    },
    gl: webgl(),
    worker: await workerProbe(),
    apis: {
      offscreenCanvasMain: typeof OffscreenCanvas !== "undefined",
      requestIdleCallback: "requestIdleCallback" in window,
      compressionStream: typeof CompressionStream !== "undefined",
      structuredClone: typeof structuredClone === "function",
    },
  };
}

export function SpikeWebkit() {
  const [results, setResults] = useState<Results | null>(null);
  useEffect(() => {
    // Fonts first, so the width measurements see the real faces.
    void document.fonts.ready.then(async () => {
      const r = await run();
      setResults(r);
      if (inTauri) void report("spike-webkit", r);
    });
  }, []);
  return (
    <section aria-label="WebKit feature check">
      <h2>Spike S2: WebKit features</h2>
      <pre data-testid="spike-webkit">
        {results ? JSON.stringify(results, null, 2) : "running…"}
      </pre>
    </section>
  );
}
