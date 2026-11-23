import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LayerApp } from "./LayerApp";
import "../design-system/tokens/tokens.css";
import "../design-system/type/fonts.css";
import "./base.css";
import { inTauri, report } from "./bridge";

// Page errors go to the layer log (opaline-layer.<date>.log), where diagnostics can see them.
if (inTauri) {
  const send = (kind: string, message: string) => {
    report(kind, message.slice(0, 2000)).catch(() => undefined);
  };
  window.addEventListener("error", (e) => {
    send("page-error", `${e.message} @ ${e.filename}:${String(e.lineno)}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    send("page-rejection", String(e.reason));
  });
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    original(...args);
    send("console-error", args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  };
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <LayerApp />
    </StrictMode>,
  );
}
