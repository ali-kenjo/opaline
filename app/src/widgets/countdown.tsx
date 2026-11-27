// Countdowns & Year/Month/Day Progress widget (brief §8.3, PLAN-2 7.3).
import { Icon } from "../design-system/icons";
import { useHost } from "./host";
import styles from "./p7Widgets.module.css";
import type { RenderCtx, WidgetDef } from "./types";

export function computeTimeProgress(now: Date) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  const yearStart = new Date(y, 0, 1).getTime();
  const yearEnd = new Date(y + 1, 0, 1).getTime();
  const yearPct = ((now.getTime() - yearStart) / (yearEnd - yearStart)) * 100;

  const monthStart = new Date(y, m, 1).getTime();
  const monthEnd = new Date(y, m + 1, 1).getTime();
  const monthPct = ((now.getTime() - monthStart) / (monthEnd - monthStart)) * 100;

  const dayStart = new Date(y, m, d).getTime();
  const dayEnd = new Date(y, m, d + 1).getTime();
  const dayPct = ((now.getTime() - dayStart) / (dayEnd - dayStart)) * 100;

  return {
    yearPct: Math.max(0, Math.min(100, yearPct)),
    monthPct: Math.max(0, Math.min(100, monthPct)),
    dayPct: Math.max(0, Math.min(100, dayPct)),
  };
}

function CountdownBody({ ctx }: { ctx: RenderCtx }) {
  const host = useHost();
  const now = host.now ? host.now() : new Date();
  const mode = ctx.content.opt<string>("mode");
  const targetName = ctx.content.opt<string>("targetName") || "New Year";
  const targetDateStr =
    ctx.content.opt<string>("targetDate") || `${String(now.getFullYear() + 1)}-01-01`;

  if (mode === "progress") {
    const p = computeTimeProgress(now);
    const rows = [
      { label: "Day", pct: p.dayPct },
      { label: "Month", pct: p.monthPct },
      { label: String(now.getFullYear()), pct: p.yearPct },
    ];
    return (
      <div className={styles.wrap}>
        <div className={styles.header}>
          <span className={styles.title}>
            <Icon name="calendar_today" size={16} /> {ctx.content.title || "Time Progress"}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "auto" }}>
          {rows.map((r) => (
            <div key={r.label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div
                style={{ display: "flex", justifyContent: "space-between", fontSize: "0.74rem" }}
              >
                <span>{r.label}</span>
                <span>{r.pct.toFixed(1)}%</span>
              </div>
              <div className={styles.barTrack}>
                <div
                  className={styles.barFill}
                  style={{ width: `${String(Math.round(r.pct))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const parsed = new Date(`${targetDateStr}T00:00:00`);
  const diffMs = Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime() - now.getTime();
  const past = diffMs < 0;
  const absDays = Math.floor(Math.abs(diffMs) / 86_400_000);
  const absHours = Math.floor((Math.abs(diffMs) % 86_400_000) / 3_600_000);

  return (
    <div className={styles.wrap} style={{ justifyContent: "space-between" }}>
      <div className={styles.header}>
        <span className={styles.title}>
          <Icon name="calendar_today" size={16} /> {targetName}
        </span>
        <span className={styles.badge}>{past ? "Ago" : "Left"}</span>
      </div>
      <div>
        <div className={styles.heroNum}>{absDays}d</div>
        <div className={styles.sub}>
          {absHours}h · {targetDateStr}
        </div>
      </div>
    </div>
  );
}

export const countdownWidget: WidgetDef = {
  kind: "countdown",
  name: "Countdowns",
  icon: "calendar_today",
  category: "time",
  sizes: ["1x1", "2x1", "S", "M"],
  defaultSize: "S",
  topics: [],
  fields: [],
  defaultFields: [],
  options: [
    {
      kind: "enum",
      key: "mode",
      label: "Display",
      default: "date",
      options: [
        { value: "date", label: "Event countdown" },
        { value: "progress", label: "Year / Month / Day" },
      ],
    },
    {
      kind: "text",
      key: "targetName",
      label: "Event name",
      default: "New Year",
      maxLength: 40,
    },
    {
      kind: "text",
      key: "targetDate",
      label: "Target date (YYYY-MM-DD)",
      default: "2027-01-01",
      maxLength: 20,
    },
  ],
  status: () => ({ kind: "ready" }),
  render: (ctx) => <CountdownBody ctx={ctx} />,
};
