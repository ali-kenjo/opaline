// In-app per-widget customizer inside the Settings window: lets the user pick any placed widget,
// toggle & reorder its hardware info rows, pick visualizer styles / widget options, and override
// per-widget transparency, surface, blur, rim, shadow, border, colors, and typography.
import { useMemo, useState } from "react";
import { Button, Slider, Switch } from "../design-system/components";
import { Icon } from "../design-system/icons";
import {
  type HeroColor,
  type SurfaceKind,
  resolveStyle,
  sanitizeStyle,
} from "../design-system/style";
import { matchMonitorKey } from "../layer/grid";
import { type ShellState, patchSettings } from "../shell/api";
import {
  HERO_STYLE_LABELS,
  HISTORY_MINUTES,
  UPDATE_RATES,
  resolveContent,
} from "../widgets/content";
import { widgetByKind } from "../widgets/registry";
import type { ContentOption, WidgetDef } from "../widgets/types";
import styles from "./Settings.module.css";

interface WidgetCustomizerProps {
  state: ShellState;
  refresh: () => Promise<void>;
  notify: (msg: string) => void;
}

interface PlacedEntry {
  id: string;
  kind: string;
  def: WidgetDef;
  monitor: string;
}

const SURFACES: readonly { value: SurfaceKind; label: string }[] = [
  { value: "glass", label: "Glass" },
  { value: "tinted", label: "Tinted" },
  { value: "clear", label: "Transparent" },
  { value: "opaque", label: "Solid" },
  { value: "color", label: "Custom color" },
];

export function WidgetCustomizer({ state, refresh, notify }: WidgetCustomizerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"content" | "style">("content");

  const placed = useMemo<PlacedEntry[]>(() => {
    const seen = new Set<string>();
    const out: PlacedEntry[] = [];
    const { settings, layouts, monitors } = state;

    const addWidget = (id: string, kind: string | undefined, monitor: string) => {
      if (seen.has(id)) return;
      const k = kind ?? settings.widgets[id]?.kind;
      const def = k ? widgetByKind(k) : undefined;
      if (!def) return;
      seen.add(id);
      out.push({ id, kind: def.kind, def, monitor });
    };

    for (const mon of monitors) {
      const key = matchMonitorKey(mon, Object.keys(layouts.monitors)) ?? mon.key;
      const items = layouts.monitors[key]?.items ?? [];
      for (const item of items) {
        if (item.type === "widget") {
          addWidget(item.id, item.kind, mon.connector);
        } else {
          for (const cid of item.children) addWidget(cid, undefined, mon.connector);
        }
      }
    }
    // Include any configured widgets whose monitor is currently disconnected.
    for (const [id, cfg] of Object.entries(settings.widgets)) {
      addWidget(id, cfg.kind, "Other");
    }
    return out;
  }, [state]);

  const active = placed.find((p) => p.id === selectedId) ?? placed[0] ?? null;

  const saveWidget = async (id: string, kind: string, patch: Record<string, unknown>) => {
    try {
      await patchSettings({ widgets: { [id]: { kind, ...patch } } });
      await refresh();
    } catch (e) {
      notify(`Could not save widget: ${String(e)}`);
    }
  };

  if (placed.length === 0) {
    return (
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Your widgets</h2>
        <p className={styles.cardDesc}>
          No widgets are placed yet. Click Edit widgets in the top bar or apply a preset in Layout
          to add widgets.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <h2 className={styles.cardTitle}>Customize individual widgets</h2>
          <p className={styles.cardDesc}>
            Pick any widget to choose which hardware info and metrics it shows, change visualizer
            styles, or override its transparency and appearance.
          </p>
        </div>
      </div>

      <div className={styles.widgetPills} role="tablist" aria-label="Placed widgets">
        {placed.map((entry) => {
          const stored = state.settings.widgets[entry.id];
          const content = resolveContent(entry.def, stored?.content);
          const isSelected = active?.id === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              className={`${styles.widgetPill} ${isSelected ? styles.widgetPillActive : ""}`}
              onClick={() => {
                setSelectedId(entry.id);
              }}
            >
              <Icon name={entry.def.icon} size={17} />
              <span>{content.title || entry.def.name}</span>
              <span className={styles.widgetPillSub}>{entry.monitor}</span>
            </button>
          );
        })}
      </div>

      {active ? (
        <ActiveWidgetEditor
          entry={active}
          state={state}
          tab={tab}
          onTab={setTab}
          onSave={(patch) => saveWidget(active.id, active.kind, patch)}
          notify={notify}
        />
      ) : null}
    </div>
  );
}

function ActiveWidgetEditor({
  entry,
  state,
  tab,
  onTab,
  onSave,
  notify,
}: {
  entry: PlacedEntry;
  state: ShellState;
  tab: "content" | "style";
  onTab: (t: "content" | "style") => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  notify: (msg: string) => void;
}) {
  const stored = state.settings.widgets[entry.id];
  const def = entry.def;
  const content = useMemo(() => resolveContent(def, stored?.content), [def, stored?.content]);
  const globalStyle = useMemo(() => sanitizeStyle(state.settings.style), [state.settings.style]);
  const ownStyle = useMemo(() => sanitizeStyle(stored?.style), [stored?.style]);
  const { style, origin } = useMemo(
    () => resolveStyle(globalStyle, ownStyle),
    [globalStyle, ownStyle],
  );

  const setContent = (key: string, value: unknown) => {
    void onSave({ content: { [key]: value } });
  };
  const setStyle = (patch: Record<string, unknown>) => {
    void onSave({ style: patch });
  };

  const visible = content.fields;
  const hidden = def.fields.filter((f) => !visible.includes(f.id));
  const heroable = visible.filter((fid) =>
    def.fields.some((f) => f.id === fid && f.hero !== false),
  );
  const moveField = (fid: string, delta: number) => {
    const i = visible.indexOf(fid);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= visible.length) return;
    const next = [...visible];
    [next[i], next[j]] = [next[j] ?? fid, fid];
    setContent("fields", next);
  };

  const ownKeys = Object.keys(ownStyle);
  const resetOwnStyle = () => {
    if (ownKeys.length === 0) return;
    const cleared = Object.fromEntries(ownKeys.map((k) => [k, null]));
    void onSave({ style: cleared }).then(() => {
      notify(`Reset style for ${content.title || def.name}`);
    });
  };

  return (
    <div className={styles.editorBox}>
      <div className={styles.row}>
        <div className={styles.inlineRow}>
          <Icon name={def.icon} size={20} />
          <strong className={styles.rowLabel}>{content.title || def.name}</strong>
          <span className={styles.rowHint}>({entry.monitor})</span>
        </div>
        <div className={styles.segmented}>
          <button
            type="button"
            className={`${styles.segBtn} ${tab === "content" ? styles.segActive : ""}`}
            onClick={() => {
              onTab("content");
            }}
          >
            Info &amp; options
          </button>
          <button
            type="button"
            className={`${styles.segBtn} ${tab === "style" ? styles.segActive : ""}`}
            onClick={() => {
              onTab("style");
            }}
          >
            Style &amp; transparency
          </button>
        </div>
      </div>

      {tab === "content" ? (
        <div className={styles.editorSection}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Show widget title</span>
            <Switch
              checked={content.showTitle}
              label="Show widget title"
              onChange={(v) => {
                setContent("showTitle", v);
              }}
            />
          </div>
          {content.showTitle ? (
            <div className={styles.row}>
              <span className={styles.rowLabel}>Custom title</span>
              <input
                key={`${entry.id}-title`}
                className={styles.input}
                style={{ width: 220 }}
                maxLength={40}
                defaultValue={content.title}
                placeholder={def.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== content.title) setContent("title", v || def.name);
                }}
              />
            </div>
          ) : null}

          {def.fields.length > 0 ? (
            <div className={styles.fieldGroup}>
              <div className={styles.rowText}>
                <span className={styles.rowLabel}>Visible hardware info &amp; metrics</span>
                <span className={styles.rowHint}>
                  Toggle any info on or off and reorder rows. Top rows appear first on compact
                  sizes.
                </span>
              </div>
              <div className={styles.fieldChecklist}>
                {visible.map((fid, idx) => {
                  const f = def.fields.find((x) => x.id === fid);
                  if (!f) return null;
                  return (
                    <div key={fid} className={styles.fieldRow}>
                      <Switch
                        checked
                        label={`Show ${f.label}`}
                        onChange={() => {
                          setContent(
                            "fields",
                            visible.filter((x) => x !== fid),
                          );
                        }}
                      />
                      {f.icon ? <Icon name={f.icon} size={17} /> : null}
                      <span className={styles.fieldName}>{content.labels[fid] ?? f.label}</span>
                      <div className={styles.fieldOrder}>
                        <button
                          type="button"
                          className={styles.miniBtn}
                          aria-label={`Move ${f.label} up`}
                          disabled={idx === 0}
                          onClick={() => {
                            moveField(fid, -1);
                          }}
                        >
                          <Icon name="keyboard_arrow_up" size={18} />
                        </button>
                        <button
                          type="button"
                          className={styles.miniBtn}
                          aria-label={`Move ${f.label} down`}
                          disabled={idx === visible.length - 1}
                          onClick={() => {
                            moveField(fid, 1);
                          }}
                        >
                          <Icon name="keyboard_arrow_down" size={18} />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {hidden.map((f) => (
                  <div key={f.id} className={`${styles.fieldRow} ${styles.fieldRowOff}`}>
                    <Switch
                      checked={false}
                      label={`Show ${f.label}`}
                      onChange={() => {
                        setContent("fields", [...visible, f.id]);
                      }}
                    />
                    {f.icon ? <Icon name={f.icon} size={17} /> : null}
                    <span className={styles.fieldName}>{content.labels[f.id] ?? f.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {def.heroStyles && heroable.length > 0 ? (
            <>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Main visual metric</span>
                <select
                  className={styles.select}
                  value={content.hero}
                  onChange={(e) => {
                    setContent("hero", e.target.value);
                  }}
                >
                  {heroable.map((fid) => (
                    <option key={fid} value={fid}>
                      {content.label(fid, def.fields.find((f) => f.id === fid)?.label ?? fid)}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Main visual style</span>
                <div className={styles.segmented}>
                  {def.heroStyles.map((h) => (
                    <button
                      key={h}
                      type="button"
                      className={`${styles.segBtn} ${content.heroStyle === h ? styles.segActive : ""}`}
                      onClick={() => {
                        setContent("heroStyle", h);
                      }}
                    >
                      {HERO_STYLE_LABELS[h]}
                    </button>
                  ))}
                </div>
              </div>
              {content.heroStyle === "sparkline" ? (
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Graph window</span>
                  <div className={styles.segmented}>
                    {HISTORY_MINUTES.map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`${styles.segBtn} ${content.historyMinutes === m ? styles.segActive : ""}`}
                        onClick={() => {
                          setContent("historyMinutes", m);
                        }}
                      >
                        {m === 60 ? "1 h" : `${String(m)} min`}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {(def.options ?? []).map((opt) => (
            <InlineOptionRow
              key={opt.key}
              option={opt}
              value={content.opt(opt.key)}
              onChange={(v) => {
                setContent(opt.key, v);
              }}
            />
          ))}

          {def.fields.length > 0 ? (
            <>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Decimals</span>
                <div className={styles.segmented}>
                  {[0, 1, 2].map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`${styles.segBtn} ${content.decimals === d ? styles.segActive : ""}`}
                      onClick={() => {
                        setContent("decimals", d);
                      }}
                    >
                      {d === 0 ? "42" : d === 1 ? "42.0" : "42.00"}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Update speed</span>
                <div className={styles.segmented}>
                  {UPDATE_RATES.map((u) => (
                    <button
                      key={u.value}
                      type="button"
                      className={`${styles.segBtn} ${content.updateRate === u.value ? styles.segActive : ""}`}
                      onClick={() => {
                        setContent("updateRate", u.value);
                      }}
                    >
                      {u.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <div className={styles.editorSection}>
          <div className={styles.row}>
            <div className={styles.rowText}>
              <span className={styles.rowLabel}>Background style</span>
              <span className={styles.rowHint}>
                {origin.surface === "widget" ? "Custom for this widget" : "Inherited from global"}
              </span>
            </div>
            <select
              className={styles.select}
              value={style.surface}
              onChange={(e) => {
                setStyle({ surface: e.target.value });
              }}
            >
              {SURFACES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {style.surface === "color" ? (
            <div className={styles.row}>
              <span className={styles.rowLabel}>Background color</span>
              <input
                type="color"
                value={style.surfaceColor ?? "#1e1b2e"}
                onChange={(e) => {
                  setStyle({ surfaceColor: e.target.value });
                }}
              />
            </div>
          ) : null}

          {style.surface !== "opaque" && style.surface !== "clear" ? (
            <>
              <div className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowLabel}>
                    Transparency ({Math.round(style.transparency)}%)
                  </span>
                  <span className={styles.rowHint}>0% = solid tint · 100% = crystal clear</span>
                </div>
                <div style={{ width: 200 }}>
                  <Slider
                    value={style.transparency}
                    min={0}
                    max={100}
                    label="Widget transparency"
                    onChange={(v) => {
                      setStyle({ transparency: Math.round(v) });
                    }}
                  />
                </div>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Extra blur ({Math.round(style.blur)}%)</span>
                <div style={{ width: 200 }}>
                  <Slider
                    value={style.blur}
                    min={0}
                    max={100}
                    label="Widget blur"
                    onChange={(v) => {
                      setStyle({ blur: Math.round(v) });
                    }}
                  />
                </div>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Edge highlight ({Math.round(style.rim)}%)</span>
                <div style={{ width: 200 }}>
                  <Slider
                    value={style.rim}
                    min={0}
                    max={100}
                    label="Widget rim"
                    onChange={(v) => {
                      setStyle({ rim: Math.round(v) });
                    }}
                  />
                </div>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Shadow ({Math.round(style.shadow)}%)</span>
                <div style={{ width: 200 }}>
                  <Slider
                    value={style.shadow}
                    min={0}
                    max={100}
                    label="Widget shadow"
                    onChange={(v) => {
                      setStyle({ shadow: Math.round(v) });
                    }}
                  />
                </div>
              </div>
            </>
          ) : null}

          <div className={styles.row}>
            <span className={styles.rowLabel}>Border ({style.borderWidth.toFixed(1)} px)</span>
            <div style={{ width: 200 }}>
              <Slider
                value={style.borderWidth}
                min={0}
                max={4}
                step={0.5}
                label="Widget border"
                onChange={(v) => {
                  setStyle({ borderWidth: Math.round(v * 2) / 2 });
                }}
              />
            </div>
          </div>

          {style.borderWidth > 0 ? (
            <div className={styles.row}>
              <span className={styles.rowLabel}>Border color</span>
              <input
                type="color"
                value={style.borderColor ?? "#ffffff"}
                onChange={(e) => {
                  setStyle({ borderColor: e.target.value });
                }}
              />
            </div>
          ) : null}

          <div className={styles.row}>
            <span className={styles.rowLabel}>
              Text size ({Math.round(style.textScale * 100)}%)
            </span>
            <div style={{ width: 200 }}>
              <Slider
                value={style.textScale}
                min={0.75}
                max={1.5}
                step={0.05}
                label="Widget text size"
                onChange={(v) => {
                  setStyle({ textScale: Math.round(v * 20) / 20 });
                }}
              />
            </div>
          </div>

          <div className={styles.row}>
            <span className={styles.rowLabel}>Main visual color</span>
            <div className={styles.segmented}>
              {(["ramp", "accent", "custom"] as readonly HeroColor[]).map((hc) => (
                <button
                  key={hc}
                  type="button"
                  className={`${styles.segBtn} ${style.heroColor === hc ? styles.segActive : ""}`}
                  onClick={() => {
                    setStyle({ heroColor: hc });
                  }}
                >
                  {hc === "ramp" ? "By value" : hc === "accent" ? "Accent" : "Custom"}
                </button>
              ))}
            </div>
          </div>

          {style.heroColor === "custom" ? (
            <div className={styles.row}>
              <span className={styles.rowLabel}>Custom visual color</span>
              <input
                type="color"
                value={style.heroCustomColor ?? "#a78bfa"}
                onChange={(e) => {
                  setStyle({ heroCustomColor: e.target.value });
                }}
              />
            </div>
          ) : null}

          <div className={styles.row}>
            <div className={styles.rowText}>
              <span className={styles.rowLabel}>Text shadow</span>
              <span className={styles.rowHint}>
                Helps text stand out on transparent backgrounds.
              </span>
            </div>
            <Switch
              checked={style.textShadow}
              label="Widget text shadow"
              onChange={(v) => {
                setStyle({ textShadow: v });
              }}
            />
          </div>

          <div className={styles.row}>
            <div className={styles.rowText}>
              <span className={styles.rowLabel}>Keep text readable</span>
              <span className={styles.rowHint}>
                Turn off if you want maximum transparency even on bright wallpapers.
              </span>
            </div>
            <Switch
              checked={style.legibility}
              label="Widget adaptive legibility"
              onChange={(v) => {
                setStyle({ legibility: v });
              }}
            />
          </div>

          <div className={styles.inlineRow}>
            <Button
              variant="tonal"
              icon="restart_alt"
              disabled={ownKeys.length === 0}
              onClick={resetOwnStyle}
            >
              Reset this widget&apos;s style
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function InlineOptionRow({
  option,
  value,
  onChange,
}: {
  option: ContentOption;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (option.kind === "source" || option.kind === "location" || option.kind === "thresholds") {
    return null;
  }
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.rowLabel}>{option.label}</span>
        {option.help ? <span className={styles.rowHint}>{option.help}</span> : null}
      </div>
      {option.kind === "enum" ? (
        option.options.length <= 3 ? (
          <div className={styles.segmented}>
            {option.options.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`${styles.segBtn} ${String(value) === o.value ? styles.segActive : ""}`}
                onClick={() => {
                  onChange(o.value);
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        ) : (
          <select
            className={styles.select}
            value={String(value)}
            onChange={(e) => {
              onChange(e.target.value);
            }}
          >
            {option.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )
      ) : option.kind === "bool" ? (
        <Switch checked={Boolean(value)} label={option.label} onChange={onChange} />
      ) : option.kind === "range" ? (
        <div style={{ width: 200 }}>
          <Slider
            value={Number(value)}
            min={option.min}
            max={option.max}
            step={option.step}
            label={option.label}
            onChange={(v) => {
              onChange(Math.round(v / option.step) * option.step);
            }}
          />
        </div>
      ) : (
        <input
          className={styles.input}
          style={{ width: 200 }}
          maxLength={option.maxLength}
          defaultValue={String(value)}
          placeholder={option.placeholder}
          onBlur={(e) => {
            onChange(e.target.value);
          }}
        />
      )}
    </div>
  );
}
