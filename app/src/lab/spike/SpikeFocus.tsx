// Spike S3 (PLAN-2 §4, ADR 0015): can a widget on the desktop take keyboard focus when clicked,
// stay below normal windows, and give focus back on Esc? `lab.html?spike=focus` shows a text
// field and logs every focus, blur and key event. Inside the real layer (debug build,
// OPALINE_LAYER_PAGE) each event goes to the layer log as key="spike-focus".
import { useEffect, useState } from "react";
import { command, report, setInputRegion } from "../../layer/bridge";

const inTauri = "__TAURI_INTERNALS__" in window;

interface Entry {
  t: number;
  event: string;
  detail?: string;
}

/** The layer is click-through except where it says otherwise: the whole probe takes clicks. */
function useClickable() {
  useEffect(() => {
    if (!inTauri) return;
    // `region=full` makes the whole window clickable (as Peek does); default: the panel only.
    const full = new URLSearchParams(location.search).get("region") === "full";
    const apply = () => {
      const panel = document
        .querySelector<HTMLElement>('[aria-label="Keyboard focus check"]')
        ?.getBoundingClientRect();
      const field = document
        .querySelector<HTMLElement>('[data-testid="spike-focus-input"]')
        ?.getBoundingClientRect();
      if (!panel || !field) return;
      const rect = full
        ? { x: 0, y: 0, width: innerWidth, height: innerHeight }
        : { x: panel.x, y: panel.y, width: panel.width, height: panel.height };
      void setInputRegion([rect]);
      const center = {
        x: Math.round(field.x + field.width / 2),
        y: Math.round(field.y + field.height / 2),
      };
      void report("spike-focus", {
        event: "input-region",
        detail: JSON.stringify({ rect, field: center }),
      });
    };
    // Again once fonts and layout have settled.
    apply();
    void document.fonts.ready.then(apply);
  }, []);
}

export function SpikeFocus() {
  useClickable();
  const [log, setLog] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  useEffect(() => {
    const start = performance.now();
    const add = (event: string, detail?: string) => {
      const e: Entry = {
        t: Math.round(performance.now() - start),
        event,
        ...(detail ? { detail } : {}),
      };
      setLog((l) => [...l.slice(-40), e]);
      if (inTauri) void report("spike-focus", { ...e, hasFocus: document.hasFocus() });
    };
    const onFocus = () => {
      add("window-focus");
    };
    const onBlur = () => {
      add("window-blur");
    };
    const onKey = (e: KeyboardEvent) => {
      // Only the key's name, never what was typed into another app: this page sees its own keys.
      add("keydown", e.key.length === 1 ? "character" : e.key);
    };
    const onPointer = (e: PointerEvent) => {
      add("pointerdown", `${String(Math.round(e.clientX))},${String(Math.round(e.clientY))}`);
    };
    const onVisible = () => {
      add("visibility", document.visibilityState);
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("visibilitychange", onVisible);
    add("loaded", document.hasFocus() ? "has focus" : "no focus");
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return (
    <section
      aria-label="Keyboard focus check"
      style={{ padding: 40, width: 640, background: "rgb(30 30 40 / 0.9)", color: "white" }}
    >
      <h2>Spike S3: keyboard focus</h2>
      <p>Click the field and type; press Esc; click another window.</p>
      <input
        data-testid="spike-focus-input"
        aria-label="Focus test field"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        onFocus={() => {
          if (inTauri) void report("spike-focus", { event: "input-focus" });
        }}
        onBlur={() => {
          if (inTauri) void report("spike-focus", { event: "input-blur" });
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.currentTarget.blur();
            // As widget buttons do after acting: give focus back through core and the helper.
            if (inTauri) void command({ cmd: "release-focus" });
          }
        }}
        style={{ fontSize: 28, padding: "12px 16px", width: 480, borderRadius: 14 }}
      />
      <p>Typed characters: {text.length}</p>
      <pre data-testid="spike-focus">
        {log.map((e) => `${String(e.t)} ${e.event} ${e.detail ?? ""}`).join("\n")}
      </pre>
    </section>
  );
}
