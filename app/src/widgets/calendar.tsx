// Calendar widget: upcoming events from GNOME's calendars (Evolution Data Server) and ICS
// subscriptions, grouped by day, with calendar colors.
import { useState } from "react";
import type { Value } from "../layer/protocol";
import { calendarComposition } from "./calendar.composition";
import { missingReason, num, text } from "./format";
import { useHost } from "./host";
import type { CardStatus, RenderCtx, WidgetDef } from "./types";
import styles from "./lists.module.css";

const EVENTS = "calendar.events";

interface Event {
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location: string | null;
  calendar: string | null;
  color: string | null;
}

function events(v: Value | undefined): Event[] {
  if (v?.kind !== "list") return [];
  return v.v.flatMap((e): Event[] => {
    if (e.kind !== "map") return [];
    const start = num(e.v.startMs);
    if (start === null) return [];
    return [
      {
        title: text(e.v.title) ?? "(no title)",
        start,
        end: num(e.v.endMs) ?? start,
        allDay: e.v.allDay?.kind === "bool" && e.v.allDay.v,
        location: text(e.v.location),
        calendar: text(e.v.calendar),
        color: text(e.v.color),
      },
    ];
  });
}

const ROWS = { "1x1": 1, "2x1": 1, "4x1": 2, S: 3, M: 4, L: 9, XL: 12 } as const;
/** Lines (events and day headings) that fit per size. */
const LINES = { "1x1": 1, "2x1": 1, "4x1": 2, S: 4, M: 4, L: 11, XL: 11 } as const;

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getFullYear())}-${String(d.getMonth())}-${String(d.getDate())}`;
}

function CalendarList({ ctx }: { ctx: RenderCtx }) {
  const host = useHost();
  const [now] = useState(() => (host.now?.() ?? new Date()).getTime());
  const { content, size } = ctx;
  const shown = new Set(content.fields);
  const days = Number(content.opt<string>("days"));
  const h24 =
    content.opt<string>("timeFormat") === "24"
      ? true
      : content.opt<string>("timeFormat") === "12"
        ? false
        : undefined;
  const list = events(ctx.get(EVENTS))
    .filter((e) => e.end > now && e.start < now + days * 86_400_000)
    .filter((e) => shown.has("allDay") || !e.allDay)
    .sort((a, b) => a.start - b.start)
    .slice(0, Math.min(content.opt<number>("max"), ROWS[size]));
  if (!list.length)
    return (
      <div className={styles.empty}>
        {days === 1 ? "Nothing else today" : `Nothing in the next ${String(days)} days`}
      </div>
    );

  const today = dayKey(now);
  const tomorrow = dayKey(now + 86_400_000);
  const heading = (ms: number) => {
    const k = dayKey(ms);
    if (k === today) return "Today";
    if (k === tomorrow) return "Tomorrow";
    return new Date(ms).toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "short",
    });
  };
  const time = (ms: number) =>
    new Date(ms).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      ...(h24 === undefined ? {} : { hour12: !h24 }),
    });

  // Day headings before the first event of each day.
  const items: { e: Event; head: string | null; key: string }[] = [];
  let last = "";
  for (const e of list) {
    const k = dayKey(Math.max(e.start, now));
    items.push({
      e,
      key: k,
      head: k !== last && size !== "1x1" && size !== "2x1" ? heading(Math.max(e.start, now)) : null,
    });
    last = k;
  }
  // Headings take a line too: keep what fits, and never end on a heading.
  const fit: typeof items = [];
  let lines = 0;
  for (const it of items) {
    const need = it.head ? 2 : 1;
    if (lines + need > LINES[size]) break;
    fit.push(it);
    lines += need;
  }
  return (
    <ul className={styles.list} aria-label={content.title}>
      {fit.flatMap(({ e, head, key }) => [
        head ? (
          <li key={`h-${key}`} className={styles.section}>
            {head}
          </li>
        ) : null,
        <li key={`${String(e.start)}-${e.title}`} className={styles.item}>
          {shown.has("color") ? (
            <span
              className={styles.dot}
              style={{ background: e.color ?? "rgb(var(--md-primary))" }}
            />
          ) : (
            <span />
          )}
          <span className={styles.name}>
            {e.title}
            {shown.has("location") && e.location ? (
              <span className={styles.meta}> · {e.location}</span>
            ) : null}
            {shown.has("calendar") && e.calendar ? (
              <span className={styles.meta}> · {e.calendar}</span>
            ) : null}
          </span>
          {shown.has("time") ? (
            <span className={styles.values}>
              {e.allDay
                ? "All day"
                : `${time(e.start)}${shown.has("end") ? `–${time(e.end)}` : ""}`}
            </span>
          ) : (
            <span />
          )}
        </li>,
      ])}
    </ul>
  );
}

const part = (
  id: string,
  label: string,
  icon: "schedule" | "event" | "location_on" | "palette" | "calendar_today" | "timer",
) => ({ id, label, icon, topics: [] as string[], hero: false, read: () => ({ text: "" }) });

export const calendar: WidgetDef = {
  kind: "calendar",
  name: "Calendar",
  icon: "calendar_today",
  category: "time",
  sizes: ["2x1", "4x1", "S", "M", "L", "XL"],
  defaultSize: "M",
  topics: [EVENTS],
  defaultFields: ["time", "color", "location", "allDay"],
  fields: [
    part("time", "Start time", "schedule"),
    part("end", "End time", "timer"),
    part("color", "Calendar color", "palette"),
    part("location", "Location", "location_on"),
    part("calendar", "Calendar name", "calendar_today"),
    part("allDay", "All-day events", "event"),
  ],
  options: [
    {
      kind: "enum",
      key: "days",
      label: "Look ahead",
      options: [
        { value: "1", label: "Today" },
        { value: "3", label: "3 days" },
        { value: "7", label: "A week" },
        { value: "14", label: "Two weeks" },
      ],
      default: "7",
    },
    { kind: "range", key: "max", label: "Most events", min: 1, max: 12, step: 1, default: 8 },
    {
      kind: "enum",
      key: "view",
      label: "Layout",
      options: [
        { value: "auto", label: "Auto (month grid on L/XL)" },
        { value: "month", label: "Mini month grid + agenda" },
        { value: "agenda", label: "Agenda only" },
      ],
      default: "auto",
    },
    {
      kind: "enum",
      key: "weekStart",
      label: "Week starts on",
      options: [
        { value: "mon", label: "Monday" },
        { value: "sun", label: "Sunday" },
      ],
      default: "mon",
    },
    {
      kind: "enum",
      key: "timeFormat",
      label: "Time format",
      options: [
        { value: "system", label: "Like the system" },
        { value: "24", label: "24-hour" },
        { value: "12", label: "12-hour" },
      ],
      default: "system",
    },
  ],
  status(c): CardStatus {
    const v = c.get(EVENTS);
    if (v === undefined) return { kind: "loading" };
    const reason = missingReason(v);
    return reason
      ? { kind: "unavailable", reason: `Calendar unavailable (${reason})` }
      : { kind: "ready" };
  },
  render: (ctx) => <CalendarList ctx={ctx} />,
  composition: calendarComposition,
  useClassicStat: true,
  compositionTopics(values, content) {
    const shown = new Set(content.fields);
    return {
      ...values,
      calMeta: {
        kind: "map",
        v: {
          showAllDay: { kind: "bool", v: shown.has("allDay") },
          showColor: { kind: "bool", v: shown.has("color") },
          showLocation: { kind: "bool", v: shown.has("location") },
          showCalendar: { kind: "bool", v: shown.has("calendar") },
          showTime: { kind: "bool", v: shown.has("time") },
          showEnd: { kind: "bool", v: shown.has("end") },
        },
      },
    };
  },
};
