import { useEffect, useLayoutEffect, useRef } from "react";
import { attach, inTauri, report, setInputRegion, subscribe } from "./bridge";
import { startGlassSpike } from "./spike/glassSpike";
import { useLayer } from "./store";
import styles from "./LayerApp.module.css";

const LOADAVG = "system.loadavg";

function formatLoad(v: number): string {
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Phase 0 test widget: shows live load averages from core over the real IPC path. */
function TestCard() {
  const connection = useLayer((s) => s.connection);
  const monitor = useLayer((s) => s.monitor);
  const load = useLayer((s) => s.values[LOADAVG]);

  let body: string;
  if (connection.state === "standalone") body = "Not running inside Opaline";
  else if (connection.state === "connecting") body = "Waiting for Opaline…";
  else if (connection.state === "rejected")
    body = `Core refused the connection (${connection.reason})`;
  else if (load?.kind === "nums") body = load.v.map(formatLoad).join("  ·  ");
  else if (load?.kind === "missing") body = "Unavailable";
  else body = "Loading…";

  return (
    <>
      <div className={styles.label}>Load average · 1, 5, 15 min</div>
      <div className={styles.value} aria-live="polite">
        {body}
      </div>
      <div className={styles.meta}>
        {monitor ? `${monitor.connector} · ${monitor.scale}×` : "—"}
        {connection.state === "connected" ? ` · ${connection.backend}` : ""}
      </div>
    </>
  );
}

export function LayerApp() {
  const apply = useLayer((s) => s.apply);
  const connected = useLayer((s) => s.connection.state === "connected");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!inTauri) {
      useLayer.setState({ connection: { state: "standalone" } });
      return;
    }
    attach(apply).catch((e: unknown) => {
      console.error("layer_attach failed", e);
    });
  }, [apply]);

  useEffect(() => {
    if (connected) {
      subscribe(LOADAVG, "interactive").catch((e: unknown) => {
        console.error("subscribe failed", e);
      });
    }
  }, [connected]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const card = cardRef.current;
    if (!canvas || !card) return;
    const spike = startGlassSpike(canvas, [0.12, 0.13, 0.16]);
    const redraw = () => {
      const rect = card.getBoundingClientRect();
      spike.draw(rect);
      if (inTauri) {
        const { x, y, width, height } = rect;
        setInputRegion([{ x, y, width, height }]).catch((e: unknown) => {
          console.error("input region failed", e);
        });
      }
    };
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(card);
    window.addEventListener("resize", redraw);
    if (inTauri) {
      report("webgl2", { ...spike.result, devicePixelRatio: window.devicePixelRatio }).catch(
        (e: unknown) => {
          console.error("report failed", e);
        },
      );
    }
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", redraw);
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className={styles.glass} aria-hidden="true" />
      <div ref={cardRef} className={styles.card} role="group" aria-label="Load average">
        <TestCard />
      </div>
    </>
  );
}
