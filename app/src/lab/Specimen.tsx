// Type and icon specimen: proves the bundled fonts and the icon subset (with its axes) load.
import { Icon, type IconName } from "../design-system/icons";
import { Odometer } from "../design-system/motion";
import styles from "./Lab.module.css";

const SAMPLE_ICONS: IconName[] = [
  "developer_board",
  "memory",
  "thermostat",
  "battery_5_bar",
  "wifi",
  "music_note",
  "sunny",
  "mode_fan",
];

export function Specimen({ value }: { value: number }) {
  return (
    <section className={styles.section} aria-label="Type and icons">
      <h2 className={styles.heading}>Type and icons</h2>
      <p className={styles.display}>
        <Odometer text={`${value.toFixed(1)} °C`} className="numeric" />
      </p>
      <p className={styles.title}>Inter: CPU · Memory · Storage — 0123456789</p>
      <p className={styles.body} lang="ar" dir="rtl">
        المعالج · الذاكرة · التخزين ٠١٢٣٤٥٦٧٨٩
      </p>
      <div className={styles.icons}>
        {SAMPLE_ICONS.map((n) => (
          <Icon key={n} name={n} size={32} />
        ))}
      </div>
      <div className={styles.icons} data-testid="filled-icons">
        {SAMPLE_ICONS.map((n) => (
          <Icon key={n} name={n} size={32} fill={1} weight={600} />
        ))}
      </div>
    </section>
  );
}
