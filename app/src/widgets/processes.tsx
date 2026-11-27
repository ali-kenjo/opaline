// Processes widget: the busiest apps (or single processes) by CPU or memory, with End task for
// your own processes (asks first; core checks the PID still belongs to the same process).
import { useState } from "react";
import { Icon } from "../design-system/icons";
import type { SizeClass } from "../design-system/tokens/tokens";
import type { Value } from "../layer/protocol";
import { type ByteUnit, bytes, num, percent, text } from "./format";
import { useHost } from "./host";
import { BYTE_UNIT } from "./options";
import { processesComposition } from "./processes.composition";
import type { CardStatus, RenderCtx, WidgetDef } from "./types";
import styles from "./lists.module.css";

const APPS = "processes.apps";
const LIST = "processes.list";

interface Row {
  key: string;
  name: string;
  cpu: number;
  mem: number;
  count: number | null;
  pid: number | null;
  start: number | null;
  own: boolean;
  system: boolean;
}

function rows(v: Value | undefined, apps: boolean): Row[] {
  if (v?.kind !== "list") return [];
  return v.v.flatMap((r): Row[] => {
    if (r.kind !== "map") return [];
    const m = r.v;
    return [
      {
        key: apps ? (text(m.id) ?? text(m.name) ?? "?") : String(num(m.pid) ?? Math.random()),
        name: text(m.name) ?? "?",
        cpu: num(m.cpu) ?? 0,
        mem: num(m.memB) ?? 0,
        count: apps ? num(m.processes) : null,
        pid: apps ? null : num(m.pid),
        start: apps ? null : num(m.start),
        own: m.own?.kind === "bool" ? m.own.v : false,
        system: m.system?.kind === "bool" ? m.system.v : text(m.app) === "system",
      },
    ];
  });
}

const COUNT: Record<SizeClass, number> = {
  "1x1": 1,
  "2x1": 1,
  "1x2": 2,
  "4x1": 2,
  S: 4,
  "2x3": 6,
  M: 4,
  L: 10,
  "6x4": 11,
  XL: 12,
};

function ProcessList({ ctx }: { ctx: RenderCtx }) {
  const host = useHost();
  const { content, size } = ctx;
  const apps = content.opt<string>("group") === "apps";
  const sort = content.opt<string>("sort");
  const showSystem = content.opt<boolean>("showSystem");
  const allowEnd = content.opt<boolean>("endTask") && !apps;
  const unit = content.opt<ByteUnit>("byteUnit");
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = new Set(content.fields);

  const list = rows(ctx.get(apps ? APPS : LIST), apps)
    .filter((r) => showSystem || !r.system)
    .sort((a, b) => (sort === "memory" ? b.mem - a.mem : b.cpu - a.cpu))
    .slice(0, Math.min(content.opt<number>("count"), COUNT[size]));
  const max = Math.max(1, ...list.map((r) => (sort === "memory" ? r.mem : r.cpu)));

  if (!list.length) return <div className={styles.empty}>Nothing to show</div>;
  return (
    <>
      <ul className={styles.list} aria-label={content.title}>
        {list.map((r) => (
          <li key={r.key} className={styles.item}>
            <Icon name={apps ? "apps" : "terminal"} size={16} className={styles.icon} />
            <span className={styles.name}>
              {r.name}
              {shown.has("count") && r.count !== null ? (
                <span className={styles.meta}> · {r.count}</span>
              ) : null}
            </span>
            <span className={styles.values}>
              {shown.has("cpu") ? <span>{percent(r.cpu, content.decimals)}</span> : null}
              {shown.has("memory") ? <span>{bytes(r.mem, unit, 0)}</span> : null}
              {allowEnd && r.own && r.pid !== null && r.start !== null ? (
                <button
                  type="button"
                  className={`${styles.rowButton} ${asking === r.key ? styles.asking : ""}`}
                  aria-label={asking === r.key ? `Confirm: end ${r.name}` : `End ${r.name}`}
                  onBlur={() => {
                    if (asking === r.key) setAsking(null);
                  }}
                  onClick={() => {
                    if (asking !== r.key) {
                      setAsking(r.key);
                      return;
                    }
                    setAsking(null);
                    host
                      .command({
                        cmd: "end-task",
                        pid: r.pid ?? 0,
                        start: r.start ?? 0,
                        force: false,
                      })
                      .then((res) => {
                        setError(res.result === "err" ? res.reason : null);
                      })
                      .catch(() => {
                        setError("failed");
                      });
                  }}
                >
                  {asking === r.key ? "End?" : <Icon name="close" size={14} />}
                </button>
              ) : null}
            </span>
            {shown.has("bar") ? (
              <span className={styles.bar}>
                <span
                  className={styles.barFill}
                  style={{
                    display: "block",
                    width: `${String(((sort === "memory" ? r.mem : r.cpu) / max) * 100)}%`,
                  }}
                />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <div className={styles.meta} role="status">
          {error}
        </div>
      ) : null}
    </>
  );
}

const column = (
  id: string,
  label: string,
  icon: "speed" | "memory" | "apps" | "bar_chart" | "hard_drive",
) => ({
  id,
  label,
  icon,
  topics: [] as string[],
  hero: false,
  read: () => ({ text: "" }),
});

export const processes: WidgetDef = {
  kind: "processes",
  name: "Processes",
  icon: "terminal",
  category: "system",
  sizes: ["4x1", "S", "M", "L", "XL"],
  defaultSize: "M",
  extraTopics: () => [APPS, LIST],
  defaultFields: ["cpu", "memory", "bar"],
  fields: [
    column("cpu", "CPU", "speed"),
    column("memory", "Memory", "memory"),
    column("io", "Disk I/O", "hard_drive"),
    column("count", "Process count", "apps"),
    column("bar", "Bar", "bar_chart"),
  ],
  options: [
    {
      kind: "enum",
      key: "group",
      label: "Show",
      options: [
        { value: "apps", label: "Apps" },
        { value: "processes", label: "Processes" },
      ],
      default: "apps",
    },
    {
      kind: "enum",
      key: "sort",
      label: "Sort by",
      options: [
        { value: "cpu", label: "CPU" },
        { value: "memory", label: "Memory" },
        { value: "io", label: "Disk I/O" },
      ],
      default: "cpu",
    },
    { kind: "range", key: "count", label: "Rows", min: 1, max: 12, step: 1, default: 8 },
    { kind: "bool", key: "showSystem", label: "Include system", default: false },
    { kind: "bool", key: "showSearch", label: "Search & filter bar", default: true },
    { kind: "bool", key: "showIo", label: "Disk I/O column", default: true },
    {
      kind: "bool",
      key: "endTask",
      label: "End task buttons",
      help: "For your own processes; asks before ending.",
      default: true,
    },
    BYTE_UNIT,
  ],
  status(c): CardStatus {
    const v = c.get(c.content.opt<string>("group") === "apps" ? APPS : LIST);
    if (v === undefined) return { kind: "loading" };
    return v.kind === "missing"
      ? { kind: "unavailable", reason: "Process list unavailable" }
      : { kind: "ready" };
  },
  render: (ctx) => <ProcessList ctx={ctx} />,
  composition: processesComposition,
  useClassicStat: true,
  compositionTopics(values, content) {
    const shown = new Set(content.fields);
    const gpu0 = values["gpu.0.load"];
    const meta: Record<string, Value> = {
      showIo: { kind: "bool", v: content.opt<boolean>("showIo") || shown.has("io") },
      showCount: { kind: "bool", v: shown.has("count") },
      showBar: { kind: "bool", v: shown.has("bar") },
      decimals: { kind: "num", v: content.decimals },
    };
    if (gpu0?.kind === "num") meta.gpuLoad = gpu0;
    return {
      ...values,
      procMeta: { kind: "map", v: meta },
    };
  },
};
