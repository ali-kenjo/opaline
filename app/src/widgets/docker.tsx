// Docker widget: containers of Docker Engine, Docker Desktop or Podman, with state, CPU and
// memory, start / stop / restart (stop and restart ask first), and starting Docker Desktop.
import { useState } from "react";
import { Icon } from "../design-system/icons";
import type { Value } from "../layer/protocol";
import { dockerComposition } from "./docker.composition";
import { type ByteUnit, bytes, map, num, percent, text } from "./format";
import { useHost } from "./host";
import { BYTE_UNIT } from "./options";
import type { CardStatus, RenderCtx, WidgetDef } from "./types";
import styles from "./lists.module.css";

const STATE = "docker.state";
const CONTAINERS = "docker.containers";

interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  project: string | null;
  cpu: number | null;
  mem: number | null;
}

function containers(v: Value | undefined): Container[] {
  if (v?.kind !== "list") return [];
  return v.v.flatMap((c): Container[] =>
    c.kind === "map"
      ? [
          {
            id: text(c.v.id) ?? "",
            name: (text(c.v.name) ?? "?").replace(/^\//, ""),
            image: text(c.v.image) ?? "",
            state: text(c.v.state) ?? "unknown",
            status: text(c.v.status) ?? "",
            project: text(c.v.project),
            cpu: num(c.v.cpu),
            mem: num(c.v.memB),
          },
        ]
      : [],
  );
}

const ROWS = {
  "1x1": 1,
  "2x1": 1,
  "1x2": 2,
  "4x1": 2,
  S: 3,
  "2x3": 5,
  M: 4,
  L: 9,
  "6x4": 10,
  XL: 12,
} as const;

function DockerList({ ctx }: { ctx: RenderCtx }) {
  const host = useHost();
  const { content, size } = ctx;
  const shown = new Set(content.fields);
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = text(map(ctx.get(STATE))?.status);
  const unit = content.opt<ByteUnit>("byteUnit");

  const run = (cmd: Parameters<typeof host.command>[0]) => {
    host
      .command(cmd)
      .then((r) => {
        setError(r.result === "err" ? r.reason : null);
      })
      .catch(() => {
        setError("failed");
      });
  };

  if (status === "desktop-stopped") {
    return (
      <div className={styles.empty}>
        <div>
          <p>Docker Desktop is stopped</p>
          <button
            type="button"
            className={`${styles.rowButton} ${styles.asking}`}
            style={{ opacity: 1, padding: "0 12px" }}
            onClick={() => {
              run({ cmd: "start-docker-desktop" });
            }}
          >
            <Icon name="play_arrow" size={16} /> Start Docker Desktop
          </button>
          {error ? <p className={styles.meta}>{error}</p> : null}
        </div>
      </div>
    );
  }

  const all = containers(ctx.get(CONTAINERS))
    .filter((c) => content.opt<boolean>("showStopped") || c.state === "running")
    .sort(
      (a, b) =>
        (a.state === "running" ? 0 : 1) - (b.state === "running" ? 0 : 1) ||
        a.name.localeCompare(b.name),
    );
  const list = all.slice(0, ROWS[size]);
  if (!list.length)
    return (
      <div className={styles.empty}>
        {content.opt<boolean>("showStopped") ? "No containers" : "No running containers"}
      </div>
    );

  return (
    <>
      <ul className={styles.list} aria-label={content.title}>
        {list.map((c) => {
          const running = c.state === "running";
          const action = (kind: "start" | "stop" | "restart") => {
            const key = `${c.id}:${kind}`;
            if (kind !== "start" && asking !== key) {
              setAsking(key);
              return;
            }
            setAsking(null);
            run({ cmd: "container", id: c.id, action: kind });
          };
          return (
            <li key={c.id || c.name} className={styles.item}>
              <span
                className={styles.dot}
                style={{
                  background: running ? "rgb(var(--md-primary))" : "rgb(var(--md-outline))",
                }}
                aria-label={c.state}
              />
              <span className={styles.name}>
                {c.name}
                {shown.has("image") ? <span className={styles.meta}> · {c.image}</span> : null}
                {shown.has("project") && c.project ? (
                  <span className={styles.meta}> · {c.project}</span>
                ) : null}
                {shown.has("status") ? <span className={styles.meta}> · {c.status}</span> : null}
              </span>
              <span className={styles.values}>
                {shown.has("cpu") && running && c.cpu !== null ? (
                  <span>{percent(c.cpu, content.decimals)}</span>
                ) : null}
                {shown.has("memory") && running && c.mem !== null ? (
                  <span>{bytes(c.mem, unit, 0)}</span>
                ) : null}
                {content.opt<boolean>("controls") ? (
                  running ? (
                    <>
                      <button
                        type="button"
                        className={`${styles.rowButton} ${asking === `${c.id}:restart` ? styles.asking : ""}`}
                        aria-label={`Restart ${c.name}`}
                        onBlur={() => {
                          setAsking(null);
                        }}
                        onClick={() => {
                          action("restart");
                        }}
                      >
                        {asking === `${c.id}:restart` ? (
                          "Restart?"
                        ) : (
                          <Icon name="restart_alt" size={14} />
                        )}
                      </button>
                      <button
                        type="button"
                        className={`${styles.rowButton} ${asking === `${c.id}:stop` ? styles.asking : ""}`}
                        aria-label={`Stop ${c.name}`}
                        onBlur={() => {
                          setAsking(null);
                        }}
                        onClick={() => {
                          action("stop");
                        }}
                      >
                        {asking === `${c.id}:stop` ? "Stop?" : <Icon name="stop" size={14} />}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={styles.rowButton}
                      aria-label={`Start ${c.name}`}
                      onClick={() => {
                        action("start");
                      }}
                    >
                      <Icon name="play_arrow" size={14} />
                    </button>
                  )
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {all.length > list.length ? (
        <div className={styles.meta}>+{all.length - list.length} more</div>
      ) : null}
      {error ? (
        <div className={styles.meta} role="status">
          {error}
        </div>
      ) : null}
    </>
  );
}

const part = (
  id: string,
  label: string,
  icon: "deployed_code" | "stacks" | "info" | "speed" | "memory",
) => ({ id, label, icon, topics: [] as string[], hero: false, read: () => ({ text: "" }) });

export const docker: WidgetDef = {
  kind: "docker",
  name: "Docker",
  icon: "deployed_code",
  category: "system",
  sizes: ["4x1", "S", "M", "L", "XL"],
  defaultSize: "M",
  topics: [STATE, CONTAINERS],
  defaultFields: ["image", "cpu", "memory"],
  fields: [
    part("image", "Image", "deployed_code"),
    part("project", "Compose project", "stacks"),
    part("status", "Status text", "info"),
    part("cpu", "CPU", "speed"),
    part("memory", "Memory", "memory"),
  ],
  options: [
    { kind: "bool", key: "showStopped", label: "Show stopped containers", default: true },
    { kind: "bool", key: "groupByProject", label: "Group by Compose project", default: true },
    {
      kind: "bool",
      key: "controls",
      label: "Start / stop buttons",
      help: "Stop and restart ask first.",
      default: true,
    },
    BYTE_UNIT,
  ],
  status(c): CardStatus {
    const s = c.get(STATE);
    if (s === undefined) return { kind: "loading" };
    const status = text(map(s)?.status);
    if (status === "not-installed")
      return { kind: "unavailable", reason: "Docker or Podman isn't installed" };
    if (status === "permission-denied")
      return { kind: "needs-permission", reason: "No access to the Docker socket (docker group)" };
    if (status === "unreachable") return { kind: "unavailable", reason: "Docker isn't responding" };
    return { kind: "ready" };
  },
  render: (ctx) => <DockerList ctx={ctx} />,
  composition: dockerComposition,
  useClassicStat: true,
  compositionTopics(values, content) {
    const shown = new Set(content.fields);
    return {
      ...values,
      dkMeta: {
        kind: "map",
        v: {
          decimals: { kind: "num", v: content.decimals },
          showImage: { kind: "bool", v: shown.has("image") },
          showCpu: { kind: "bool", v: shown.has("cpu") },
          showMemory: { kind: "bool", v: shown.has("memory") },
          showStatus: { kind: "bool", v: shown.has("status") },
        },
      },
    };
  },
};
