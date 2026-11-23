// When the Lab runs inside the Tauri layer window (debug builds, OPALINE_LAYER_PAGE=lab.html),
// it reports what the glass compositor does in the real WebKitGTK webview to the layer log:
// whether WebGL2 came up, read-back pixels inside a card and in empty space, and whether an idle
// stage keeps drawing. `grep 'key="lab-glass"'` in opaline-layer.<date>.log.
import type { GlassCompositor } from "../design-system/glass/compositor";
import { report } from "../layer/bridge";

let current: GlassCompositor | null = null;

export function trackCompositor(compositor: GlassCompositor | null): void {
  current = compositor;
}

const inTauri = "__TAURI_INTERNALS__" in window;

export function runWebviewCheck(): void {
  if (!inTauri) return;
  setTimeout(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-glass] canvas");
    const card = document.querySelector<HTMLElement>('[role="group"][aria-label="CPU"]');
    if (!current || !canvas || !card) {
      void report("lab-glass", {
        compositor: document.querySelector("[data-glass]")?.getAttribute("data-glass") ?? null,
        found: { canvas: Boolean(canvas), card: Boolean(card) },
      });
      return;
    }
    const origin = canvas.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    const inside = current.probe(
      box.left - origin.left + box.width / 2,
      box.top - origin.top + box.height / 2,
    );
    const empty = current.probe(2, 2);
    const drawsBefore = current.draws;
    setTimeout(() => {
      void report("lab-glass", {
        compositor: "webgl2",
        devicePixelRatio: window.devicePixelRatio,
        canvas: [canvas.width, canvas.height],
        insideCard: inside,
        emptySpace: empty,
        idleDrawsInOneSecond: (current?.draws ?? 0) - drawsBefore,
      });
    }, 1000);
  }, 2000);
}
