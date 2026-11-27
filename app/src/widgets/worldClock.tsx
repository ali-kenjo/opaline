// World Clock widget (brief §8.3, PLAN-2 7.3): up to 6 IANA time zones with day/night indicators.
import { Icon } from "../design-system/icons";
import { useHost } from "./host";
import styles from "./p7Widgets.module.css";
import type { RenderCtx, WidgetDef } from "./types";

function zoneSummary(now: Date, tz: string): { city: string; time: string; isDay: boolean } | null {
  try {
    const time = new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
    const hourStr = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).format(now);
    const hour = Number(hourStr);
    const city = tz.split("/").pop()?.replace(/_/g, " ") ?? tz;
    return { city, time, isDay: hour >= 6 && hour < 19 };
  } catch {
    return null;
  }
}

function WorldClockBody({ ctx }: { ctx: RenderCtx }) {
  const host = useHost();
  const now = host.now ? host.now() : new Date();
  const rawZones = ctx.content.opt<string>("zones");
  const zones = rawZones
    .split(",")
    .map((z) => z.trim())
    .filter(Boolean)
    .slice(0, 6);
  const rows = zones.flatMap((z) => {
    const s = zoneSummary(now, z);
    return s ? [{ tz: z, ...s }] : [];
  });

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>
          <Icon name="schedule" size={16} /> {ctx.content.title || "World Clock"}
        </span>
      </div>
      <ul className={styles.list}>
        {rows.map((r) => (
          <li key={r.tz} className={styles.listItem}>
            <Icon name={r.isDay ? "light_mode" : "dark_mode"} size={15} />
            <span className={styles.itemText}>{r.city}</span>
            <strong style={{ fontVariantNumeric: "tabular-nums" }}>{r.time}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const worldClockWidget: WidgetDef = {
  kind: "world-clock",
  name: "World Clock",
  icon: "schedule",
  category: "time",
  sizes: ["2x1", "4x1", "S", "M", "L"],
  defaultSize: "M",
  topics: [],
  fields: [],
  defaultFields: [],
  options: [
    {
      kind: "text",
      key: "zones",
      label: "Time zones (comma-separated IANA, up to 6)",
      default: "UTC, America/New_York, Europe/Berlin, Asia/Tokyo",
      maxLength: 240,
    },
  ],
  status: () => ({ kind: "ready" }),
  render: (ctx) => <WorldClockBody ctx={ctx} />,
};
