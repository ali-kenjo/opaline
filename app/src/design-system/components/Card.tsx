// A widget card: glass at the size class's radius and padding, with the appearance states
// (docs/DESIGN.md §5). Unavailable / asleep / needs-permission show the reason, never numbers.
import type { ReactNode } from "react";
import { Glass } from "../glass";
import { Icon, type IconName } from "../icons";
import { type SizeClass, cardPadding, cardRadius, sizes, spanPx } from "../tokens/tokens";
import { LoadingIndicator } from "./LoadingIndicator";
import styles from "./overlays.module.css";

export type CardState =
  | { kind: "full" }
  | { kind: "dimmed" }
  | { kind: "alert" }
  | { kind: "loading" }
  | { kind: "unavailable"; reason: string }
  | { kind: "asleep"; reason: string }
  | { kind: "needs-permission"; reason: string };

export interface CardProps {
  size: SizeClass;
  label: string;
  state?: CardState;
  lifted?: boolean;
  children?: ReactNode;
}

const reasonIcon: Record<string, IconName> = {
  unavailable: "block",
  asleep: "bedtime",
  "needs-permission": "lock",
};

export function Card({ size, label, state = { kind: "full" }, lifted, children }: CardProps) {
  const { w, h } = sizes[size];
  const reason = "reason" in state ? state.reason : null;
  return (
    <Glass
      radius={cardRadius(size)}
      label={label}
      dimmed={state.kind === "dimmed" ? 1 : 0}
      lifted={lifted ? 1 : 0}
      className={`${styles.card} ${state.kind === "alert" ? styles.alert : ""}`}
      style={{ width: spanPx(w), height: spanPx(h), padding: cardPadding(size) }}
    >
      {state.kind === "loading" ? (
        <div className={styles.reason}>
          <LoadingIndicator size={40} label={`${label}: loading`} />
        </div>
      ) : reason ? (
        <div className={styles.reason} role="status">
          <Icon name={reasonIcon[state.kind] ?? "info"} size={24} />
          <span>{reason}</span>
        </div>
      ) : (
        children
      )}
    </Glass>
  );
}
