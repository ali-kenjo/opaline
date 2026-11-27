// Settings → Profiles & automation (PLAN-2 8.1, 8.2, 8.6):
// Named desktop profiles (snapshot/switch/delete), opaline-expr automation rules with
// hysteresis & minimum duration, live desktop context, and manual override + Resume automation.
import { useCallback, useEffect, useState } from "react";
import { Button, Switch } from "../design-system/components";
import { DESKTOP_LOOKS, type DesktopLook } from "../design-system/style";
import {
  type AutomationRule,
  type AutomationStatus,
  type ProfilesFile,
  type RuleAction,
  activateProfile,
  deleteAutomationRule,
  deleteProfile,
  getAutomation,
  listProfiles,
  resumeAutomation,
  saveAutomationRule,
  setAutomationEnabled,
  snapshotProfile,
} from "../shell/api";
import styles from "./Settings.module.css";

interface Props {
  notify: (msg: string) => void;
  refresh: () => Promise<void>;
}

const CONDITION_PRESETS: readonly { label: string; expr: string }[] = [
  { label: "Night hours", expr: "time.isNight" },
  { label: "On battery", expr: "power.onBattery" },
  { label: "Docked", expr: "desktop.docked" },
  { label: "Workspace 2", expr: "desktop.workspace == 1" },
  { label: "Fullscreen", expr: "desktop.fullscreen" },
  { label: "VS Code focused", expr: 'desktop.focusedApp == "code"' },
];

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function ProfilesSection({ notify, refresh }: Props) {
  const [profiles, setProfiles] = useState<ProfilesFile | null>(null);
  const [automation, setAutomation] = useState<AutomationStatus | null>(null);

  const [newProfileName, setNewProfileName] = useState("");
  const [ruleName, setRuleName] = useState("");
  const [ruleCond, setRuleCond] = useState("time.isNight");
  const [ruleActionType, setRuleActionType] = useState<RuleAction["type"]>("set-look");
  const [ruleProfileId, setRuleProfileId] = useState("");
  const [ruleLook, setRuleLook] = useState<DesktopLook>("dark");
  const [ruleTheme, setRuleTheme] = useState("mono");
  const [ruleMinS, setRuleMinS] = useState(3);
  const [ruleHystS, setRuleHystS] = useState(5);
  const [rulePriority, setRulePriority] = useState(10);

  const reload = useCallback(async () => {
    const [p, a] = await Promise.all([listProfiles(), getAutomation()]);
    setProfiles(p);
    setAutomation(a);
    setRuleProfileId((cur) => (cur ? cur : (p.profiles[0]?.id ?? "")));
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([listProfiles(), getAutomation()])
      .then(([p, a]) => {
        if (!alive) return;
        setProfiles(p);
        setAutomation(a);
        setRuleProfileId((cur) => (cur ? cur : (p.profiles[0]?.id ?? "")));
      })
      .catch((e: unknown) => {
        if (alive) notify(`Could not load profiles: ${String(e)}`);
      });
    return () => {
      alive = false;
    };
  }, [notify]);

  const handleSnapshot = () => {
    const name = newProfileName.trim();
    const id = slugify(name);
    if (!name || !id) {
      notify("Enter a profile name first");
      return;
    }
    void snapshotProfile(id, name)
      .then(async () => {
        setNewProfileName("");
        await reload();
        notify(`Saved profile "${name}"`);
      })
      .catch((e: unknown) => {
        notify(`Could not save profile: ${String(e)}`);
      });
  };

  const handleActivate = (id: string, name: string) => {
    void activateProfile(id)
      .then(async () => {
        await Promise.all([reload(), refresh()]);
        notify(`Activated profile "${name}"`);
      })
      .catch((e: unknown) => {
        notify(`Could not activate profile: ${String(e)}`);
      });
  };

  const handleDeleteProfile = (id: string) => {
    void deleteProfile(id)
      .then(async () => {
        await reload();
        notify(`Deleted profile "${id}"`);
      })
      .catch((e: unknown) => {
        notify(`Could not delete profile: ${String(e)}`);
      });
  };

  const handleAddRule = () => {
    const name = ruleName.trim();
    const id = slugify(name);
    if (!name || !id) {
      notify("Enter a rule name first");
      return;
    }
    let action: RuleAction;
    if (ruleActionType === "activate-profile") {
      if (!ruleProfileId) {
        notify("Create a profile first to use Activate profile");
        return;
      }
      action = { type: "activate-profile", profileId: ruleProfileId };
    } else if (ruleActionType === "set-theme") {
      action = { type: "set-theme", theme: ruleTheme.trim() || "opaline" };
    } else if (ruleActionType === "notify") {
      action = { type: "notify", title: name, body: `Rule triggered: ${ruleCond}` };
    } else {
      action = { type: "set-look", look: ruleLook };
    }
    const rule: AutomationRule = {
      id,
      name,
      enabled: true,
      priority: rulePriority,
      condition: ruleCond.trim(),
      minDurationS: Math.max(0, ruleMinS),
      hysteresisS: Math.max(0, ruleHystS),
      action,
    };
    void saveAutomationRule(rule)
      .then(async () => {
        setRuleName("");
        await reload();
        notify(`Saved automation rule "${name}"`);
      })
      .catch((e: unknown) => {
        notify(`Rule error: ${String(e)}`);
      });
  };

  return (
    <>
      <div id="profiles-list" className={styles.card}>
        <h2 className={styles.cardTitle}>Desktop profiles</h2>
        <p className={styles.cardDesc}>
          Snapshot your current layouts, theme, desktop look, appearance state, and performance mode
          into named profiles. Switching animates widgets directly into their new places.
        </p>

        <div className={styles.inlineRow}>
          <input
            aria-label="New profile name"
            className={styles.input}
            style={{ flex: 1, minWidth: 200 }}
            placeholder="Profile name (e.g. Work Desk, Night, Presenting)…"
            value={newProfileName}
            onChange={(e) => {
              setNewProfileName(e.target.value);
            }}
          />
          <Button variant="filled" icon="add" onClick={handleSnapshot}>
            Snapshot current
          </Button>
        </div>

        {profiles && profiles.profiles.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {profiles.profiles.map((p) => {
              const isActive = profiles.activeId === p.id;
              return (
                <div key={p.id} className={styles.row}>
                  <div className={styles.rowText}>
                    <span className={styles.rowLabel}>
                      {p.name} {isActive ? "(Active)" : ""}
                    </span>
                    <span className={styles.rowHint}>
                      id: {p.id} · theme: {p.theme ?? "keep"} · look: {p.look ?? "keep"}
                    </span>
                  </div>
                  <div className={styles.inlineRow}>
                    <Button
                      variant={isActive ? "tonal" : "filled"}
                      onClick={() => {
                        handleActivate(p.id, p.name);
                      }}
                    >
                      {isActive ? "Re-apply" : "Activate"}
                    </Button>
                    <Button
                      variant="text"
                      icon="delete"
                      onClick={() => {
                        handleDeleteProfile(p.id);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className={styles.rowHint} style={{ marginTop: 10 }}>
            No profiles saved yet. Snapshot your current desktop to create your first profile.
          </p>
        )}
      </div>

      <div id="automation-rules" className={styles.card}>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <h2 className={styles.cardTitle}>Automation rules</h2>
            <p className={styles.cardDesc}>
              Evaluated in core with Opaline expressions, minimum duration, and hysteresis so rules
              never flap.
            </p>
          </div>
          <Switch
            checked={automation?.enabled ?? true}
            label="Enable automation rules"
            onChange={(enabled) => {
              void setAutomationEnabled(enabled)
                .then(() => reload())
                .catch((e: unknown) => {
                  notify(`Could not toggle automation: ${String(e)}`);
                });
            }}
          />
        </div>

        {automation?.manualOverride ? (
          <div
            role="status"
            className={styles.row}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              background: "color-mix(in srgb, var(--md-primary, #7dc4ff) 16%, transparent)",
              marginBottom: 12,
            }}
          >
            <div className={styles.rowText}>
              <span className={styles.rowLabel}>Automation paused (manual override)</span>
              <span className={styles.rowHint}>
                {automation.manualOverrideReason ?? "You switched profile or look manually."}
              </span>
            </div>
            <Button
              variant="filled"
              icon="play_arrow"
              onClick={() => {
                void resumeAutomation()
                  .then(async () => {
                    await reload();
                    notify("Automation resumed");
                  })
                  .catch((e: unknown) => {
                    notify(`Could not resume: ${String(e)}`);
                  });
              }}
            >
              Resume automation
            </Button>
          </div>
        ) : null}

        {automation ? (
          <p className={styles.rowHint} style={{ marginBottom: 10 }}>
            Live context: Workspace {automation.context.workspace + 1} · Focused app:{" "}
            {automation.context.focusedApp || "Desktop"} · Monitors:{" "}
            {automation.context.monitorCount} ({automation.context.docked ? "Docked" : "Undocked"})
            {automation.context.fullscreen ? " · Fullscreen" : ""}
          </p>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className={styles.inlineRow}>
            <input
              aria-label="Rule name"
              className={styles.input}
              style={{ flex: 1, minWidth: 160 }}
              placeholder="Rule name (e.g. Night Dark Mode)"
              value={ruleName}
              onChange={(e) => {
                setRuleName(e.target.value);
              }}
            />
            <select
              aria-label="Rule action type"
              className={styles.input}
              value={ruleActionType}
              onChange={(e) => {
                setRuleActionType(e.target.value as RuleAction["type"]);
              }}
            >
              <option value="set-look">Set desktop look</option>
              <option value="activate-profile">Activate profile</option>
              <option value="set-theme">Set theme</option>
              <option value="notify">Send notification</option>
            </select>
            {ruleActionType === "set-look" ? (
              <select
                aria-label="Target look"
                className={styles.input}
                value={ruleLook}
                onChange={(e) => {
                  setRuleLook(e.target.value as DesktopLook);
                }}
              >
                {DESKTOP_LOOKS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            ) : null}
            {ruleActionType === "activate-profile" ? (
              <select
                aria-label="Target profile"
                className={styles.input}
                value={ruleProfileId}
                onChange={(e) => {
                  setRuleProfileId(e.target.value);
                }}
              >
                {(profiles?.profiles ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : null}
            {ruleActionType === "set-theme" ? (
              <input
                aria-label="Target theme"
                className={styles.input}
                style={{ width: 120 }}
                value={ruleTheme}
                onChange={(e) => {
                  setRuleTheme(e.target.value);
                }}
              />
            ) : null}
          </div>

          <input
            aria-label="Rule expression condition"
            className={styles.input}
            placeholder="Condition (e.g. power.onBattery && desktop.workspace == 1)"
            value={ruleCond}
            onChange={(e) => {
              setRuleCond(e.target.value);
            }}
          />

          <div className={styles.inlineRow} style={{ flexWrap: "wrap", gap: 6 }}>
            {CONDITION_PRESETS.map((preset) => (
              <Button
                key={preset.label}
                variant="text"
                onClick={() => {
                  setRuleCond(preset.expr);
                }}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          <div className={styles.inlineRow}>
            <label className={styles.rowHint}>
              Min duration (s):{" "}
              <input
                aria-label="Minimum duration seconds"
                className={styles.input}
                type="number"
                min={0}
                max={3600}
                style={{ width: 68 }}
                value={ruleMinS}
                onChange={(e) => {
                  setRuleMinS(Number(e.target.value));
                }}
              />
            </label>
            <label className={styles.rowHint}>
              Hysteresis (s):{" "}
              <input
                aria-label="Hysteresis seconds"
                className={styles.input}
                type="number"
                min={0}
                max={3600}
                style={{ width: 68 }}
                value={ruleHystS}
                onChange={(e) => {
                  setRuleHystS(Number(e.target.value));
                }}
              />
            </label>
            <label className={styles.rowHint}>
              Priority:{" "}
              <input
                aria-label="Rule priority"
                className={styles.input}
                type="number"
                min={-100}
                max={100}
                style={{ width: 64 }}
                value={rulePriority}
                onChange={(e) => {
                  setRulePriority(Number(e.target.value));
                }}
              />
            </label>
            <Button variant="filled" icon="add" onClick={handleAddRule}>
              Add rule
            </Button>
          </div>
        </div>

        {automation && automation.rules.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
            {automation.rules.map((r) => {
              const rt = automation.runtime[r.id];
              return (
                <div key={r.id} className={styles.row}>
                  <div className={styles.rowText}>
                    <span className={styles.rowLabel}>
                      {r.name} {rt?.active ? "(Active)" : ""}
                    </span>
                    <span className={styles.rowHint}>
                      when <code>{r.condition}</code> · min {r.minDurationS}s · hyst {r.hysteresisS}
                      s · prio {r.priority}
                      {rt?.compileError ? ` · error: ${rt.compileError}` : ""}
                    </span>
                  </div>
                  <div className={styles.inlineRow}>
                    <Switch
                      checked={r.enabled}
                      label={`Toggle rule ${r.name}`}
                      onChange={(enabled) => {
                        void saveAutomationRule({ ...r, enabled })
                          .then(() => reload())
                          .catch((e: unknown) => {
                            notify(`Could not update rule: ${String(e)}`);
                          });
                      }}
                    />
                    <Button
                      variant="text"
                      icon="delete"
                      onClick={() => {
                        void deleteAutomationRule(r.id)
                          .then(async () => {
                            await reload();
                            notify(`Deleted rule "${r.name}"`);
                          })
                          .catch((e: unknown) => {
                            notify(`Could not delete rule: ${String(e)}`);
                          });
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className={styles.card}>
        <h2 className={styles.cardTitle}>CLI &amp; D-Bus scripting</h2>
        <p className={styles.cardDesc}>
          Control profiles, themes, looks, widgets, and variables from scripts or shell aliases over
          session D-Bus (<code>io.github.ali_kenjo.Opaline1</code> v2):
        </p>
        <p className={styles.rowHint}>
          <code>opaline ctl status --json</code> · <code>opaline ctl profile use &lt;id&gt;</code> ·{" "}
          <code>opaline ctl automation resume</code>
        </p>
      </div>
    </>
  );
}
