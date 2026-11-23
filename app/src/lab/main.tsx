import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../design-system/tokens/tokens.css";
import "../design-system/type/fonts.css";
import { LabApp } from "./LabApp";
import "./lab.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <LabApp />
    </StrictMode>,
  );
}
