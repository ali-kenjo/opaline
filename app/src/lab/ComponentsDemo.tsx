// Every base component (docs/PLAN.md 2.7) in one place, for design review and screenshots.
import { useMemo, useState } from "react";
import { makeRamp } from "../design-system/color/ramps";
import { GNOME_ACCENTS } from "../design-system/color/scheme";
import {
  Button,
  ContextMenu,
  HeatStrip,
  LoadingIndicator,
  Pill,
  Ring,
  Sheet,
  Slider,
  Snackbar,
  Sparkline,
  Switch,
  Toolbar,
  WavyProgress,
} from "../design-system/components";
import styles from "./Lab.module.css";

const SPARK = [12, 18, 15, 22, 30, 26, 41, 38, 35, 47, 52, 44, 39, 48, 61, 58, 50, 46, 55, 63];
const THREADS = [0.08, 0.22, 0.95, 0.4, 0.12, 0.67, 0.31, 0.03];

export function ComponentsDemo({ dark, value }: { dark: boolean; value: number }) {
  const [on, setOn] = useState(true);
  const [level, setLevel] = useState(45);
  const [sheet, setSheet] = useState(false);
  const [snack, setSnack] = useState(true);
  const thermal = useMemo(() => makeRamp("thermal", GNOME_ACCENTS.orange ?? 0, dark), [dark]);
  const load = useMemo(() => makeRamp("load", GNOME_ACCENTS.orange ?? 0, dark), [dark]);
  return (
    <section className={styles.section} aria-label="Components">
      <h2 className={styles.heading}>Components</h2>
      <div className={styles.row}>
        <Button>Filled</Button>
        <Button variant="tonal" icon="add">
          Add widget
        </Button>
        <Button variant="outlined">Outlined</Button>
        <Button variant="text">Text</Button>
        <Button variant="tonal" icon="settings" label="Settings" />
        <Switch checked={on} onChange={setOn} label="Example switch" />
        <div style={{ width: 220 }}>
          <Slider value={level} onChange={setLevel} label="Glass" valueText={`${level} %`} />
        </div>
      </div>
      <div className={styles.row}>
        <Pill icon="bolt">Charging</Pill>
        <Pill outlined icon="wifi">
          5 GHz
        </Pill>
        <Ring value={value / 100} label={`Load ${Math.round(value)} %`} />
        <Ring value={0.62} size={56} thickness={6} color="rgb(var(--md-tertiary))" label="62 %" />
        <LoadingIndicator size={48} />
        <div style={{ width: 240 }}>
          <WavyProgress value={0.64} label="Copying" />
        </div>
      </div>
      <div className={styles.row}>
        <div style={{ width: 280 }}>
          <Sparkline
            values={SPARK}
            min={0}
            max={70}
            label="CPU load, last minute"
            color="rgb(var(--md-primary))"
          />
        </div>
        <div style={{ width: 200 }}>
          <HeatStrip
            values={THREADS}
            ramp={load}
            label="Per-thread load"
            format={(v) => `${Math.round(v * 100)} %`}
          />
        </div>
        <div style={{ width: 200 }}>
          <HeatStrip
            values={[0.1, 0.35, 0.6, 0.85, 1]}
            ramp={thermal}
            label="Thermal ramp"
            format={(v) => `${Math.round(30 + v * 70)} °C`}
          />
        </div>
      </div>
      <div className={styles.row}>
        <Toolbar label="Edit mode">
          <Button variant="text" icon="add">
            Add widget
          </Button>
          <Button variant="text" icon="grid_view">
            Presets
          </Button>
          <Button variant="text" icon="settings">
            Settings
          </Button>
          <Button icon="check">Done</Button>
        </Toolbar>
        <ContextMenu
          label="Widget"
          items={[
            { id: "edit", label: "Edit widgets", icon: "edit" },
            { id: "settings", label: "Widget settings", icon: "tune" },
            { id: "move", label: "Move to display", icon: "open_in_full" },
            { id: "remove", label: "Remove", icon: "delete", danger: true },
          ]}
          onSelect={() => undefined}
          onClose={() => undefined}
        />
        <Button
          variant="tonal"
          onClick={() => {
            setSheet(true);
          }}
        >
          Open sheet
        </Button>
      </div>
      <Sheet
        open={sheet}
        onClose={() => {
          setSheet(false);
        }}
        label="Add widget"
      >
        <h3 className={styles.heading}>Add widget</h3>
        <p className={styles.body}>The widget picker arrives in Phase 5.</p>
      </Sheet>
      {/* A transformed box holds the (fixed) snackbar here, so it doesn't cover the page. */}
      <div style={{ position: "relative", height: 72, transform: "translateZ(0)" }}>
        {snack ? (
          <Snackbar
            message="Widget removed"
            action={{
              label: "Undo",
              onClick: () => {
                setSnack(false);
              },
            }}
            duration={600000}
            onDismiss={() => {
              setSnack(false);
            }}
          />
        ) : null}
      </div>
    </section>
  );
}
