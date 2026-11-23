// The glass context menu (brief §2.7) with keyboard support: arrows move, Home/End jump,
// Enter/Space activate, Esc closes. Focus goes to the first item when it opens.
import { useEffect, useRef } from "react";
import { Icon, type IconName } from "../icons";
import styles from "./overlays.module.css";

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  danger?: boolean;
}

export interface ContextMenuProps {
  items: readonly MenuItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
  label: string;
}

export function ContextMenu({ items, onSelect, onClose, label }: ContextMenuProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (n: number) => buttons[(n + buttons.length) % buttons.length]?.focus();
    if (e.key === "ArrowDown") focus(i + 1);
    else if (e.key === "ArrowUp") focus(i - 1);
    else if (e.key === "Home") focus(0);
    else if (e.key === "End") focus(buttons.length - 1);
    else if (e.key === "Escape") onClose();
    else return;
    e.preventDefault();
  };
  return (
    <div ref={root} className={styles.menu} role="menu" aria-label={label} onKeyDown={onKey}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="menuitem"
          className={`${styles.menuItem} ${it.danger ? styles.danger : ""}`}
          onClick={() => {
            onSelect(it.id);
          }}
        >
          {it.icon ? <Icon name={it.icon} size={20} /> : null}
          {it.label}
        </button>
      ))}
    </div>
  );
}
