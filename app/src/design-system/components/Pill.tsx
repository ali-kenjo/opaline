import type { ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import styles from "./overlays.module.css";

export function Pill({
  children,
  icon,
  outlined,
}: {
  children: ReactNode;
  icon?: IconName;
  outlined?: boolean;
}) {
  return (
    <span className={`${styles.pill} ${outlined ? styles.pillOutlined : ""}`}>
      {icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </span>
  );
}
