// The floating toolbar (Edit mode: Add widget · Presets · Settings · Done). Arrow keys move
// between its buttons (roving focus).
import type { ReactNode } from "react";
import styles from "./overlays.module.css";

export function Toolbar({ label, children }: { label: string; children: ReactNode }) {
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const forward = (e.key === "ArrowRight") !== rtl;
    buttons[(i + (forward ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    e.preventDefault();
  };
  return (
    <div className={styles.toolbar} role="toolbar" aria-label={label} onKeyDown={onKey}>
      {children}
    </div>
  );
}
