// Developer & Online widgets (brief §8.5, PLAN-2 7.5):
// GitHub, Home Assistant, MQTT, Feeds (RSS/Atom/JSON Feed — plain text only), and n8n.
// Every network request goes through core; tokens live exclusively in GNOME Keyring.
import { useState } from "react";
import { Icon } from "../design-system/icons";
import { useHost } from "./host";
import { toJson } from "./json";
import styles from "./p7Widgets.module.css";
import type { RenderCtx, WidgetDef } from "./types";

/* ── 1. GitHub ──────────────────────────────────────────────────────────────────────── */
interface GhSummary {
  notifications?: number;
  prs?: { title: string; repo?: string; state?: string }[];
  actions?: { name: string; conclusion?: string }[];
}

function GitHubBody({ ctx }: { ctx: RenderCtx }) {
  const sourceTopic = ctx.content.opt<string>("sourceTopic") || "source.github";
  const raw = toJson(ctx.get(sourceTopic));
  const data = (
    typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : null
  ) as GhSummary | null;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>
          <Icon name="deployed_code" size={16} /> {ctx.content.title || "GitHub"}
        </span>
        <span className={styles.badge}>
          {data?.notifications !== undefined ? `${String(data.notifications)} unread` : "Opt-in"}
        </span>
      </div>
      {!data ? (
        <span className={styles.sub}>
          Connect via Settings → Data sources (topic <code>{sourceTopic}</code> + keyring PAT).
        </span>
      ) : (
        <ul className={styles.list}>
          {(data.prs ?? []).slice(0, 5).map((pr, idx) => (
            <li key={idx} className={styles.listItem}>
              <span className={styles.itemText}>{pr.title}</span>
              {pr.state ? <span className={styles.badge}>{pr.state}</span> : null}
            </li>
          ))}
          {(data.actions ?? []).slice(0, 3).map((act, idx) => (
            <li key={`a-${String(idx)}`} className={styles.listItem}>
              <span className={styles.itemText}>{act.name}</span>
              <span className={styles.sub}>{act.conclusion ?? "running"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const githubWidget: WidgetDef = {
  kind: "github",
  name: "GitHub",
  icon: "deployed_code",
  category: "info",
  sizes: ["S", "M", "L"],
  defaultSize: "M",
  topics: [],
  extraTopics: (ctx) => [ctx.content.opt<string>("sourceTopic") || "source.github"],
  fields: [],
  defaultFields: [],
  options: [
    {
      kind: "text",
      key: "sourceTopic",
      label: "Data source topic",
      default: "source.github",
      maxLength: 64,
    },
  ],
  status: () => ({ kind: "ready" }),
  render: (ctx) => <GitHubBody ctx={ctx} />,
};

/* ── 2. Home Assistant ──────────────────────────────────────────────────────────────── */
interface HaEntity {
  entity_id: string;
  state: string;
  attributes?: { friendly_name?: string };
}

function HomeAssistantBody({ ctx }: { ctx: RenderCtx }) {
  const host = useHost();
  const sourceTopic = ctx.content.opt<string>("sourceTopic") || "source.home_assistant";
  const baseUrl = ctx.content.opt<string>("baseUrl") || "http://homeassistant.local:8123";
  const secretName = ctx.content.opt<string>("secretName") || "ha_token";
  const raw = toJson(ctx.get(sourceTopic));
  const entities = (Array.isArray(raw) ? raw : []) as unknown as HaEntity[];

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>
          <Icon name="bolt" size={16} /> {ctx.content.title || "Home Assistant"}
        </span>
        <span className={styles.badge}>{entities.length} entities</span>
      </div>
      {entities.length === 0 ? (
        <span className={styles.sub}>
          Configure an HTTP source publishing to <code>{sourceTopic}</code> + keyring token{" "}
          <code>{secretName}</code>.
        </span>
      ) : (
        <ul className={styles.list}>
          {entities.slice(0, 6).map((ent) => {
            const on = ent.state === "on";
            const label = ent.attributes?.friendly_name ?? ent.entity_id;
            return (
              <li key={ent.entity_id} className={styles.listItem}>
                <span className={styles.itemText}>{label}</span>
                <button
                  type="button"
                  data-interactive="true"
                  aria-pressed={on}
                  aria-label={`Toggle ${label}`}
                  className={`${styles.iconBtn} ${on ? styles.iconBtnPrimary : ""}`}
                  onClick={() => {
                    void host
                      .command({
                        cmd: "ha-toggle-entity",
                        base_url: baseUrl,
                        entity_id: ent.entity_id,
                        secret_name: secretName,
                        allow_local_http: baseUrl.startsWith("http://"),
                      })
                      .then(() => host.command({ cmd: "release-focus" }));
                  }}
                >
                  {ent.state}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export const homeAssistantWidget: WidgetDef = {
  kind: "home-assistant",
  name: "Home Assistant",
  icon: "bolt",
  category: "info",
  sizes: ["S", "M", "L"],
  defaultSize: "M",
  topics: [],
  extraTopics: (ctx) => [ctx.content.opt<string>("sourceTopic") || "source.home_assistant"],
  fields: [],
  defaultFields: [],
  options: [
    {
      kind: "text",
      key: "sourceTopic",
      label: "Data source topic",
      default: "source.home_assistant",
      maxLength: 64,
    },
    {
      kind: "text",
      key: "baseUrl",
      label: "Base URL",
      default: "http://homeassistant.local:8123",
      maxLength: 120,
    },
    {
      kind: "text",
      key: "secretName",
      label: "Keyring token name",
      default: "ha_token",
      maxLength: 64,
    },
  ],
  status: () => ({ kind: "ready" }),
  render: (ctx) => <HomeAssistantBody ctx={ctx} />,
};

/* ── 3. MQTT Topic Widget ───────────────────────────────────────────────────────────── */
function MqttBody({ ctx }: { ctx: RenderCtx }) {
  const sourceTopic = ctx.content.opt<string>("sourceTopic") || "source.mqtt";
  const unit = ctx.content.opt<string>("unit");
  const raw = toJson(ctx.get(sourceTopic));
  const formatted =
    raw === null
      ? "—"
      : typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean"
        ? String(raw)
        : JSON.stringify(raw);

  return (
    <div className={styles.wrap} style={{ justifyContent: "space-between" }}>
      <div className={styles.header}>
        <span className={styles.title}>
          <Icon name="device_hub" size={16} /> {ctx.content.title || "MQTT"}
        </span>
        <span className={styles.badge}>{sourceTopic}</span>
      </div>
      <div className={styles.heroNum}>
        {formatted}
        {unit && formatted !== "—" ? (
          <span style={{ fontSize: "0.5em", marginLeft: 4 }}>{unit}</span>
        ) : null}
      </div>
    </div>
  );
}

export const mqttWidget: WidgetDef = {
  kind: "mqtt",
  name: "MQTT Topic",
  icon: "device_hub",
  category: "network",
  sizes: ["1x1", "2x1", "S", "M"],
  defaultSize: "S",
  topics: [],
  extraTopics: (ctx) => [ctx.content.opt<string>("sourceTopic") || "source.mqtt"],
  fields: [],
  defaultFields: [],
  options: [
    {
      kind: "text",
      key: "sourceTopic",
      label: "MQTT source topic",
      default: "source.mqtt",
      maxLength: 64,
    },
    { kind: "text", key: "unit", label: "Unit suffix", default: "", maxLength: 16 },
  ],
  status: () => ({ kind: "ready" }),
  render: (ctx) => <MqttBody ctx={ctx} />,
};

/* ── 4. Feeds (RSS / Atom / JSON Feed — plain text only) ────────────────────────────── */
interface FeedItem {
  title: string;
  url: string;
  date?: string;
}

interface FeedPayload {
  title?: string;
  items?: FeedItem[];
}

function FeedsBody({ ctx }: { ctx: RenderCtx }) {
  const host = useHost();
  const feedUrl = ctx.content.opt<string>("feedUrl").trim();
  const [loaded, setLoaded] = useState<FeedPayload | null>(null);
  const [readUrls, setReadUrls] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string | null>(null);

  const sourceTopic = ctx.content.opt<string>("sourceTopic").trim();
  const topicRaw = sourceTopic ? toJson(ctx.get(sourceTopic)) : null;
  const fromTopic = (
    typeof topicRaw === "object" && topicRaw !== null && !Array.isArray(topicRaw) ? topicRaw : null
  ) as FeedPayload | null;
  const feed = loaded ?? fromTopic;
  const items = feed?.items ?? [];

  const handleRefresh = () => {
    if (!feedUrl) return;
    setErr(null);
    void host.command({ cmd: "fetch-feed", url: feedUrl }).then((res) => {
      if (res.result === "data") {
        setLoaded(toJson(res.value) as unknown as FeedPayload);
      } else if (res.result === "err") {
        setErr(res.reason);
      }
      void host.command({ cmd: "release-focus" });
    });
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>
          <Icon name="public" size={16} /> {feed?.title ?? (ctx.content.title || "Feeds")}
        </span>
        {feedUrl ? (
          <button
            type="button"
            data-interactive="true"
            aria-label="Refresh feed"
            className={styles.iconBtn}
            onClick={handleRefresh}
          >
            Refresh
          </button>
        ) : null}
      </div>
      {err ? <span className={styles.sub}>{err}</span> : null}
      {items.length === 0 ? (
        <span className={styles.sub}>
          Set an RSS, Atom, or JSON Feed URL in Inspector → Content. Plain text only.
        </span>
      ) : (
        <ul className={styles.list}>
          {items.slice(0, 6).map((it, idx) => (
            <li key={idx} className={styles.listItem}>
              <button
                type="button"
                data-interactive="true"
                className={`${styles.itemText} ${readUrls[it.url] ? styles.doneText : ""}`}
                style={{
                  background: "none",
                  border: "none",
                  color: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                  padding: 0,
                }}
                onClick={() => {
                  setReadUrls((r) => ({ ...r, [it.url]: true }));
                  if (it.url) {
                    void host
                      .command({ cmd: "launch-target", kind: "url", target: it.url })
                      .then(() => host.command({ cmd: "release-focus" }));
                  }
                }}
              >
                {it.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const feedsWidget: WidgetDef = {
  kind: "feeds",
  name: "Feeds",
  icon: "public",
  category: "info",
  sizes: ["S", "M", "L"],
  defaultSize: "M",
  topics: [],
  extraTopics: (ctx) => {
    const t = ctx.content.opt<string>("sourceTopic").trim();
    return t ? [t] : [];
  },
  fields: [],
  defaultFields: [],
  options: [
    {
      kind: "text",
      key: "feedUrl",
      label: "Feed URL (RSS/Atom/JSON)",
      default: "",
      maxLength: 240,
    },
    { kind: "text", key: "sourceTopic", label: "Or data source topic", default: "", maxLength: 64 },
  ],
  status: () => ({ kind: "ready" }),
  render: (ctx) => <FeedsBody ctx={ctx} />,
};

/* ── 5. n8n Workflows ───────────────────────────────────────────────────────────────── */
interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
}

interface N8nPayload {
  data?: N8nWorkflow[];
  workflows?: N8nWorkflow[];
}

function N8nBody({ ctx }: { ctx: RenderCtx }) {
  const host = useHost();
  const sourceTopic = ctx.content.opt<string>("sourceTopic") || "source.n8n";
  const baseUrl = ctx.content.opt<string>("baseUrl") || "http://localhost:5678";
  const secretName = ctx.content.opt<string>("secretName") || "n8n_key";
  const raw = toJson(ctx.get(sourceTopic));
  const parsed = (
    typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}
  ) as N8nPayload;
  const workflows = parsed.workflows ?? parsed.data ?? [];

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>
          <Icon name="terminal" size={16} /> {ctx.content.title || "n8n"}
        </span>
        <span className={styles.badge}>
          {workflows.filter((w) => w.active).length}/{workflows.length} active
        </span>
      </div>
      {workflows.length === 0 ? (
        <span className={styles.sub}>
          Point a local HTTP source at <code>{baseUrl}/api/v1/workflows</code> with keyring key{" "}
          <code>{secretName}</code>.
        </span>
      ) : (
        <ul className={styles.list}>
          {workflows.slice(0, 6).map((wf) => (
            <li key={wf.id} className={styles.listItem}>
              <span className={styles.itemText}>{wf.name}</span>
              <button
                type="button"
                data-interactive="true"
                aria-pressed={wf.active}
                aria-label={`${wf.active ? "Deactivate" : "Activate"} ${wf.name}`}
                className={`${styles.iconBtn} ${wf.active ? styles.iconBtnPrimary : ""}`}
                onClick={() => {
                  void host
                    .command({
                      cmd: "n8n-set-workflow-active",
                      base_url: baseUrl,
                      workflow_id: wf.id,
                      active: !wf.active,
                      secret_name: secretName,
                      allow_local_http: baseUrl.startsWith("http://"),
                    })
                    .then(() => host.command({ cmd: "release-focus" }));
                }}
              >
                {wf.active ? "Active" : "Off"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const n8nWidget: WidgetDef = {
  kind: "n8n",
  name: "n8n Workflows",
  icon: "terminal",
  category: "info",
  sizes: ["S", "M", "L"],
  defaultSize: "M",
  topics: [],
  extraTopics: (ctx) => [ctx.content.opt<string>("sourceTopic") || "source.n8n"],
  fields: [],
  defaultFields: [],
  options: [
    {
      kind: "text",
      key: "sourceTopic",
      label: "Data source topic",
      default: "source.n8n",
      maxLength: 64,
    },
    {
      kind: "text",
      key: "baseUrl",
      label: "n8n URL",
      default: "http://localhost:5678",
      maxLength: 120,
    },
    {
      kind: "text",
      key: "secretName",
      label: "Keyring API key name",
      default: "n8n_key",
      maxLength: 64,
    },
  ],
  status: () => ({ kind: "ready" }),
  render: (ctx) => <N8nBody ctx={ctx} />,
};
