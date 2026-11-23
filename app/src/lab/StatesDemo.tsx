// The card states (brief §4.6): full, dimmed, edit, peek, alert, loading, unavailable, asleep,
// needs permission — at S and M over the selected wallpaper.
import { Card, type CardState } from "../design-system/components";
import { Icon } from "../design-system/icons";
import { Odometer } from "../design-system/motion";
import styles from "./Lab.module.css";

const STATES: { name: string; state: CardState; edit?: boolean; lifted?: boolean }[] = [
  { name: "Full", state: { kind: "full" } },
  { name: "Dimmed", state: { kind: "dimmed" } },
  { name: "Edit", state: { kind: "full" }, edit: true },
  { name: "Lifted", state: { kind: "full" }, lifted: true },
  { name: "Alert", state: { kind: "alert" } },
  { name: "Loading", state: { kind: "loading" } },
  { name: "Unavailable", state: { kind: "unavailable", reason: "No battery on this device" } },
  { name: "Asleep", state: { kind: "asleep", reason: "GPU asleep" } },
  {
    name: "Needs permission",
    state: { kind: "needs-permission", reason: "Turn on CPU power in Settings" },
  },
];

function Content({ value }: { value: number }) {
  return (
    <>
      <div className={styles.cardLabel}>
        <Icon name="thermostat" size={18} /> CPU
      </div>
      <div className={styles.cardValue}>
        <Odometer text={`${Math.round(value)} °C`} className="numeric" />
      </div>
      <div className={styles.cardMeta}>package · 4 cores</div>
    </>
  );
}

export function StatesDemo({ value }: { value: number }) {
  return (
    <div className={styles.states}>
      {STATES.map((s) => (
        <figure key={s.name} className={styles.stateCell}>
          <div className={s.edit ? styles.editOutline : undefined}>
            <Card size="S" label={`CPU, ${s.name}`} state={s.state} lifted={s.lifted ?? false}>
              <Content value={value} />
            </Card>
            {s.edit ? (
              <>
                <span className={`${styles.handle} ${styles.handleN}`} />
                <span className={`${styles.handle} ${styles.handleS}`} />
                <span className={`${styles.handle} ${styles.handleE}`} />
                <span className={`${styles.handle} ${styles.handleW}`} />
              </>
            ) : null}
          </div>
          <figcaption className={styles.cardMeta}>{s.name}</figcaption>
        </figure>
      ))}
    </div>
  );
}
