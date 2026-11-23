// Material Symbols Rounded (docs/DESIGN.md §7): fill and weight follow state with a short,
// non-overshooting transition. Icons are decorative unless given a label.
import { ICONS, type IconName } from "./codepoints";
import styles from "./Icon.module.css";

export interface IconProps {
  name: IconName;
  /** 0 = outline, 1 = filled (active, alert). */
  fill?: 0 | 1;
  weight?: 300 | 400 | 500 | 600 | 700;
  size?: number;
  /** For icons that carry meaning on their own (status without text). */
  label?: string;
  className?: string | undefined;
}

export function Icon({ name, fill = 0, weight = 400, size = 24, label, className }: IconProps) {
  return (
    <span
      className={`${styles.icon} ${className ?? ""}`}
      style={{
        fontSize: size,
        fontVariationSettings: `"FILL" ${fill}, "wght" ${weight}, "GRAD" 0, "opsz" ${Math.min(48, Math.max(20, size))}`,
      }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {String.fromCodePoint(ICONS[name])}
    </span>
  );
}
