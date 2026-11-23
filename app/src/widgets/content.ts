// A widget's content settings (ADR 0011): the common ones (title, fields, order, labels, hero,
// hero style, history, decimals, update rate) plus its own options, read leniently from
// `settings.json` with defaults for anything missing or invalid.
import type { CommonContent, ContentOption, HeroStyle, WidgetDef } from "./types";

export const HERO_STYLE_LABELS: Record<HeroStyle, string> = {
  ring: "Ring",
  bar: "Bar",
  sparkline: "Graph",
  number: "Number only",
};

export const UPDATE_RATES = [
  { value: "fast", label: "Fast" },
  { value: "normal", label: "Normal" },
  { value: "relaxed", label: "Relaxed (saves power)" },
] as const;

export const HISTORY_MINUTES = [1, 5, 15, 60] as const;

const MAX_LABEL = 40;

export interface ResolvedContent extends CommonContent {
  /** A widget option's value (falls back to its default). */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed by the caller, who declared the option
  opt<T extends string | number | boolean | readonly [number, number]>(key: string): T;
  /** The user's label for a field, else its built-in label. */
  label(fieldId: string, builtIn: string): string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validOption(o: ContentOption, v: unknown): boolean {
  switch (o.kind) {
    case "enum":
      return o.options.some((c) => c.value === v);
    case "bool":
      return typeof v === "boolean";
    case "range":
      return typeof v === "number" && Number.isFinite(v) && v >= o.min && v <= o.max;
    case "text":
      return typeof v === "string" && v.length <= o.maxLength;
    case "source":
    case "location":
      return typeof v === "string" && v.length <= 128;
    case "thresholds":
      return (
        Array.isArray(v) &&
        v.length === 2 &&
        v.every((x) => typeof x === "number" && x >= o.min && x <= o.max) &&
        (v[0] as number) <= (v[1] as number)
      );
  }
}

export function defaultContent(def: WidgetDef): CommonContent {
  const heroable = def.fields.filter((f) => f.hero !== false && def.defaultFields.includes(f.id));
  return {
    title: def.name,
    showTitle: true,
    fields: [...def.defaultFields],
    labels: {},
    hero: heroable[0]?.id ?? "",
    heroStyle: def.heroStyles?.[0] ?? "number",
    historyMinutes: 5,
    decimals: 0,
    updateRate: "normal",
  };
}

export function resolveContent(def: WidgetDef, raw: unknown): ResolvedContent {
  const c = isRecord(raw) ? raw : {};
  const base = defaultContent(def);
  const known = new Set(def.fields.map((f) => f.id));

  const fields = Array.isArray(c.fields)
    ? [...new Set(c.fields.filter((f): f is string => typeof f === "string" && known.has(f)))]
    : base.fields;
  const labels: Record<string, string> = {};
  if (isRecord(c.labels)) {
    for (const [k, v] of Object.entries(c.labels)) {
      if (known.has(k) && typeof v === "string" && v.trim() && v.length <= MAX_LABEL) labels[k] = v;
    }
  }
  const heroOk = (id: unknown): id is string =>
    typeof id === "string" &&
    fields.includes(id) &&
    def.fields.some((f) => f.id === id && f.hero !== false);
  const hero = heroOk(c.hero)
    ? c.hero
    : (fields.find((id) => heroOk(id)) ?? (fields.length ? "" : base.hero));
  const heroStyle =
    typeof c.heroStyle === "string" && (def.heroStyles ?? []).includes(c.heroStyle as HeroStyle)
      ? (c.heroStyle as HeroStyle)
      : base.heroStyle;

  const values: Record<string, unknown> = {};
  for (const o of def.options ?? [])
    values[o.key] = validOption(o, c[o.key]) ? c[o.key] : o.default;

  return {
    title: typeof c.title === "string" && c.title.length <= MAX_LABEL ? c.title : base.title,
    showTitle: typeof c.showTitle === "boolean" ? c.showTitle : base.showTitle,
    fields,
    labels,
    hero,
    heroStyle,
    historyMinutes:
      typeof c.historyMinutes === "number" &&
      (HISTORY_MINUTES as readonly number[]).includes(c.historyMinutes)
        ? c.historyMinutes
        : base.historyMinutes,
    decimals:
      typeof c.decimals === "number" && [0, 1, 2].includes(c.decimals) ? c.decimals : base.decimals,
    updateRate:
      c.updateRate === "fast" || c.updateRate === "relaxed" || c.updateRate === "normal"
        ? c.updateRate
        : base.updateRate,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- see ResolvedContent.opt
    opt<T>(key: string): T {
      return values[key] as T;
    },
    label(fieldId: string, builtIn: string) {
      return labels[fieldId] ?? builtIn;
    },
  };
}
