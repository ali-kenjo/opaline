// Content tab of the live Inspector (PLAN-2 5.1): title, field toggles/order/rename, hero &
// hero style, decimals, update rate, widget-specific options, live source pickers, and weather
// location search.
import { useEffect, useState } from "react";
import { Button } from "../design-system/components";
import { Icon } from "../design-system/icons";
import {
  HERO_STYLE_LABELS,
  HISTORY_MINUTES,
  UPDATE_RATES,
  resolveContent,
} from "../widgets/content";
import { useHost } from "../widgets/host";
import { type Json, toJson } from "../widgets/json";
import {
  RangeField,
  Row,
  Segmented,
  Select,
  TextField,
  Thresholds,
  Toggle,
} from "../widgets/settings/controls";
import styles from "../widgets/settings/settings.module.css";
import type { ContentOption, WidgetDef } from "../widgets/types";

export function ContentTab({
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
