// A snackbar with an optional action (Undo for removals, brief §2.2); it leaves after
// `duration` ms. Announced politely to screen readers.
import { useEffect } from "react";
import styles from "./overlays.module.css";

export interface SnackbarProps {
  message: string;
  action?: { label: string; onClick: () => void };
  duration?: number;
  onDismiss: () => void;
}

export function Snackbar({ message, action, duration = 5000, onDismiss }: SnackbarProps) {
  useEffect(() => {
    const id = setTimeout(onDismiss, duration);
    return () => {
      clearTimeout(id);
    };
  }, [duration, onDismiss]);
  return (
    <div className={styles.snackbar} role="status" aria-live="polite">
      <span>{message}</span>
      {action ? (
        <button type="button" className={styles.snackAction} onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
