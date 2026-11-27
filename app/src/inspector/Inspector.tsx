// Live floating & dockable Inspector (PLAN-2 5.1, brief §6.1).
// Code-split so it loads only when inspecting a widget in Edit mode. Replaces both the 1.1
// WidgetSettings sheet and Settings → WidgetCustomizer.
import { useEffect, useMemo, useState } from "react";
import { Button } from "../design-system/components";
import { useGlassContrast } from "../design-system/glass";
import { Icon, type IconName } from "../design-system/icons";
import {
  type ConditionalStyle,
  type Origin,
  type ResolvedStyle,
  STYLE_FIELDS,
  STYLE_GROUPS,
  type Style,
  type StyleField,
  type StyleKey,
  type WidgetActions,
  resolveCascade,
  rolesFor,
  sanitizeStyle,
} from "../design-system/style";
import type { LayoutItem, LayoutMode, PxRect } from "../layer/grid";
import { resolveContent } from "../widgets/content";
import { useHost } from "../widgets/host";
import { type Json, toJson } from "../widgets/json";
import {
  ColorField,
  FontField,
  RangeField,
  Row,
  Segmented,
  Select,
  TextField,
  Toggle,
} from "../widgets/settings/controls";
import baseStyles from "../widgets/settings/settings.module.css";
import type { WidgetDef } from "../widgets/types";
import { ContentTab } from "./ContentTab";
import styles from "./Inspector.module.css";
import {
  INSPECTOR_STYLE_CHIPS,
  computeInspectorPos,
  readStyleClipboard,
  writeStyleClipboard,
} from "./styleChips";

export type InspectorTab = "look" | "content" | "data" | "behavior" | "advanced";
export type InspectorScope = "widget" | "kind" | "global";
type DockMode = "float" | "left" | "right";

export interface InspectorProps {
  id: string;
  def: WidgetDef;
  open: boolean;
  onClose: () => void;
  origin?: PxRect | null;
  viewportW?: number;
  viewportH?: number;
  item?: LayoutItem | null;
  mode?: LayoutMode;
  onUpdateItem?: (next: LayoutItem) => void;
  initialTab?: InspectorTab;
}

const ESSENTIAL_KEYS: readonly StyleKey[] = [
  "transparency",
  "blur",
  "tintColor",
  "cardShape",
  "accentColor",
  "fontFamily",
  "textScale",
];

const ACTION_KINDS = [
  { value: "none", label: "Nothing" },
  { value: "detail", label: "Detail view" },
  { value: "url", label: "Open URL" },
  { value: "app", label: "Launch app" },
  { value: "command", label: "Run command" },
  { value: "toggle", label: "Toggle state" },
] as const;

function argbHex(argb: number): string {
  return `#${(argb & 0xffffff).toString(16).padStart(6, "0")}`;
}

function ContrastMeter({ id }: { id: string }) {
  const value = useGlassContrast((s) => s.byKey[id]);
  if (value === undefined) return null;
  const low = value < 4.5;
  return (
    <p className={`${baseStyles.contrast} ${low ? baseStyles.contrastLow : ""}`} role="status">
      <Icon name={low ? "warning" : "contrast"} size={18} />
      {low
        ? `Text contrast ${value.toFixed(1)} : 1 (below 4.5 : 1). Enable "Keep text readable", adjust tint/blur, or change text color.`
        : `Text contrast ${value.toFixed(1)} : 1`}
    </p>
  );
}

export function Inspector({
  id,
  def,
  open,
  onClose,
  origin = null,
  viewportW = typeof window !== "undefined" ? window.innerWidth : 1280,
  viewportH = typeof window !== "undefined" ? window.innerHeight : 800,
  item = null,
  mode = "grid",
  onUpdateItem,
  initialTab = "look",
}: InspectorProps) {
  const host = useHost();
  const [tab, setTab] = useState<InspectorTab>(initialTab);
  const [scope, setScope] = useState<InspectorScope>("widget");
  const [dock, setDock] = useState<DockMode>("float");
  const [showMore, setShowMore] = useState(false);
  const [eyedropperOpen, setEyedropperOpen] = useState(false);
  const [fonts, setFonts] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [newCondWhen, setNewCondWhen] = useState("");
  const [newCondColor, setNewCondColor] = useState("#f25c54");

  useEffect(() => {
    if (!open || fonts.length) return;
    let alive = true;
    host
      .listFonts()
      .then((f) => {
        if (alive) setFonts(f);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open, fonts.length, host]);

  const stored = host.settings.widgets[id];
  const themeStyle = useMemo(
    () => (host.theme?.style ? sanitizeStyle(host.theme.style) : undefined),
    [host.theme],
  );
  const themeKindStyle = useMemo(
    () => (host.theme?.kinds?.[def.kind] ? sanitizeStyle(host.theme.kinds[def.kind]) : undefined),
    [host.theme, def.kind],
  );
  const globalStyle = useMemo(() => sanitizeStyle(host.settings.style), [host.settings.style]);
  const kindStyle = useMemo(
    () => sanitizeStyle(host.settings.kindStyles?.[def.kind]),
    [host.settings.kindStyles, def.kind],
  );
  const ownStyle = useMemo(() => sanitizeStyle(stored?.style), [stored?.style]);

  const resolution = useMemo(
    () =>
      resolveCascade({
        theme: themeStyle,
        themeKind: themeKindStyle,
        global: globalStyle,
        kind: scope === "global" ? undefined : kindStyle,
        widget: scope === "widget" ? ownStyle : undefined,
      }),
    [themeStyle, themeKindStyle, globalStyle, kindStyle, ownStyle, scope],
  );

  const activeScopeStyle: Style =
    scope === "global" ? globalStyle : scope === "kind" ? kindStyle : ownStyle;

  const content = useMemo(() => resolveContent(def, stored?.content), [def, stored?.content]);
  const roles = rolesFor(resolution.style, host.colors);

  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(activeScopeStyle, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  const save = (patch: Record<string, Json>, msg?: string) => {
    host
      .updateSettings(patch)
      .then((r) => {
        if (r.result === "err") setStatus(`Couldn't save (${r.reason})`);
        else if (msg) setStatus(msg);
        else setStatus(null);
      })
      .catch(() => {
        setStatus("Couldn't save");
      });
  };

  const applyStylePatch = (patch: Record<string, Json>, msg?: string) => {
    if (scope === "global") {
      save({ style: patch }, msg);
    } else if (scope === "kind") {
      save({ kindStyles: { [def.kind]: patch } }, msg);
    } else {
      save({ widgets: { [id]: { kind: def.kind, style: patch } } }, msg);
    }
  };

  const setStyleKey = (key: StyleKey, value: Json) => {
    applyStylePatch({ [key]: value });
  };

  const setContentKey = (key: string, value: Json) => {
    save({ widgets: { [id]: { kind: def.kind, content: { [key]: value } } } });
  };

  const handleCopyStyle = () => {
    writeStyleClipboard(activeScopeStyle as unknown as Record<string, Json>);
    setStatus("Style copied");
  };

  const handlePasteStyle = () => {
    const clip = readStyleClipboard();
    if (!clip) {
      setStatus("Style clipboard is empty");
      return;
    }
    const clean = sanitizeStyle(clip);
    applyStylePatch(clean as unknown as Record<string, Json>, "Style pasted");
  };

  const handleResetToTheme = () => {
    const clear: Record<string, Json> = Object.fromEntries(
      Object.keys(activeScopeStyle).map((k) => [k, null]),
    );
    if (Object.keys(clear).length === 0) return;
    applyStylePatch(clear, "Reset to theme");
  };

  // Keyboard shortcuts inside Inspector: Escape closes, Ctrl+Shift+C/V copy & paste style.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        writeStyleClipboard(activeScopeStyle as unknown as Record<string, Json>);
        setStatus("Style copied");
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        const clip = readStyleClipboard();
        if (clip) {
          const clean = sanitizeStyle(clip);
          if (scope === "global") {
            void host.updateSettings({ style: clean as unknown as Record<string, Json> });
          } else if (scope === "kind") {
            void host.updateSettings({
              kindStyles: { [def.kind]: clean as unknown as Record<string, Json> },
            });
          } else {
            void host.updateSettings({
              widgets: {
                [id]: { kind: def.kind, style: clean as unknown as Record<string, Json> },
              },
            });
          }
          setStatus("Style pasted");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, activeScopeStyle, scope, host, def.kind, id]);

  // Live topic values for Data tab.
  const topicNames = useMemo(() => {
    const set = new Set<string>(def.topics ?? []);
    for (const f of def.fields) {
      const ft = (f as { topics?: unknown }).topics;
      if (Array.isArray(ft)) {
        for (const t of ft) {
          if (typeof t === "string") set.add(t);
        }
      }
    }
    return [...set].sort();
  }, [def]);
  const allValues = host.useValues((all) => all);
  const liveValues = useMemo(() => {
    const out: Record<string, Json> = {};
    for (const t of topicNames) out[t] = toJson(allValues[t]);
    return out;
  }, [allValues, topicNames]);

  if (!open) return null;

  const pos = computeInspectorPos(origin, viewportW, viewportH);
  const dockClass = dock === "left" ? styles.dockLeft : dock === "right" ? styles.dockRight : "";

  const eyedropperSwatches = [
    { label: "Wallpaper primary", hex: argbHex(roles.primary) },
    { label: "Secondary", hex: argbHex(roles.secondary) },
    { label: "Tertiary", hex: argbHex(roles.tertiary) },
    { label: "Surface container", hex: argbHex(roles.surfaceContainer) },
    { label: "Error", hex: argbHex(roles.error) },
    ...Object.entries(host.settings.widgets)
      .flatMap(([wid, w]) =>
        wid !== id && typeof w.style?.accentColor === "string"
          ? [{ label: `Widget ${wid}`, hex: w.style.accentColor }]
          : [],
      )
      .slice(0, 4),
  ];

  const cssSelector = `[data-kind="${def.kind}"]`;
  const conditions: readonly ConditionalStyle[] = resolution.style.conditions ?? [];
  const actions: WidgetActions = resolution.style.actions ?? {};

  const renderField = (f: StyleField) => (
    <InspectorStyleRow
      key={f.key}
      field={f}
      style={resolution.style}
      origin={resolution.origin[f.key]}
      own={
        scope === "widget"
          ? resolution.origin[f.key] === "widget"
          : scope === "kind"
            ? resolution.origin[f.key] === "kind"
            : resolution.origin[f.key] === "global"
      }
      fonts={fonts}
      fallbackColor={argbHex(
        f.key === "textColor"
          ? roles.onSurface
          : f.key === "secondaryTextColor"
            ? roles.onSurfaceVariant
            : f.key === "borderColor"
              ? roles.outlineVariant
              : f.key === "surfaceColor" || f.key === "tintColor"
                ? roles.surfaceContainer
                : roles.primary,
      )}
      onChange={(v) => {
        setStyleKey(f.key, v);
      }}
    />
  );

  return (
    <div
      role="dialog"
      aria-label={`${content.title || def.name} inspector`}
      className={`${styles.panel} ${dockClass}`}
      style={dock === "float" ? { left: pos.left, top: pos.top } : undefined}
    >
      <div className={styles.header}>
        <Icon name={def.icon} size={22} />
        <div className={styles.titleWrap}>
          <h2 className={styles.title}>{content.title || def.name}</h2>
          <div className={styles.subtitle}>
            {def.kind} · {host.theme?.id ?? host.settings.theme ?? "opaline"}
          </div>
        </div>
        <div className={styles.headerBtns}>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Dock inspector"
            title={dock === "float" ? "Dock right" : dock === "right" ? "Dock left" : "Float"}
            onClick={() => {
              setDock((d) => (d === "float" ? "right" : d === "right" ? "left" : "float"));
            }}
          >
            <Icon name="layers" size={18} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Close inspector"
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Inspector sections">
        {(
          [
            { id: "look", label: "Look" },
            { id: "content", label: "Content" },
            { id: "data", label: "Data" },
            { id: "behavior", label: "Behavior" },
            { id: "advanced", label: "Advanced" },
          ] as readonly { id: InspectorTab; label: string }[]
        ).map((tb) => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            aria-selected={tab === tb.id}
            className={`${styles.tab} ${tab === tb.id ? styles.tabActive : ""}`}
            onClick={() => {
              setTab(tb.id);
              if (tb.id === "advanced") {
                setJsonDraft(JSON.stringify(activeScopeStyle, null, 2));
                setJsonError(null);
              }
            }}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === "look" || tab === "advanced" ? (
        <div className={styles.scopeStrip}>
          <Segmented
            label="Apply to"
            value={scope}
            options={[
              { value: "widget", label: "This widget" },
              { value: "kind", label: `All ${def.name}` },
              { value: "global", label: "All widgets" },
            ]}
            onChange={(v) => {
              const nextScope = v as InspectorScope;
              setScope(nextScope);
              const nextObj =
                nextScope === "global" ? globalStyle : nextScope === "kind" ? kindStyle : ownStyle;
              setJsonDraft(JSON.stringify(nextObj, null, 2));
            }}
          />
          <div className={styles.quickRow}>
            <Button variant="text" icon="content_copy" onClick={handleCopyStyle}>
              Copy style
            </Button>
            <Button variant="text" icon="format_paint" onClick={handlePasteStyle}>
              Paste style
            </Button>
            <Button
              variant="text"
              icon="palette"
              onClick={() => {
                setEyedropperOpen((v) => !v);
              }}
            >
              Eyedropper
            </Button>
            <Button
              variant="text"
              icon="restart_alt"
              disabled={Object.keys(activeScopeStyle).length === 0}
              onClick={handleResetToTheme}
            >
              Reset to theme
            </Button>
          </div>
          {eyedropperOpen ? (
            <div className={styles.eyedropperRow} aria-label="Sampled colors">
              <span className={styles.subtitle}>Pick accent:</span>
              {eyedropperSwatches.map((s) => (
                <button
                  key={`${s.label}-${s.hex}`}
                  type="button"
                  className={styles.swatchBtn}
                  style={{ background: s.hex }}
                  title={`${s.label} (${s.hex})`}
                  aria-label={`Use ${s.label} ${s.hex}`}
                  onClick={() => {
                    setStyleKey("accentColor", s.hex);
                    setEyedropperOpen(false);
                    setStatus(`Accent set to ${s.hex}`);
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {status ? (
        <div className={styles.statusBar} role="status">
          {status}
        </div>
      ) : null}

      <div className={styles.scroll}>
        {tab === "look" ? (
          <>
            <ContrastMeter id={id} />

            <section className={baseStyles.group} aria-label="Style presets">
              <h3 className={baseStyles.groupTitle}>
                <Icon name="palette" size={18} /> Style chips
              </h3>
              <div className={styles.chipGrid}>
                {INSPECTOR_STYLE_CHIPS.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    className={styles.chip}
                    onClick={() => {
                      applyStylePatch(
                        chip.patch as unknown as Record<string, Json>,
                        `Applied ${chip.label}`,
                      );
                    }}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </section>

            {item && onUpdateItem ? (
              <section className={baseStyles.group} aria-label="Position and size">
                <h3 className={baseStyles.groupTitle}>
                  <Icon name="open_in_full" size={18} /> Position &amp; size (
                  {mode === "free" ? "px" : "cells"})
                </h3>
                {mode === "free" && item.free ? (
                  <div className={styles.geoGrid}>
                    <label className={styles.geoField}>
                      X
                      <input
                        type="number"
                        className={styles.numInput}
                        value={item.free.offsetX}
                        onChange={(e) => {
                          const v = Math.round(Number(e.target.value));
                          if (Number.isFinite(v) && item.free) {
                            onUpdateItem({ ...item, free: { ...item.free, offsetX: v } });
                          }
                        }}
                      />
                    </label>
                    <label className={styles.geoField}>
                      Y
                      <input
                        type="number"
                        className={styles.numInput}
                        value={item.free.offsetY}
                        onChange={(e) => {
                          const v = Math.round(Number(e.target.value));
                          if (Number.isFinite(v) && item.free) {
                            onUpdateItem({ ...item, free: { ...item.free, offsetY: v } });
                          }
                        }}
                      />
                    </label>
                    <label className={styles.geoField}>
                      W
                      <input
                        type="number"
                        min={84}
                        max={1600}
                        className={styles.numInput}
                        value={item.free.width}
                        onChange={(e) => {
                          const v = Math.max(
                            84,
                            Math.min(1600, Math.round(Number(e.target.value))),
                          );
                          if (Number.isFinite(v) && item.free) {
                            onUpdateItem({ ...item, free: { ...item.free, width: v } });
                          }
                        }}
                      />
                    </label>
                    <label className={styles.geoField}>
                      H
                      <input
                        type="number"
                        min={84}
                        max={1200}
                        className={styles.numInput}
                        value={item.free.height}
                        onChange={(e) => {
                          const v = Math.max(
                            84,
                            Math.min(1200, Math.round(Number(e.target.value))),
                          );
                          if (Number.isFinite(v) && item.free) {
                            onUpdateItem({ ...item, free: { ...item.free, height: v } });
                          }
                        }}
                      />
                    </label>
                  </div>
                ) : (
                  <div className={styles.geoGrid}>
                    <label className={styles.geoField}>
                      Col
                      <input
                        type="number"
                        min={0}
                        max={64}
                        className={styles.numInput}
                        value={item.x}
                        onChange={(e) => {
                          const v = Math.max(0, Math.round(Number(e.target.value)));
                          if (Number.isFinite(v)) onUpdateItem({ ...item, x: v });
                        }}
                      />
                    </label>
                    <label className={styles.geoField}>
                      Row
                      <input
                        type="number"
                        min={0}
                        max={64}
                        className={styles.numInput}
                        value={item.y}
                        onChange={(e) => {
                          const v = Math.max(0, Math.round(Number(e.target.value)));
                          if (Number.isFinite(v)) onUpdateItem({ ...item, y: v });
                        }}
                      />
                    </label>
                    <label className={styles.geoField}>
                      Cols
                      <input
                        type="number"
                        min={1}
                        max={16}
                        className={styles.numInput}
                        value={item.w}
                        onChange={(e) => {
                          const v = Math.max(1, Math.min(16, Math.round(Number(e.target.value))));
                          if (Number.isFinite(v)) onUpdateItem({ ...item, w: v });
                        }}
                      />
                    </label>
                    <label className={styles.geoField}>
                      Rows
                      <input
                        type="number"
                        min={1}
                        max={16}
                        className={styles.numInput}
                        value={item.h}
                        onChange={(e) => {
                          const v = Math.max(1, Math.min(16, Math.round(Number(e.target.value))));
                          if (Number.isFinite(v)) onUpdateItem({ ...item, h: v });
                        }}
                      />
                    </label>
                  </div>
                )}
              </section>
            ) : null}

            <section className={baseStyles.group} aria-label="Essentials">
              <h3 className={baseStyles.groupTitle}>
                <Icon name="tune" size={18} /> Essentials
              </h3>
              {ESSENTIAL_KEYS.map((k) => {
                const f = STYLE_FIELDS.find((sf) => sf.key === k);
                if (!f || (f.when && !f.when(resolution.style))) return null;
                return renderField(f);
              })}
            </section>

            <Button
              variant="outlined"
              icon={showMore ? "keyboard_arrow_up" : "keyboard_arrow_down"}
              onClick={() => {
                setShowMore((m) => !m);
              }}
            >
              {showMore ? "Hide extra style options" : "More style options"}
            </Button>

            {showMore
              ? STYLE_GROUPS.map((g) => {
                  const fields = STYLE_FIELDS.filter(
                    (f) =>
                      f.group === g.id &&
                      f.kind !== "structured" &&
                      !ESSENTIAL_KEYS.includes(f.key) &&
                      (!f.when || f.when(resolution.style)),
                  );
                  if (fields.length === 0) return null;
                  return (
                    <section key={g.id} className={baseStyles.group} aria-label={g.label}>
                      <h3 className={baseStyles.groupTitle}>
                        <Icon name={g.icon as IconName} size={18} /> {g.label}
                      </h3>
                      {fields.map(renderField)}
                    </section>
                  );
                })
              : null}
          </>
        ) : null}

        {tab === "content" ? (
          <ContentTab def={def} content={content} setContent={setContentKey} />
        ) : null}

        {tab === "data" ? (
          <section className={baseStyles.group} aria-label="Live topics and bindings">
            <h3 className={baseStyles.groupTitle}>
              <Icon name="monitoring" size={18} /> Live data ({topicNames.length} topics)
            </h3>
            <div className={styles.dataList}>
              {topicNames.map((tName) => {
                const raw = liveValues[tName];
                const formatted =
                  raw === null || raw === undefined
                    ? "—"
                    : typeof raw === "object"
                      ? JSON.stringify(raw).slice(0, 64)
                      : String(raw);
                return (
                  <div key={tName} className={styles.dataRow}>
                    <span className={styles.dataKey}>{tName}</span>
                    <span className={styles.dataVal} title={formatted}>
                      {formatted}
                    </span>
                  </div>
                );
              })}
              {def.composition?.bindings ? (
                <>
                  <h4 className={styles.subtitle} style={{ marginTop: 8 }}>
                    Composition bindings
                  </h4>
                  {Object.entries(def.composition.bindings).map(([bKey, expr]) => (
                    <div key={bKey} className={styles.dataRow}>
                      <span className={styles.dataKey}>bind.{bKey}</span>
                      <span className={styles.dataVal} title={expr}>
                        {expr}
                      </span>
                    </div>
                  ))}
                </>
              ) : null}
            </div>
          </section>
        ) : null}

        {tab === "behavior" ? (
          <>
            <section className={baseStyles.group} aria-label="Visibility and tooltip">
              <h3 className={baseStyles.groupTitle}>
                <Icon name="visibility" size={18} /> Visibility &amp; tooltip
              </h3>
              <Row label="Auto-hide when empty">
                <Toggle
                  label="Auto-hide when empty"
                  checked={resolution.style.autoHideEmpty}
                  onChange={(v) => {
                    setStyleKey("autoHideEmpty", v);
                  }}
                />
              </Row>
              <Row label="Tooltip">
                <TextField
                  label="Tooltip"
                  value={resolution.style.tooltip ?? ""}
                  maxLength={120}
                  placeholder="Optional hover tooltip"
                  onCommit={(v) => {
                    setStyleKey("tooltip", v.trim() === "" ? null : v);
                  }}
                />
              </Row>
            </section>

            <section className={baseStyles.group} aria-label="Pointer actions">
              <h3 className={baseStyles.groupTitle}>
                <Icon name="tune" size={18} /> Actions
              </h3>
              {(
                [
                  { slot: "click", label: "Click" },
                  { slot: "doubleClick", label: "Double-click" },
                  { slot: "middleClick", label: "Middle-click" },
                  { slot: "scrollUp", label: "Scroll up" },
                  { slot: "scrollDown", label: "Scroll down" },
                ] as const
              ).map(({ slot, label }) => {
                const cur = actions[slot]?.kind ?? "none";
                return (
                  <Row key={slot} label={label}>
                    <Select
                      label={`${label} action`}
                      value={cur}
                      options={[...ACTION_KINDS]}
                      onChange={(nextKind) => {
                        const nextActions: Record<string, Json> = {
                          ...(actions as unknown as Record<string, Json>),
                          [slot]: nextKind === "none" ? null : { kind: nextKind },
                        };
                        setStyleKey("actions", nextActions);
                      }}
                    />
                  </Row>
                );
              })}
            </section>

            <section className={baseStyles.group} aria-label="Conditional styles">
              <h3 className={baseStyles.groupTitle}>
                <Icon name="bolt" size={18} /> Conditional styles ({conditions.length})
              </h3>
              {conditions.map((rule, rIdx) => (
                <div key={`${rule.when}-${String(rIdx)}`} className={styles.ruleCard}>
                  <div className={styles.ruleHead}>
                    <code>{rule.when}</code>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      aria-label="Remove conditional rule"
                      onClick={() => {
                        const next = conditions.filter((_, i) => i !== rIdx);
                        setStyleKey("conditions", next.length ? (next as unknown as Json) : null);
                      }}
                    >
                      <Icon name="delete" size={16} />
                    </button>
                  </div>
                  <div className={styles.subtitle}>
                    Sets: {Object.keys(rule.set).join(", ") || "(none)"}
                  </div>
                </div>
              ))}
              <div className={styles.ruleCard}>
                <input
                  type="text"
                  className={styles.numInput}
                  aria-label="Condition expression"
                  placeholder="when e.g. cpu.temp >= 85"
                  value={newCondWhen}
                  onChange={(e) => {
                    setNewCondWhen(e.target.value);
                  }}
                />
                <div className={styles.quickRow}>
                  <input
                    type="color"
                    aria-label="Condition border color"
                    value={newCondColor}
                    onChange={(e) => {
                      setNewCondColor(e.target.value);
                    }}
                  />
                  <Button
                    variant="tonal"
                    onClick={() => {
                      const expr = newCondWhen.trim();
                      if (!expr) return;
                      const next: ConditionalStyle[] = [
                        ...conditions,
                        {
                          when: expr,
                          set: { borderWidth: 2, borderColor: newCondColor },
                        },
                      ];
                      setStyleKey("conditions", next as unknown as Json);
                      setNewCondWhen("");
                    }}
                  >
                    Add rule
                  </Button>
                </div>
              </div>
            </section>
          </>
        ) : null}

        {tab === "advanced" ? (
          <>
            <section className={baseStyles.group} aria-label="CSS selector">
              <h3 className={baseStyles.groupTitle}>
                <Icon name="tune" size={18} /> CSS selector
              </h3>
              <div className={styles.selectorBox}>
                <code>{cssSelector}</code>
                <Button
                  variant="text"
                  icon="content_copy"
                  onClick={() => {
                    void navigator.clipboard.writeText(cssSelector).catch(() => undefined);
                    setStatus(`Copied ${cssSelector}`);
                  }}
                >
                  Copy
                </Button>
              </div>
            </section>

            <section className={baseStyles.group} aria-label="Overridden style keys">
              <h3 className={baseStyles.groupTitle}>
                <Icon name="tune" size={18} /> Active keys ({Object.keys(activeScopeStyle).length})
              </h3>
              {Object.keys(activeScopeStyle).length === 0 ? (
                <p className={styles.subtitle}>Inheriting all values from the active theme.</p>
              ) : (
                <div className={styles.dataList}>
                  {Object.entries(activeScopeStyle).map(([k, v]) => (
                    <div key={k} className={styles.dataRow}>
                      <span className={styles.dataKey}>
                        {k} ({resolution.origin[k as StyleKey]})
                      </span>
                      <span className={styles.dataVal}>{JSON.stringify(v)}</span>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        aria-label={`Reset ${k}`}
                        onClick={() => {
                          setStyleKey(k as StyleKey, null);
                        }}
                      >
                        <Icon name="restart_alt" size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className={baseStyles.group} aria-label="Style JSON">
              <h3 className={baseStyles.groupTitle}>
                <Icon name="tune" size={18} /> Style JSON (schema validated)
              </h3>
              <textarea
                className={styles.jsonArea}
                aria-label="Style JSON"
                value={jsonDraft}
                onChange={(e) => {
                  setJsonDraft(e.target.value);
                  setJsonError(null);
                }}
              />
              {jsonError ? (
                <p className={baseStyles.contrastLow} role="alert">
                  {jsonError}
                </p>
              ) : null}
              <Button
                variant="tonal"
                onClick={() => {
                  try {
                    const parsed = JSON.parse(jsonDraft) as unknown;
                    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
                      setJsonError("JSON must be an object of style keys.");
                      return;
                    }
                    const sanitized = sanitizeStyle(parsed);
                    const clear = Object.fromEntries(
                      Object.keys(activeScopeStyle).map((k) => [k, null]),
                    );
                    applyStylePatch(
                      { ...clear, ...(sanitized as unknown as Record<string, Json>) },
                      "Applied JSON style",
                    );
                    setJsonDraft(JSON.stringify(sanitized, null, 2));
                  } catch (e) {
                    setJsonError(e instanceof Error ? e.message : "Invalid JSON");
                  }
                }}
              >
                Apply JSON
              </Button>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function InspectorStyleRow({
  field,
  style,
  origin,
  own,
  fonts,
  fallbackColor,
  onChange,
}: {
  field: StyleField;
  style: ResolvedStyle;
  origin: Origin;
  own: boolean;
  fonts: readonly string[];
  fallbackColor: string;
  onChange: (v: Json) => void;
}) {
  const value = style[field.key];
  const reset = own
    ? () => {
        onChange(null);
      }
    : undefined;
  let control;
  switch (field.kind) {
    case "enum":
      control =
        field.options.length <= 3 ? (
          <Segmented
            label={field.label}
            value={typeof value === "string" ? value : ""}
            options={field.options}
            onChange={onChange}
          />
        ) : (
          <Select
            label={field.label}
            value={typeof value === "string" ? value : ""}
            options={field.options}
            onChange={onChange}
          />
        );
      break;
    case "range":
      control = (
        <RangeField
          label={field.label}
          value={Number(value)}
          min={field.min}
          max={field.max}
          step={field.step}
          unit={field.unit}
          ends={field.ends}
          onCommit={onChange}
        />
      );
      break;
    case "optional-range":
      control =
        value === null ? (
          <Button
            variant="outlined"
            onClick={() => {
              onChange(field.min + Math.round((field.max - field.min) / 2));
            }}
          >
            {field.nullLabel} · Set
          </Button>
        ) : (
          <RangeField
            label={field.label}
            value={Number(value)}
            min={field.min}
            max={field.max}
            step={field.step}
            unit={field.unit}
            onCommit={onChange}
          />
        );
      break;
    case "color":
      control = (
        <ColorField
          label={field.label}
          value={typeof value === "string" ? value : null}
          fallback={fallbackColor}
          nullLabel={field.nullLabel}
          onChange={onChange}
        />
      );
      break;
    case "bool":
      control = <Toggle label={field.label} checked={Boolean(value)} onChange={onChange} />;
      break;
    case "font":
      control = (
        <FontField
          label={field.label}
          value={typeof value === "string" ? value : ""}
          fonts={fonts}
          onChange={onChange}
        />
      );
      break;
    case "text":
      control = (
        <TextField
          label={field.label}
          value={typeof value === "string" ? value : ""}
          maxLength={field.maxLength}
          onCommit={(v) => {
            onChange(v.trim() === "" ? null : v);
          }}
        />
      );
      break;
    case "structured":
      return null;
  }
  return (
    <Row label={field.label} help={field.help} origin={origin} onReset={reset}>
      {control}
    </Row>
  );
}

export default Inspector;
