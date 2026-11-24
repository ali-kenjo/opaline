// Secondary sections of Settings: Alerts, Backup, Diagnostics, About & Updates.
import { useEffect, useRef, useState } from "react";
import { Button, Sparkline, Switch } from "../design-system/components";
import { Icon } from "../design-system/icons";
import {
  type AlertRule,
  type LiveDiagnostics,
  type ShellState,
  checkUpdates,
  exportBackup,
  getDiagnostics,
  importBackup,
  installUpdate,
  patchSettings,
  resetSettings,
  setAutostart,
  triggerAction,
} from "../shell/api";
import styles from "./Settings.module.css";

interface SectionProps {
  state: ShellState;
  refresh: () => Promise<void>;
  notify: (msg: string) => void;
}

const DEFAULT_ALERTS: AlertRule[] = [
  {
    id: "cpu-hot",
    series: "cpu.temp",
    comparator: "above",
    threshold: 95,
    clear: 85,
    forS: 30,
    cooldownS: 900,
    enabled: true,
  },
  {
    id: "battery-low",
    series: "power.batteryPercent",
    comparator: "below",
    threshold: 10,
    clear: 15,
    forS: 0,
    cooldownS: 1800,
    enabled: true,
  },
];

export function AlertsSection({ state, refresh, notify }: SectionProps) {
  const rules = state.settings.alerts;

  const saveRules = async (next: AlertRule[]) => {
    try {
      await patchSettings({ alerts: next });
      await refresh();
    } catch (e) {
      notify(`Could not save alerts: ${String(e)}`);
    }
  };

  const updateRule = (idx: number, patch: Partial<AlertRule>) => {
    const next = rules.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    void saveRules(next);
  };

  return (
    <>
      <div className={styles.card}>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <h2 className={styles.cardTitle}>Sensor alerts</h2>
            <p className={styles.cardDesc}>
              Rules use hysteresis and cooldowns so notifications never spam. Clicking Open jumps to
              the widget&apos;s detail view; Snooze mutes that rule for 1 hour.
            </p>
          </div>
          <div className={styles.inlineRow}>
            <Button
              variant="tonal"
              icon="notifications"
              onClick={() => {
                triggerAction("test-alert")
                  .then(() => {
                    notify("Test notification sent");
                  })
                  .catch((e: unknown) => {
                    notify(`Notification failed: ${String(e)}`);
                  });
              }}
            >
              Send test
            </Button>
            <Button
              variant="text"
              icon="restart_alt"
              onClick={() => {
                void saveRules(DEFAULT_ALERTS);
                notify("Alert rules reset to defaults");
              }}
            >
              Reset defaults
            </Button>
          </div>
        </div>

        {rules.map((rule, idx) => (
          <div key={rule.id} className={styles.presetCard}>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.rowLabel}>
                  <code>{rule.series}</code> {rule.comparator === "above" ? "≥" : "≤"}{" "}
                  {rule.threshold}
                </span>
                <span className={styles.rowHint}>
                  ID: {rule.id} · Hold {rule.forS} s · Cooldown {Math.round(rule.cooldownS / 60)}{" "}
                  min
                </span>
              </div>
              <Switch
                checked={rule.enabled}
                label={`Enable ${rule.id}`}
                onChange={(v) => {
                  updateRule(idx, { enabled: v });
                }}
              />
            </div>
            <div className={styles.inlineRow}>
              <label className={styles.inlineRow}>
                <span className={styles.rowHint}>Threshold</span>
                <input
                  className={styles.input}
                  type="number"
                  style={{ width: 84 }}
                  value={rule.threshold}
                  onChange={(e) => {
                    const num = Number(e.target.value);
                    if (Number.isFinite(num)) updateRule(idx, { threshold: num });
                  }}
                />
              </label>
              <label className={styles.inlineRow}>
                <span className={styles.rowHint}>Duration (s)</span>
                <input
                  className={styles.input}
                  type="number"
                  min={0}
                  style={{ width: 80 }}
                  value={rule.forS}
                  onChange={(e) => {
                    const num = Math.max(0, Math.round(Number(e.target.value)));
                    if (Number.isFinite(num)) updateRule(idx, { forS: num });
                  }}
                />
              </label>
              <label className={styles.inlineRow}>
                <span className={styles.rowHint}>Cooldown (s)</span>
                <input
                  className={styles.input}
                  type="number"
                  min={60}
                  style={{ width: 92 }}
                  value={rule.cooldownS}
                  onChange={(e) => {
                    const num = Math.max(60, Math.round(Number(e.target.value)));
                    if (Number.isFinite(num)) updateRule(idx, { cooldownS: num });
                  }}
                />
              </label>
              <Button
                variant="text"
                icon="delete"
                onClick={() => {
                  void saveRules(rules.filter((_, i) => i !== idx));
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function BackupSection({ refresh, notify }: SectionProps) {
  const [importText, setImportText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleDownload = async () => {
    try {
      const json = await exportBackup();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `opaline-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      notify("Backup exported");
    } catch (e) {
      notify(`Export failed: ${String(e)}`);
    }
  };

  const handleCopy = async () => {
    try {
      const json = await exportBackup();
      await navigator.clipboard.writeText(json);
      notify("Backup JSON copied to clipboard");
    } catch (e) {
      notify(`Copy failed: ${String(e)}`);
    }
  };

  const handleImport = async (raw: string) => {
    if (!raw.trim()) return;
    try {
      await importBackup(raw);
      await refresh();
      setImportText("");
      notify("Backup imported and applied");
    } catch (e) {
      notify(`Import rejected: ${String(e)}`);
    }
  };

  return (
    <>
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Export settings & layouts</h2>
        <p className={styles.cardDesc}>
          Saves all widget styles, per-monitor layouts, alert rules, and preferences into a single
          versioned JSON file.
        </p>
        <div className={styles.inlineRow}>
          <Button
            variant="filled"
            icon="download"
            onClick={() => {
              void handleDownload();
            }}
          >
            Download JSON
          </Button>
          <Button
            variant="tonal"
            icon="content_copy"
            onClick={() => {
              void handleCopy();
            }}
          >
            Copy to clipboard
          </Button>
        </div>
      </div>

      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Import backup</h2>
        <p className={styles.cardDesc}>
          Choose a previously exported JSON file or paste its contents below. Opaline validates the
          schema before replacing anything.
        </p>
        <div className={styles.inlineRow}>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              f.text()
                .then((t) => {
                  void handleImport(t);
                })
                .catch((err: unknown) => {
                  notify(`Could not read file: ${String(err)}`);
                });
              e.target.value = "";
            }}
          />
          <Button
            variant="tonal"
            icon="upload"
            onClick={() => {
              fileRef.current?.click();
            }}
          >
            Choose JSON file
          </Button>
        </div>
        <textarea
          className={styles.textarea}
          placeholder="Or paste exported Opaline JSON here…"
          value={importText}
          onChange={(e) => {
            setImportText(e.target.value);
          }}
        />
        <div className={styles.inlineRow}>
          <Button
            variant="filled"
            disabled={!importText.trim()}
            onClick={() => {
              void handleImport(importText);
            }}
          >
            Validate &amp; import
          </Button>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>Reset settings to defaults</span>
            <span className={styles.rowHint}>
              Restores default style, alerts, and preferences (keeps your monitor layouts).
            </span>
          </div>
          <Button
            variant="text"
            icon="restart_alt"
            onClick={() => {
              resetSettings()
                .then(async () => {
                  await refresh();
                  notify("Settings reset to defaults");
                })
                .catch((e: unknown) => {
                  notify(`Reset failed: ${String(e)}`);
                });
            }}
          >
            Reset
          </Button>
        </div>
      </div>
    </>
  );
}

export function DiagnosticsSection({ notify }: SectionProps) {
  const [diag, setDiag] = useState<LiveDiagnostics | null>(null);
  const [cpuHist, setCpuHist] = useState<number[]>([]);
  const [ramHist, setRamHist] = useState<number[]>([]);
  const prevCpu = useRef<{ proc: number; total: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = () => {
      getDiagnostics()
        .then((d) => {
          if (!alive) return;
          setDiag(d);
          setRamHist((h) => [...h.slice(-29), d.totalPssMb]);
          if (prevCpu.current) {
            const dp = Math.max(0, d.processCpuJiffies - prevCpu.current.proc);
            const dt = Math.max(1, d.totalCpuJiffies - prevCpu.current.total);
            const pct = Math.min(100, (dp / dt) * 100);
            setCpuHist((h) => [...h.slice(-29), Number(pct.toFixed(2))]);
          }
          prevCpu.current = { proc: d.processCpuJiffies, total: d.totalCpuJiffies };
        })
        .catch(() => undefined);
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const latestCpu = cpuHist[cpuHist.length - 1];

  return (
    <>
      <div className={styles.card}>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <h2 className={styles.cardTitle}>Live resource usage</h2>
            <p className={styles.cardDesc}>
              Measured across core, layer, and WebKit processes. Debug reports strip SSIDs, IPs,
              hostnames, and usernames.
            </p>
          </div>
          <Button
            variant="filled"
            icon="content_copy"
            disabled={!diag}
            onClick={() => {
              if (!diag) return;
              navigator.clipboard
                .writeText(diag.debugReportJson)
                .then(() => {
                  notify("Redacted debug report copied");
                })
                .catch((e: unknown) => {
                  notify(`Copy failed: ${String(e)}`);
                });
            }}
          >
            Copy debug report
          </Button>
        </div>

        <div className={styles.metricGrid}>
          <div className={styles.metricBox}>
            <span className={styles.rowHint}>Opaline CPU</span>
            <span className={styles.metricVal}>
              {latestCpu !== undefined ? `${latestCpu.toFixed(2)} %` : "—"}
            </span>
            {cpuHist.length > 1 ? (
              <Sparkline values={cpuHist} min={0} max={5} height={34} label="CPU history" />
            ) : null}
          </div>
          <div className={styles.metricBox}>
            <span className={styles.rowHint}>Total RAM (PSS)</span>
            <span className={styles.metricVal}>
              {diag ? `${diag.totalPssMb.toFixed(1)} MB` : "—"}
            </span>
            {ramHist.length > 1 ? (
              <Sparkline values={ramHist} min={0} max={360} height={34} label="RAM history" />
            ) : null}
          </div>
          <div className={styles.metricBox}>
            <span className={styles.rowHint}>Backend mode</span>
            <span className={styles.metricVal} style={{ fontSize: 19 }}>
              {diag ? (diag.backend === "native" ? "Native" : "Instant") : "—"}
            </span>
            <span className={styles.rowHint}>
              {diag?.helperApiVersion
                ? `Helper API v${String(diag.helperApiVersion)}`
                : "Helper inactive"}
            </span>
          </div>
          <div className={styles.metricBox}>
            <span className={styles.rowHint}>Processes</span>
            <span className={styles.metricVal}>{diag ? String(diag.processCount) : "—"}</span>
            <span className={styles.rowHint}>
              Core {diag ? `${diag.corePssMb.toFixed(1)} MB` : "—"}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Sensor providers</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Cost</th>
              <th>Last sample</th>
              <th>Health</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(diag?.providers ?? {}).map(([id, p]) => (
              <tr key={id}>
                <td>
                  <code>{id}</code>
                </td>
                <td>{p.cost ?? "—"}</td>
                <td>{p.sample_us !== null ? `${(p.sample_us / 1000).toFixed(2)} ms` : "idle"}</td>
                <td>{typeof p.health === "string" ? p.health : JSON.stringify(p.health)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Recent logs</h2>
        <pre className={styles.logs}>
          {diag && diag.recentLogs.length > 0
            ? diag.recentLogs.join("\n")
            : "No log entries found yet."}
        </pre>
      </div>
    </>
  );
}

export function AboutSection({ state, refresh, notify }: SectionProps) {
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [update, setUpdate] = useState(state.latestUpdate);

  const handleCheck = async () => {
    setChecking(true);
    try {
      const info = await checkUpdates();
      setUpdate(info);
      notify(
        info.updateAvailable
          ? `Update available: v${info.latestVersion}`
          : `You're on the latest version (v${info.currentVersion})`,
      );
    } catch (e) {
      notify(`Update check failed: ${String(e)}`);
    } finally {
      setChecking(false);
    }
  };

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await installUpdate();
      notify("Update verified and installed — restart Opaline to apply");
    } catch (e) {
      notify(`Install failed: ${String(e)}`);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <>
      <div className={styles.card}>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <h2 className={styles.cardTitle}>Opaline {state.version}</h2>
            <p className={styles.cardDesc}>
              Glass widgets for your Ubuntu desktop. Licensed under GPL-3.0-or-later. Source:
              github.com/ali-kenjo/opaline
            </p>
          </div>
          <span className={styles.statusBadge}>
            <Icon name="widgets" size={16} />v{state.version}
          </span>
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>Start Opaline automatically on login</span>
            <span className={styles.rowHint}>
              Writes ~/.config/autostart/io.github.ali_kenjo.Opaline.desktop
            </span>
          </div>
          <Switch
            checked={state.autostart}
            label="Autostart on login"
            onChange={(enabled) => {
              setAutostart(enabled)
                .then(async () => {
                  await refresh();
                  notify(enabled ? "Autostart enabled" : "Autostart disabled");
                })
                .catch((e: unknown) => {
                  notify(`Autostart failed: ${String(e)}`);
                });
            }}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>First-run setup wizard</span>
            <span className={styles.rowHint}>
              Re-open the welcome flow to pick a starter layout or review setup.
            </span>
          </div>
          <Button
            variant="tonal"
            icon="rocket_launch"
            onClick={() => {
              void triggerAction("open-onboarding");
            }}
          >
            Open welcome
          </Button>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <h2 className={styles.cardTitle}>Updates</h2>
            <p className={styles.cardDesc}>
              Checks GitHub Releases daily (opt-out in Privacy). Downloads are verified with SHA-256
              and a minisign signature before installing via pkexec.
            </p>
          </div>
          <Button
            variant="filled"
            icon="refresh"
            disabled={checking}
            onClick={() => {
              void handleCheck();
            }}
          >
            {checking ? "Checking…" : "Check for updates"}
          </Button>
        </div>

        {update ? (
          <div className={styles.presetCard}>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.rowLabel}>
                  {update.updateAvailable
                    ? `Opaline ${update.latestVersion} is available`
                    : `Up to date (v${update.currentVersion})`}
                </span>
                <span className={styles.rowHint}>
                  Checked {new Date(update.checkedAt).toLocaleString()}
                </span>
              </div>
              {update.updateAvailable && update.debUrl ? (
                <Button
                  variant="filled"
                  icon="download"
                  disabled={installing}
                  onClick={() => {
                    void handleInstall();
                  }}
                >
                  {installing ? "Verifying & installing…" : "Download & install"}
                </Button>
              ) : null}
            </div>
            {update.notes ? (
              <pre className={styles.logs} style={{ maxHeight: 140 }}>
                {update.notes}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
