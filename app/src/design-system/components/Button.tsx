import type { ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import styles from "./controls.module.css";

export interface ButtonProps {
  children?: ReactNode;
  variant?: "filled" | "tonal" | "outlined" | "text";
  icon?: IconName;
  /** An icon-only button needs a label for screen readers. */
  label?: string;
  disabled?: boolean;
  onClick?: () => void;
}

export function Button({
  children,
  variant = "filled",
  icon,
  label,
  disabled,
  onClick,
}: ButtonProps) {
  const iconOnly = icon && !children;
  return (
    <button
      type="button"
      className={`${styles.button} ${variant === "text" ? "" : (styles[variant] ?? "")} ${iconOnly ? styles.icon : ""}`}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} size={20} /> : null}
      {children}
    </button>
  );
}
