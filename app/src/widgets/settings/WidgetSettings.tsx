// The settings sheet of a widget (ADR 0011), built from the widget's fields and options and from
// the style descriptions: Content (what it shows) and Style (how it looks), the latter for this
// widget or for all widgets, with "inherited" labels, resets, copying and named styles.
import { useEffect, useMemo, useState } from "react";
import { Button, Sheet } from "../../design-system/components";
import { Icon, type IconName } from "../../design-system/icons";
import {
  type ResolvedStyle,
  STYLE_FIELDS,
  STYLE_GROUPS,
  type Style,
  type StyleField,
  type StyleKey,
  resolveStyle,
  rolesFor,
  sanitizeStyle,
} from "../../design-system/style";
import { HERO_STYLE_LABELS, HISTORY_MINUTES, UPDATE_RATES, resolveContent } from "../content";
import { useHost } from "../host";
import { type Json, toJson } from "../json";
import type { ContentOption, WidgetDef } from "../types";
import {
  ColorField,
  FontField,
  RangeField,
  Row,
  Segmented,
  Select,
  TextField,
  Thresholds,
  Toggle,
} from "./controls";
import styles from "./settings.module.css";

export interface WidgetSettingsProps {
  id: string;
  def: WidgetDef;
  open: boolean;
  onClose: () => void;
}

type Tab = "content" | "style";
type Scope = "widget" | "global";

function argbHex(argb: number): string {
  return `#${(argb & 0xffffff).toString(16).padStart(6, "0")}`;
}

export function WidgetSettings({ id, def, open, onClose }: WidgetSettingsProps) {
  const host = useHost();
  const [tab, setTab] = useState<Tab>("content");
  const [scope, setScope] = useState<Scope>("widget");
  const [fonts, setFonts] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

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
  const globalStyle = useMemo(() => sanitizeStyle(host.settings.style), [host.settings.style]);
  const ownStyle = useMemo(() => sanitizeStyle(stored?.style), [stored?.style]);
  const resolution = useMemo(
    () =>
      scope === "widget" ? resolveStyle(globalStyle, ownStyle) : resolveStyle({}, globalStyle),
    [scope, globalStyle, ownStyle],
  );
  const content = useMemo(() => resolveContent(def, stored?.content), [def, stored?.content]);
  const roles = rolesFor(resolution.style, host.colors);

  const save = (patch: Record<string, Json>) => {
    host
      .updateSettings(patch)
      .then((r) => {
        setMessage(r.result === "err" ? `Couldn't save (${r.reason})` : null);
      })
      .catch(() => {
        setMessage("Couldn't save");
      });
  };
  const saveWidget = (part: Record<string, Json>) => {
    save({ widgets: { [id]: { kind: def.kind, ...part } } });
  };
  const setStyle = (key: StyleKey, value: Json) => {
    if (scope === "global") save({ style: { [key]: value } });
    else saveWidget({ style: { [key]: value } });
  };
  const setContent = (key: string, value: Json) => {
    saveWidget({ content: { [key]: value } });
  };

  return (
    <Sheet open={open} onClose={onClose} label={`${content.title} settings`}>
      <div className={styles.sheet}>
        <div className={styles.top}>
          <Icon name={def.icon} size={24} />
          <h2 className={styles.heading}>{content.title || def.name}</h2>
          <Segmented
            label="Section"
            value={tab}
            options={[
              { value: "content", label: "Content" },
              { value: "style", label: "Style" },
            ]}
            onChange={(v) => {
              setTab(v as Tab);
            }}
          />
          <Button variant="text" icon="close" label="Close settings" onClick={onClose} />
        </div>
        {message ? (
          <div className={styles.message} role="alert">
            {message}
          </div>
        ) : null}
        <div className={styles.scroll}>
          {tab === "content" ? (
            <ContentTab def={def} content={content} setContent={setContent} />
          ) : (
            <>
              <div className={styles.scopeBar}>
                <Segmented
                  label="Apply to"
                  value={scope}
                  options={[
                    { value: "widget", label: "This widget" },
                    { value: "global", label: "All widgets" },
                  ]}
                  onChange={(v) => {
                    setScope(v as Scope);
                  }}
                />
                <StyleActions
                  id={id}
                  def={def}
                  scope={scope}
                  own={ownStyle}
                  global={globalStyle}
                  named={host.settings.styles}
                  save={save}
                />
              </div>
              {STYLE_GROUPS.map((g) => {
                const fields = STYLE_FIELDS.filter(
                  (f) => f.group === g.id && (!f.when || f.when(resolution.style)),
                );
                return (
                  <section key={g.id} className={styles.group} aria-label={g.label}>
                    <h3 className={styles.groupTitle}>
                      <Icon name={g.icon as IconName} size={18} /> {g.label}
                    </h3>
                    {fields.map((f) => (
                      <StyleRow
                        key={f.key}
                        field={f}
                        style={resolution.style}
                        origin={resolution.origin[f.key]}
                        own={
                          scope === "widget"
                            ? resolution.origin[f.key] === "widget"
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
                          setStyle(f.key, v);
                        }}
                      />
                    ))}
                  </section>
                );
              })}
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function StyleRow({
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
  origin: "default" | "global" | "widget";
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
            value={String(value)}
            options={field.options}
            onChange={onChange}
          />
        ) : (
          <Select
            label={field.label}
            value={String(value)}
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
        <FontField label={field.label} value={String(value)} fonts={fonts} onChange={onChange} />
      );
      break;
  }
  return (
    <Row label={field.label} help={field.help} origin={origin} onReset={reset}>
      {control}
    </Row>
  );
}

function StyleActions({
  id,
  def,
  scope,
  own,
  global,
  named,
  save,
}: {
  id: string;
  def: WidgetDef;
  scope: Scope;
  own: Style;
  global: Style;
  named: Record<string, Style>;
  save: (patch: Record<string, Json>) => void;
}) {
  const host = useHost();
  const [name, setName] = useState("");
  const current = scope === "widget" ? own : global;
  const names = Object.keys(named).sort();
  const clear = (s: Style): Record<string, Json> =>
    Object.fromEntries(Object.keys(s).map((k) => [k, null]));
  const apply = (s: Style) => {
    // Replace: clear what's set now, then set the named style's values.
    const next: Record<string, Json> = { ...clear(current), ...(s as Record<string, Json>) };
    if (scope === "global") save({ style: next });
    else save({ widgets: { [id]: { kind: def.kind, style: next } } });
  };
  const sameKind = Object.entries(host.settings.widgets).filter(
    ([wid, w]) => w.kind === def.kind && wid !== id,
  );

  return (
    <div className={styles.actions}>
      <Button
        variant="tonal"
        icon="restart_alt"
        disabled={Object.keys(current).length === 0}
        onClick={() => {
          apply({});
        }}
      >
        {scope === "widget" ? "Reset this widget's style" : "Reset style of all widgets"}
      </Button>
      {scope === "widget" ? (
        <Button
          variant="tonal"
          icon="content_copy"
          disabled={sameKind.length === 0 || Object.keys(own).length === 0}
          onClick={() => {
            const patch: Record<string, Json> = {};
            for (const [wid, w] of sameKind)
              patch[wid] = {
                kind: w.kind,
                style: { ...clear(sanitizeStyle(w.style)), ...(own as Record<string, Json>) },
              };
            save({ widgets: patch });
          }}
        >
          Copy to other {def.name} widgets
        </Button>
      ) : null}
      {scope === "widget" ? (
        <Button
          variant="tonal"
          icon="format_paint"
          disabled={Object.keys(own).length === 0}
          onClick={() => {
            save({ style: own });
          }}
        >
          Use for all widgets
        </Button>
      ) : null}
      <div className={styles.named}>
        <TextField
          label="Style name"
          value={name}
          maxLength={60}
          placeholder="Name this style"
          onCommit={setName}
        />
        <Button
          variant="outlined"
          icon="bookmark"
          disabled={name.trim() === "" || Object.keys(current).length === 0}
          onClick={() => {
            save({ styles: { [name.trim()]: current as Record<string, Json> } });
          }}
        >
          Save style
        </Button>
        {names.length ? (
          <Select
            label="Apply a saved style"
            value=""
            options={[
              { value: "", label: "Apply a saved style…" },
              ...names.map((n) => ({ value: n, label: n })),
            ]}
            onChange={(n) => {
              const s = named[n];
              if (s) apply(sanitizeStyle(s));
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function ContentTab({
  def,
  content,
  setContent,
}: {
  def: WidgetDef;
  content: ReturnType<typeof resolveContent>;
  setContent: (key: string, value: Json) => void;
}) {
  const visible = content.fields;
  const hidden = def.fields.filter((f) => !visible.includes(f.id));
  const heroable = visible.filter((fid) =>
    def.fields.some((f) => f.id === fid && f.hero !== false),
  );
  const move = (fid: string, by: number) => {
    const i = visible.indexOf(fid);
    const j = i + by;
    if (i < 0 || j < 0 || j >= visible.length) return;
    const next = [...visible];
    [next[i], next[j]] = [next[j] ?? fid, fid];
    setContent("fields", next);
  };

  return (
    <>
      <section className={styles.group} aria-label="Title">
        <h3 className={styles.groupTitle}>
          <Icon name="text_fields" size={18} /> Title
        </h3>
        <Row label="Show title">
          <Toggle
            label="Show title"
            checked={content.showTitle}
            onChange={(v) => {
              setContent("showTitle", v);
            }}
          />
        </Row>
        <Row label="Title">
          <TextField
            label="Title"
            value={content.title}
            maxLength={40}
            placeholder={def.name}
            onCommit={(v) => {
              setContent("title", v);
            }}
          />
        </Row>
      </section>

      <section className={styles.group} aria-label="Shown information">
        <h3 className={styles.groupTitle}>
          <Icon name="reorder" size={18} /> Shown information
        </h3>
        <p className={styles.help}>
          Turn items on or off, put them in order and rename them. The first rows fit small sizes.
        </p>
        <ul className={styles.fieldList}>
          {visible.map((fid, i) => {
            const f = def.fields.find((x) => x.id === fid);
            if (!f) return null;
            return (
              <li key={fid} className={styles.fieldItem}>
                <Toggle
                  label={`Show ${f.label}`}
                  checked
                  onChange={() => {
                    setContent(
                      "fields",
                      visible.filter((x) => x !== fid),
                    );
                  }}
                />
                {f.icon ? <Icon name={f.icon} size={18} /> : null}
                <TextField
                  label={`Name of ${f.label}`}
                  value={content.labels[fid] ?? ""}
                  maxLength={40}
                  placeholder={f.label}
                  onCommit={(v) => {
                    setContent("labels", { [fid]: v.trim() === "" ? null : v });
                  }}
                />
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={`Move ${f.label} up`}
                  disabled={i === 0}
                  onClick={() => {
                    move(fid, -1);
                  }}
                >
                  <Icon name="keyboard_arrow_up" size={20} />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={`Move ${f.label} down`}
                  disabled={i === visible.length - 1}
                  onClick={() => {
                    move(fid, 1);
                  }}
                >
                  <Icon name="keyboard_arrow_down" size={20} />
                </button>
              </li>
            );
          })}
          {hidden.map((f) => (
            <li key={f.id} className={`${styles.fieldItem} ${styles.fieldOff}`}>
              <Toggle
                label={`Show ${f.label}`}
                checked={false}
                onChange={() => {
                  setContent("fields", [...visible, f.id]);
                }}
              />
              {f.icon ? <Icon name={f.icon} size={18} /> : null}
              <span>{content.labels[f.id] ?? f.label}</span>
            </li>
          ))}
        </ul>
      </section>

      {def.heroStyles && heroable.length ? (
        <section className={styles.group} aria-label="Main value">
          <h3 className={styles.groupTitle}>
            <Icon name="star" size={18} /> Main value
          </h3>
          <Row label="Main value">
            <Select
              label="Main value"
              value={content.hero}
              options={heroable.map((fid) => ({
                value: fid,
                label: content.label(fid, def.fields.find((f) => f.id === fid)?.label ?? fid),
              }))}
              onChange={(v) => {
                setContent("hero", v);
              }}
            />
          </Row>
          <Row label="Shown as">
            <Segmented
              label="Shown as"
              value={content.heroStyle}
              options={def.heroStyles.map((h) => ({ value: h, label: HERO_STYLE_LABELS[h] }))}
              onChange={(v) => {
                setContent("heroStyle", v);
              }}
            />
          </Row>
          {content.heroStyle === "sparkline" ? (
            <Row label="Graph covers">
              <Segmented
                label="Graph covers"
                value={String(content.historyMinutes)}
                options={HISTORY_MINUTES.map((m) => ({
                  value: String(m),
                  label: m === 60 ? "1 h" : `${String(m)} min`,
                }))}
                onChange={(v) => {
                  setContent("historyMinutes", Number(v));
                }}
              />
            </Row>
          ) : null}
        </section>
      ) : null}

      <section className={styles.group} aria-label="Numbers and updates">
        <h3 className={styles.groupTitle}>
          <Icon name="tune" size={18} /> Numbers and updates
        </h3>
        <Row label="Decimals">
          <Segmented
            label="Decimals"
            value={String(content.decimals)}
            options={[
              { value: "0", label: "42" },
              { value: "1", label: "42.0" },
              { value: "2", label: "42.00" },
            ]}
            onChange={(v) => {
              setContent("decimals", Number(v));
            }}
          />
        </Row>
        <Row label="Updates" help="Relaxed shows new values every 5 seconds.">
          <Segmented
            label="Updates"
            value={content.updateRate}
            options={UPDATE_RATES}
            onChange={(v) => {
              setContent("updateRate", v);
            }}
          />
        </Row>
        {(def.options ?? []).map((o) => (
          <OptionRow
            key={o.key}
            option={o}
            value={content.opt(o.key)}
            onChange={(v) => {
              setContent(o.key, v);
            }}
          />
        ))}
      </section>
    </>
  );
}

function OptionRow({
  option,
  value,
  onChange,
}: {
  option: ContentOption;
  value: unknown;
  onChange: (v: Json) => void;
}) {
  let control;
  switch (option.kind) {
    case "enum":
      control =
        option.options.length <= 3 ? (
          <Segmented
            label={option.label}
            value={String(value)}
            options={option.options}
            onChange={onChange}
          />
        ) : (
          <Select
            label={option.label}
            value={String(value)}
            options={option.options}
            onChange={onChange}
          />
        );
      break;
    case "bool":
      control = <Toggle label={option.label} checked={Boolean(value)} onChange={onChange} />;
      break;
    case "range":
      control = (
        <RangeField
          label={option.label}
          value={Number(value)}
          min={option.min}
          max={option.max}
          step={option.step}
          unit={option.unit}
          onCommit={onChange}
        />
      );
      break;
    case "text":
      control = (
        <TextField
          label={option.label}
          value={String(value)}
          maxLength={option.maxLength}
          placeholder={option.placeholder}
          onCommit={onChange}
        />
      );
      break;
    case "thresholds":
      control = (
        <Thresholds
          label={option.label}
          value={value as readonly [number, number]}
          min={option.min}
          max={option.max}
          step={option.step}
          unit={option.unit}
          onCommit={(v) => {
            onChange(v);
          }}
        />
      );
      break;
    case "source":
      control = <SourceSelect option={option} value={String(value)} onChange={onChange} />;
      break;
    case "location":
      control = <LocationSearch />;
      break;
  }
  return (
    <Row label={option.label} help={option.help}>
      {control}
    </Row>
  );
}

function SourceSelect({
  option,
  value,
  onChange,
}: {
  option: Extract<ContentOption, { kind: "source" }>;
  value: string;
  onChange: (v: Json) => void;
}) {
  const host = useHost();
  useEffect(() => {
    host.subscribe([option.topic], "interactive");
  }, [host, option.topic]);
  const data = host.useValues((all) => all[option.topic]);
  const choices = option.choices(data);
  const known = choices.some((c) => c.value === value);
  return (
    <Select
      label={option.label}
      value={value}
      options={known ? choices : [...choices, { value, label: `${value} (not found)` }]}
      onChange={onChange}
    />
  );
}

interface Place {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

/** Weather location: search places through core (Open-Meteo geocoding), save globally. */
function LocationSearch() {
  const host = useHost();
  const current = host.useValues((all) => {
    const c = all["weather.current"];
    const name = c?.kind === "map" ? c.v.location : undefined;
    return name?.kind === "text" ? name.v : null;
  });
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const search = () => {
    const q = query.trim();
    if (q.length < 2) return;
    setStatus("Searching…");
    host
      .command({ cmd: "geocode-search", query: q, language: navigator.language.slice(0, 2) })
      .then((r) => {
        if (r.result !== "data" || r.value.kind !== "list") {
          setStatus(r.result === "err" ? `Search failed (${r.reason})` : "No places found");
          setPlaces([]);
          return;
        }
        const found = r.value.v.flatMap((v): Place[] => {
          const j = toJson(v);
          if (typeof j !== "object" || j === null || Array.isArray(j)) return [];
          const { name, latitude, longitude, country, admin1 } = j;
          return typeof name === "string" &&
            typeof latitude === "number" &&
            typeof longitude === "number"
            ? [
                {
                  name,
                  latitude,
                  longitude,
                  ...(typeof country === "string" ? { country } : {}),
                  ...(typeof admin1 === "string" ? { admin1 } : {}),
                },
              ]
            : [];
        });
        setPlaces(found);
        setStatus(found.length ? null : "No places found");
      })
      .catch(() => {
        setStatus("Search failed");
      });
  };
  return (
    <div className={styles.location}>
      <div className={styles.help}>{current ? `Now: ${current}` : "No location yet"}</div>
      <form
        className={styles.named}
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <input
          className={styles.text}
          type="search"
          value={query}
          placeholder="City"
          aria-label="Search a city"
          onChange={(e) => {
            setQuery(e.target.value);
          }}
        />
        <Button variant="outlined" icon="search" onClick={search}>
          Search
        </Button>
      </form>
      {status ? <div className={styles.help}>{status}</div> : null}
      {places.length ? (
        <ul className={styles.places}>
          {places.slice(0, 6).map((p) => (
            <li key={`${String(p.latitude)},${String(p.longitude)}`}>
              <button
                type="button"
                onClick={() => {
                  host
                    .updateSettings({
                      weather: {
                        location: {
                          name: p.name,
                          latitude: p.latitude,
                          longitude: p.longitude,
                          country: p.country ?? null,
                        },
                      },
                    })
                    .then(() => {
                      setStatus(`Saved: ${p.name}`);
                      setPlaces([]);
                    })
                    .catch(() => {
                      setStatus("Couldn't save");
                    });
                }}
              >
                <Icon name="location_on" size={16} /> {p.name}
                <span className={styles.help}>
                  {[p.admin1, p.country].filter(Boolean).join(", ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
