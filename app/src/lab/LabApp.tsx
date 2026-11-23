// The Widget Lab (dev builds only, docs/PLAN.md 2.8): every widget × size × theme × state over
// selectable wallpapers, with mock data. It grows with Phase 2 and 3.
import { useEffect, useState } from "react";
import styles from "./Lab.module.css";
import { Specimen } from "./Specimen";

export function LabApp() {
  const [value, setValue] = useState(42.5);
  useEffect(() => {
    // The odometer rolls in the live Lab; screenshots set ?still to freeze it.
    if (new URLSearchParams(location.search).has("still")) return;
    const id = setInterval(() => {
      setValue((v) => Math.round((v + (Math.random() - 0.45) * 6) * 10) / 10);
    }, 1500);
    return () => {
      clearInterval(id);
    };
  }, []);
  return (
    <main className={styles.lab}>
      <h1 className={styles.heading}>Opaline Widget Lab</h1>
      <Specimen value={value} />
    </main>
  );
}
