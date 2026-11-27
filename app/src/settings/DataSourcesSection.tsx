// Settings → Data sources (PLAN-2 6.1–6.4, 6.6, 6.8):
// Create/edit/delete custom sources (Command, File, HTTP/JSON, D-Bus, MQTT, Variable),
// live status badges, Run now, collapsible logs, and Trust approval for imported sources.
import { useCallback, useEffect, useState } from "react";
import { Button, Switch } from "../design-system/components";
import { Icon } from "../design-system/icons";
import {
  type OutputFormat,
  type SourceSpec,
  type SourcesCatalog,
  approveSource,
  deleteSource,
  listSources,
  revokeSource,
  runSourceNow,
  saveSource,
  setVariable,
} from "../shell/api";
import styles from "./Settings.module.css";

type DraftKind = "command" | "file" | "http" | "dbus" | "mqtt" | "variable";

const FORMATS: readonly { value: OutputFormat; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "lines", label: "Lines" },
  { value: "json", label: "JSON" },
  { value: "csv", label: "CSV" },
  { value: "regex", label: "Regex" },
  { value: "markdown", label: "Markdown" },
  { value: "todotxt", label: "todo.txt" },
];

export function DataSourcesSection({ notify }: { notify: (msg: string) => void }) {
  const [catalog, setCatalog] = useState<SourcesCatalog | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});
  const [runOutputs, setRunOutputs] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  // Create form state
  const [kind, setKind] = useState<DraftKind>("command");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [argvStr, setArgvStr] = useState("uptime -p");
  const [shellMode, setShellMode] = useState(false);
  const [intervalS, setIntervalS] = useState(30);
  const [format, setFormat] = useState<OutputFormat>("text");
  const [regexPat, setRegexPat] = useState("");
  const [filePath, setFilePath] = useState("~/notes/todo.md");
  const [httpUrl, setHttpUrl] = useState("https://api.github.com/zen");
  const [allowLocalHttp, setAllowLocalHttp] = useState(false);
  const [jsonPath, setJsonPath] = useState("");
  const [headerLine, setHeaderLine] = useState("");
  const [dbusBus, setDbusBus] = useState<"session" | "system">("session");
  const [dbusDest, setDbusDest] = useState("org.freedesktop.UPower");
  const [dbusPath, setDbusPath] = useState("/org/freedesktop/UPower");
  const [dbusIface, setDbusIface] = useState("org.freedesktop.UPower");
  const [dbusMember, setDbusMember] = useState("OnBattery");
  const [mqttHost, setMqttHost] = useState("127.0.0.1");
  const [mqttPort, setMqttPort] = useState(1883);
  const [mqttTls, setMqttTls] = useState(false);
  const [mqttTopic, setMqttTopic] = useState("home/#");
  const [mqttPassSecret, setMqttPassSecret] = useState("");
  const [varDefault, setVarDefault] = useState("ready");

  const reload = useCallback(async () => {
    try {
      const cat = await listSources();
      setCatalog(cat);
    } catch (e) {
      notify(`Could not load data sources: ${String(e)}`);
    }
  }, [notify]);

  useEffect(() => {
    let alive = true;
    listSources()
      .then((cat) => {
        if (alive) setCatalog(cat);
      })
      .catch((e: unknown) => {
        if (alive) notify(`Could not load data sources: ${String(e)}`);
      });
    return () => {
      alive = false;
    };
  }, [notify]);

  const handleCreate = async () => {
    const cleanId = id
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[^a-z0-9]+/, "");
    if (!cleanId || !name.trim()) {
      notify("Enter a valid source ID and name");
      return;
    }

    let spec: SourceSpec;
    const base = {
      version: 1,
      id: cleanId,
      name: name.trim(),
      enabled: true,
      origin: { type: "user" as const },
    };

    switch (kind) {
      case "command": {
        const argv = shellMode ? [argvStr.trim()] : argvStr.trim().split(/\s+/).filter(Boolean);
        spec = {
          ...base,
          kind: "command",
          argv,
          shell: shellMode,
          intervalS,
          timeoutMs: 5000,
          maxBytes: 262144,
          envAllowlist: [],
          format,
          ...(format === "regex" && regexPat.trim() ? { regex: regexPat.trim() } : {}),
        };
        break;
      }
      case "file":
        spec = {
          ...base,
          kind: "file",
          path: filePath.trim(),
          maxBytes: 262144,
          format,
          ...(jsonPath.trim() ? { jsonPath: jsonPath.trim() } : {}),
        };
        break;
      case "http": {
        const headers: Record<string, string> = {};
        if (headerLine.includes(":")) {
          const idx = headerLine.indexOf(":");
          const k = headerLine.slice(0, idx).trim();
          const v = headerLine.slice(idx + 1).trim();
          if (k && v) headers[k] = v;
        }
        spec = {
          ...base,
          kind: "http",
          url: httpUrl.trim(),
          allowLocalHttp,
          intervalS,
          timeoutMs: 5000,
          maxBytes: 262144,
          headers,
          format: format === "text" ? "json" : format,
          ...(jsonPath.trim() ? { jsonPath: jsonPath.trim() } : {}),
        };
        break;
      }
      case "dbus":
        spec = {
          ...base,
          kind: "dbus",
          bus: dbusBus,
          destination: dbusDest.trim(),
          path: dbusPath.trim(),
          interface: dbusIface.trim(),
          member: dbusMember.trim(),
          mode: "property",
          intervalS,
        };
        break;
      case "mqtt":
        spec = {
          ...base,
          kind: "mqtt",
          host: mqttHost.trim(),
          port: mqttPort,
          tls: mqttTls,
          topic: mqttTopic.trim(),
          format,
          ...(mqttPassSecret.trim() ? { passwordSecret: mqttPassSecret.trim() } : {}),
          ...(jsonPath.trim() ? { jsonPath: jsonPath.trim() } : {}),
        };
        break;
      case "variable":
        spec = {
          ...base,
          kind: "variable",
          persist: true,
          defaultValue: varDefault,
        };
        break;
    }

    try {
      await saveSource(spec);
      setCreating(false);
      setId("");
      setName("");
      await reload();
      notify(`Saved data source "${spec.name}"`);
    } catch (e) {
      notify(`Could not save source: ${String(e)}`);
    }
  };

  const statuses = catalog?.statuses ?? [];
  const needsApproval = statuses.filter((s) => s.state === "needs-approval");

  return (
    <div id="data-sources-list">
      {catalog?.safeMode ? (
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Safe mode active</h3>
          <p className={styles.cardDesc}>
            Custom data sources are paused because Opaline started with <code>--safe-mode</code>.
          </p>
        </div>
      ) : null}

      {needsApproval.length > 0 ? (
        <div className={styles.card} role="region" aria-label="Imported sources awaiting approval">
          <h3 className={styles.cardTitle}>
            <Icon name="warning" size={18} /> Imported sources awaiting approval
          </h3>
          <p className={styles.cardDesc}>
            Imported sources stay off until you review and approve their exact command, path, host,
            or D-Bus target. Any future change re-prompts for approval.
          </p>
          {needsApproval.map((st) => (
            <div key={st.id} className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowLabel}>
                  {st.name} (<code>{st.topic}</code>)
                </div>
                <div className={styles.rowHelp}>{st.trustSummary}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  variant="filled"
                  icon="check"
                  onClick={() => {
                    void approveSource(st.id)
                      .then(async () => {
                        await reload();
                        notify(`Approved "${st.name}"`);
                      })
                      .catch((e: unknown) => {
                        notify(`Approval failed: ${String(e)}`);
                      });
                  }}
                >
                  Approve
                </Button>
                <Button
                  variant="outlined"
                  icon="delete"
                  onClick={() => {
                    void deleteSource(st.id)
                      .then(async () => {
                        await reload();
                        notify(`Removed "${st.name}"`);
                      })
                      .catch((e: unknown) => {
                        notify(`Remove failed: ${String(e)}`);
                      });
                  }}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.card}>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <h3 className={styles.cardTitle}>Custom data sources</h3>
            <p className={styles.cardDesc}>
              Command, File, HTTP/JSON, D-Bus, MQTT, and Variable sources run in core and publish to{" "}
              <code>source.&lt;id&gt;</code> or <code>var.&lt;id&gt;</code> for custom widgets.
            </p>
          </div>
          <Button
            variant="filled"
            icon={creating ? "close" : "add"}
            onClick={() => {
              setCreating((c) => !c);
            }}
          >
            {creating ? "Cancel" : "Add data source"}
          </Button>
        </div>

        {creating ? (
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Source type</span>
              <select
                aria-label="Source type"
                className={styles.input}
                value={kind}
                onChange={(e) => {
                  const k = e.target.value as DraftKind;
                  setKind(k);
                  if (k === "http") setFormat("json");
                  else if (k === "file") setFormat("markdown");
                  else setFormat("text");
                }}
              >
                <option value="command">Command (argv / optional shell)</option>
                <option value="file">File (inotify watch)</option>
                <option value="http">HTTP / JSON (HTTPS + optional local HTTP)</option>
                <option value="dbus">D-Bus (session / allowlisted system)</option>
                <option value="mqtt">MQTT topic (TLS + keyring auth)</option>
                <option value="variable">Variable (push via CLI / D-Bus)</option>
              </select>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Source ID</span>
              <input
                aria-label="Source ID"
                className={styles.input}
                placeholder="e.g. n8n-workflows"
                value={id}
                onChange={(e) => {
                  setId(e.target.value);
                }}
              />
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Display name</span>
              <input
                aria-label="Source display name"
                className={styles.input}
                placeholder="e.g. n8n Workflows"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
            </div>

            {kind === "command" ? (
              <>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Command (argv)</span>
                  <input
                    aria-label="Command argv"
                    className={styles.input}
                    value={argvStr}
                    onChange={(e) => {
                      setArgvStr(e.target.value);
                    }}
                  />
                </div>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Run in shell (/bin/sh -c)</span>
                  <Switch label="Run in shell" checked={shellMode} onChange={setShellMode} />
                </div>
              </>
            ) : null}

            {kind === "file" ? (
              <div className={styles.row}>
                <span className={styles.rowLabel}>File path</span>
                <input
                  aria-label="File path"
                  className={styles.input}
                  value={filePath}
                  onChange={(e) => {
                    setFilePath(e.target.value);
                  }}
                />
              </div>
            ) : null}

            {kind === "http" ? (
              <>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>URL</span>
                  <input
                    aria-label="HTTP URL"
                    className={styles.input}
                    value={httpUrl}
                    onChange={(e) => {
                      setHttpUrl(e.target.value);
                    }}
                  />
                </div>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>
                    Allow plain HTTP for loopback / private LAN (e.g. local n8n)
                  </span>
                  <Switch
                    label="Allow local HTTP"
                    checked={allowLocalHttp}
                    onChange={setAllowLocalHttp}
                  />
                </div>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>
                    Header (use <code>{"{{secret:name}}"}</code> for API keys)
                  </span>
                  <input
                    aria-label="HTTP header"
                    className={styles.input}
                    placeholder="X-N8N-API-KEY: {{secret:n8n_key}}"
                    value={headerLine}
                    onChange={(e) => {
                      setHeaderLine(e.target.value);
                    }}
                  />
                </div>
              </>
            ) : null}

            {kind === "dbus" ? (
              <>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Bus</span>
                  <select
                    aria-label="D-Bus bus"
                    className={styles.input}
                    value={dbusBus}
                    onChange={(e) => {
                      setDbusBus(e.target.value as "session" | "system");
                    }}
                  >
                    <option value="session">Session bus</option>
                    <option value="system">System bus (read-only allowlist)</option>
                  </select>
                </div>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Destination</span>
                  <input
                    aria-label="D-Bus destination"
                    className={styles.input}
                    value={dbusDest}
                    onChange={(e) => {
                      setDbusDest(e.target.value);
                    }}
                  />
                </div>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Object path</span>
                  <input
                    aria-label="D-Bus path"
                    className={styles.input}
                    value={dbusPath}
                    onChange={(e) => {
                      setDbusPath(e.target.value);
                    }}
                  />
                </div>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Interface</span>
                  <input
                    aria-label="D-Bus interface"
                    className={styles.input}
                    value={dbusIface}
                    onChange={(e) => {
                      setDbusIface(e.target.value);
                    }}
                  />
                </div>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Property name</span>
                  <input
                    aria-label="D-Bus property"
                    className={styles.input}
                    value={dbusMember}
                    onChange={(e) => {
                      setDbusMember(e.target.value);
                    }}
                  />
                </div>
              </>
            ) : null}

            {kind === "mqtt" ? (
              <>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Broker host</span>
                  <input
                    aria-label="MQTT host"
                    className={styles.input}
                    value={mqttHost}
                    onChange={(e) => {
                      setMqttHost(e.target.value);
                    }}
                  />
                </div>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Port &amp; TLS</span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      aria-label="MQTT port"
                      type="number"
                      className={styles.input}
                      style={{ width: 90 }}
                      value={mqttPort}
                      onChange={(e) => {
                        setMqttPort(Number(e.target.value) || 1883);
                      }}
                    />
                    <Switch label="Use TLS" checked={mqttTls} onChange={setMqttTls} />
                  </div>
                </div>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>MQTT topic filter</span>
                  <input
                    aria-label="MQTT topic"
                    className={styles.input}
                    value={mqttTopic}
                    onChange={(e) => {
                      setMqttTopic(e.target.value);
                    }}
                  />
                </div>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Password secret name (optional)</span>
                  <input
                    aria-label="MQTT password secret"
                    className={styles.input}
                    placeholder="mqtt_pass"
                    value={mqttPassSecret}
                    onChange={(e) => {
                      setMqttPassSecret(e.target.value);
                    }}
                  />
                </div>
              </>
            ) : null}

            {kind === "variable" ? (
              <div className={styles.row}>
                <span className={styles.rowLabel}>Default value</span>
                <input
                  aria-label="Variable default value"
                  className={styles.input}
                  value={varDefault}
                  onChange={(e) => {
                    setVarDefault(e.target.value);
                  }}
                />
              </div>
            ) : null}

            {kind === "command" || kind === "http" || kind === "dbus" ? (
              <div className={styles.row}>
                <span className={styles.rowLabel}>Interval (seconds)</span>
                <input
                  aria-label="Interval seconds"
                  type="number"
                  min={1}
                  max={86400}
                  className={styles.input}
                  style={{ width: 100 }}
                  value={intervalS}
                  onChange={(e) => {
                    setIntervalS(Math.max(1, Number(e.target.value) || 30));
                  }}
                />
              </div>
            ) : null}

            {kind === "command" || kind === "file" || kind === "http" || kind === "mqtt" ? (
              <div className={styles.row}>
                <span className={styles.rowLabel}>Parser format</span>
                <select
                  aria-label="Parser format"
                  className={styles.input}
                  value={format}
                  onChange={(e) => {
                    setFormat(e.target.value as OutputFormat);
                  }}
                >
                  {FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {kind === "command" && format === "regex" ? (
              <div className={styles.row}>
                <span className={styles.rowLabel}>Regex pattern</span>
                <input
                  aria-label="Regex pattern"
                  className={styles.input}
                  placeholder="(?P<value>[0-9.]+)"
                  value={regexPat}
                  onChange={(e) => {
                    setRegexPat(e.target.value);
                  }}
                />
              </div>
            ) : null}

            {(kind === "http" || kind === "file" || kind === "mqtt") && format === "json" ? (
              <div className={styles.row}>
                <span className={styles.rowLabel}>JSONPath (optional, RFC 9535)</span>
                <input
                  aria-label="JSONPath selector"
                  className={styles.input}
                  placeholder="$.data[*].name"
                  value={jsonPath}
                  onChange={(e) => {
                    setJsonPath(e.target.value);
                  }}
                />
              </div>
            ) : null}

            <div>
              <Button
                variant="filled"
                icon="check"
                onClick={() => {
                  void handleCreate();
                }}
              >
                Save source
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {statuses.length === 0 ? (
        <div className={styles.card}>
          <p className={styles.cardDesc}>
            No custom data sources configured yet. Click &ldquo;Add data source&rdquo; above or drop
            JSON files into <code>~/.config/opaline/sources/</code>.
          </p>
        </div>
      ) : (
        statuses.map((st) => (
          <div key={st.id} className={styles.card}>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowLabel}>
                  {st.name} · <code>{st.topic}</code> ({st.kind})
                </div>
                <div className={styles.rowHelp}>
                  Status: <strong>{st.state}</strong>
                  {st.lastDurationUs !== null
                    ? ` · ${(st.lastDurationUs / 1000).toFixed(1)} ms`
                    : ""}
                  {st.runCount > 0 ? ` · ${String(st.runCount)} runs` : ""}
                  {st.error ? ` · Error: ${st.error}` : ""}
                </div>
                <div className={styles.rowHelp}>{st.trustSummary}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Button
                  variant="tonal"
                  icon="play_arrow"
                  disabled={st.state === "needs-approval"}
                  onClick={() => {
                    void runSourceNow(st.id)
                      .then(async (val) => {
                        setRunOutputs((prev) => ({ ...prev, [st.id]: JSON.stringify(val) }));
                        await reload();
                        notify(`Ran "${st.name}"`);
                      })
                      .catch((e: unknown) => {
                        notify(`Run failed: ${String(e)}`);
                      });
                  }}
                >
                  Run now
                </Button>
                {st.kind === "variable" ? (
                  <Button
                    variant="outlined"
                    icon="edit"
                    onClick={() => {
                      const nextVal = `updated-${String(Date.now()).slice(-4)}`;
                      void setVariable(st.id, nextVal)
                        .then(async () => {
                          setRunOutputs((prev) => ({ ...prev, [st.id]: JSON.stringify(nextVal) }));
                          await reload();
                          notify(`Updated var.${st.id}`);
                        })
                        .catch((e: unknown) => {
                          notify(`Variable update failed: ${String(e)}`);
                        });
                    }}
                  >
                    Bump value
                  </Button>
                ) : null}
                {st.origin.type === "imported" && st.state !== "needs-approval" ? (
                  <Button
                    variant="outlined"
                    icon="lock"
                    onClick={() => {
                      void revokeSource(st.id).then(reload);
                    }}
                  >
                    Revoke trust
                  </Button>
                ) : null}
                <Button
                  variant="text"
                  onClick={() => {
                    setExpandedLogs((p) => ({ ...p, [st.id]: !p[st.id] }));
                  }}
                >
                  {expandedLogs[st.id] ? "Hide log" : `Log (${String(st.logs.length)})`}
                </Button>
                <Button
                  variant="text"
                  icon="delete"
                  aria-label={`Delete source ${st.name}`}
                  onClick={() => {
                    void deleteSource(st.id)
                      .then(async () => {
                        await reload();
                        notify(`Deleted "${st.name}"`);
                      })
                      .catch((e: unknown) => {
                        notify(`Delete failed: ${String(e)}`);
                      });
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>

            {runOutputs[st.id] ? (
              <pre
                style={{
                  margin: "8px 0 0",
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: "rgba(0,0,0,0.22)",
                  fontSize: "0.78rem",
                  overflowX: "auto",
                }}
              >
                {runOutputs[st.id]}
              </pre>
            ) : null}

            {expandedLogs[st.id] ? (
              <div style={{ marginTop: 8, fontSize: "0.78rem", opacity: 0.85 }}>
                {st.logs.length === 0
                  ? "No runs recorded yet."
                  : st.logs.map((entry, idx) => (
                      <div key={idx}>
                        [{entry.level}] {entry.message}
                      </div>
                    ))}
              </div>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}
