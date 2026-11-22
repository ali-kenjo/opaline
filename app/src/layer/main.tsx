import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LayerApp } from "./LayerApp";
import "./base.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <LayerApp />
    </StrictMode>,
  );
}
