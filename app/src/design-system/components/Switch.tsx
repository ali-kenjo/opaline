import { Icon } from "../icons";
import styles from "./controls.module.css";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

/** Material 3 switch: the thumb grows and shows a check when on. */
export function Switch({ checked, onChange, label, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={styles.switch}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
    >
      <span className={styles.thumb}>
        {checked ? <Icon name="check" size={16} weight={600} /> : null}
      </span>
    </button>
  );
}
