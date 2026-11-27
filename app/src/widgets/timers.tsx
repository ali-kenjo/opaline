// Timers, Stopwatch (with laps), and Pomodoro widget (brief §8.3, PLAN-2 7.3):
// State lives in core (`timers.state`) so running timers survive layer restarts.
import { useState } from "react";
import { Icon } from "../design-system/icons";
import { useHost } from "./host";
import { toJson } from "./json";
import styles from "./p7Widgets.module.css";
import type { RenderCtx, WidgetDef } from "./types";

interface TimerEntry {
  id: string;
  label: string;
  kind: "timer" | "stopwatch" | "pomodoro";
  durationMs: number;
  remainingMs: number;
  elapsedMs: number;
  running: boolean;
  lapsMs: number[];
  pomoPhase: string;
  pomoCompletedToday: number;
}

interface TimerState {
  items?: TimerEntry[];
}

function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${String(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const DEFAULT_FALLBACK: TimerEntry[] = [
  {
    id: "pomodoro",
    label: "Focus",
    kind: "pomodoro",
    durationMs: 25 * 60 * 1000,
    remainingMs: 25 * 60 * 1000,
    elapsedMs: 0,
    running: false,
    lapsMs: [],
    pomoPhase: "work",
    pomoCompletedToday: 0,
  },
];

function TimersBody({ ctx }: { ctx: RenderCtx }) {
  const host = useHost();
  const raw = toJson(ctx.get("timers.state"));
  const parsed = (
    typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}
  ) as TimerState;
  const items = parsed.items && parsed.items.length > 0 ? parsed.items : DEFAULT_FALLBACK;
  const modeFilter = ctx.content.opt<string>("mode");
  const filtered = modeFilter === "all" ? items : items.filter((it) => it.kind === modeFilter);
  const list = filtered.length > 0 ? filtered : items;

  const [activeIdx, setActiveIdx] = useState(0);
  const current = list[activeIdx % list.length] ?? list[0];
  if (!current) return null;

  const displayMs = current.kind === "stopwatch" ? current.elapsedMs : current.remainingMs;
  const pct =
    current.kind === "stopwatch" || current.durationMs <= 0
      ? 0
      : Math.max(0, Math.min(1, 1 - current.remainingMs / current.durationMs));

  const send = (action: "start" | "pause" | "reset" | "lap" | "next-phase") => {
    void host
      .command({ cmd: "timer-action", action, id: current.id })
      .then(() => host.command({ cmd: "release-focus" }));
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>
          <Icon name="schedule" size={16} /> {current.label}
        </span>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {current.kind === "pomodoro" ? (
            <span className={styles.badge}>
              {current.pomoPhase} · {current.pomoCompletedToday}✓
            </span>
          ) : (
            <span className={styles.badge}>{current.kind}</span>
          )}
          {list.length > 1 ? (
            <button
              type="button"
              data-interactive="true"
              aria-label="Next timer"
              className={styles.iconBtn}
              onClick={() => {
                setActiveIdx((i) => (i + 1) % list.length);
              }}
            >
              <Icon name="keyboard_arrow_right" size={15} />
            </button>
          ) : null}
        </div>
      </div>

      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
      >
        <div className={styles.heroNum}>{formatClock(displayMs)}</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            data-interactive="true"
            aria-label={current.running ? "Pause timer" : "Start timer"}
            className={`${styles.iconBtn} ${styles.iconBtnPrimary}`}
            onClick={() => {
              send(current.running ? "pause" : "start");
            }}
          >
            <Icon name={current.running ? "pause" : "play_arrow"} size={16} />
            {current.running ? "Pause" : "Start"}
          </button>
          <button
            type="button"
            data-interactive="true"
            aria-label="Reset timer"
            className={styles.iconBtn}
            onClick={() => {
              send("reset");
            }}
          >
            <Icon name="restart_alt" size={15} />
          </button>
          {current.kind === "stopwatch" ? (
            <button
              type="button"
              data-interactive="true"
              aria-label="Record lap"
              className={styles.iconBtn}
              onClick={() => {
                send("lap");
              }}
            >
              Lap
            </button>
          ) : null}
          {current.kind === "pomodoro" ? (
            <button
              type="button"
              data-interactive="true"
              aria-label="Switch Pomodoro phase"
              className={styles.iconBtn}
              onClick={() => {
                send("next-phase");
              }}
            >
              Skip
            </button>
          ) : null}
        </div>
      </div>

      {current.kind !== "stopwatch" ? (
        <div className={styles.barTrack}>
          <div className={styles.barFill} style={{ width: `${String(Math.round(pct * 100))}%` }} />
        </div>
      ) : current.lapsMs.length > 0 ? (
        <ul className={styles.list}>
          {current.lapsMs.slice(-4).map((lap, idx) => (
            <li key={idx} className={styles.listItem}>
              <span className={styles.sub}>Lap {idx + 1}</span>
              <span className={styles.itemText} style={{ textAlign: "right" }}>
                {formatClock(lap)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export const timersWidget: WidgetDef = {
  kind: "timers",
  name: "Timers & Pomodoro",
  icon: "schedule",
  category: "time",
  sizes: ["2x1", "S", "M", "L"],
  defaultSize: "M",
  topics: ["timers.state"],
  fields: [],
  defaultFields: [],
  options: [
    {
      kind: "enum",
      key: "mode",
      label: "Filter",
      default: "all",
      options: [
        { value: "all", label: "All timers" },
        { value: "pomodoro", label: "Pomodoro" },
        { value: "timer", label: "Timers" },
        { value: "stopwatch", label: "Stopwatch" },
      ],
    },
  ],
  status: () => ({ kind: "ready" }),
  render: (ctx) => <TimersBody ctx={ctx} />,
};
