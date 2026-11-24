import "../design-system/type/fonts.css";
import "../design-system/tokens/tokens.css";
import "../shell/shell.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OnboardingApp } from "./OnboardingApp";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <OnboardingApp />
    </StrictMode>,
  );
}
