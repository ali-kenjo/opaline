// The 6-layer style cascade (ADR 0011, brief §5.1):
// built-in default → theme → global user style → widget kind → widget instance → element (role/id).
// Plus ordered conditional styles evaluated through the Opaline expression engine.
import { type Host as ExprHost, type Value as ExprValue, Program, mapHost } from "../../expr";
import { FIELD_BY_KEY, validValue } from "./fields";
import {
  BUILTIN_STYLE,
  type ConditionalStyle,
  type ResolvedStyle,
  STYLE_KEYS,
  type Style,
  type StyleKey,
} from "./types";

export type Origin = "default" | "theme" | "global" | "kind" | "widget" | "element";

export interface Resolution {
  style: ResolvedStyle;
  /** Where each value comes from, for the inspector's "inherited" labels and reset buttons. */
  origin: Record<StyleKey, Origin>;
}

/** Optional layers of the 6-step cascade; any omitted layer is skipped cleanly. */
export interface StyleCascade {
  theme?: Style | undefined;
  global?: Style | undefined;
  themeKind?: Style | undefined;
  kind?: Style | undefined;
  widget?: Style | undefined;
  themeElement?: Style | undefined;
  element?: Style | undefined;
}

/** Keeps only known keys with valid values (a stored file may be old or hand-edited). */
export function sanitizeStyle(raw: unknown): Style {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const field = FIELD_BY_KEY.get(k as StyleKey);
    if (field && validValue(field, v)) out[k] = v;
  }
  return out;
}

/**
 * Resolves the full 6-layer cascade (`default → theme → global → kind → widget → element`).
 * Theme-level per-kind and per-element layers have origin `"theme"` unless overridden by user
 * layers (`"global"`, `"kind"`, `"widget"`, `"element"`).
 */
export function resolveCascade(layers: StyleCascade): Resolution {
  const style = { ...BUILTIN_STYLE } as Record<StyleKey, unknown>;
  const origin = {} as Record<StyleKey, Origin>;
  for (const key of STYLE_KEYS) {
    origin[key] = "default";
  }
  const ordered: readonly [Style | undefined, Origin][] = [
    [layers.theme, "theme"],
    [layers.themeKind, "theme"],
    [layers.global, "global"],
    [layers.kind, "kind"],
    [layers.widget, "widget"],
    [layers.themeElement, "theme"],
    [layers.element, "element"],
  ];
  for (const [layer, source] of ordered) {
    if (!layer) continue;
    for (const key of STYLE_KEYS) {
      const value = layer[key];
      if (value === undefined) continue;
      // Merge per-role typography maps so a child layer overrides only the roles it names.
      if (key === "roles" && style.roles && typeof style.roles === "object") {
        style.roles = {
          ...(style.roles as Record<string, unknown>),
          ...(value as Record<string, unknown>),
        };
      } else {
        style[key] = value;
      }
      origin[key] = source;
    }
  }
  return { style: style as unknown as ResolvedStyle, origin };
}

/**
 * Resolves a widget's style. Backwards-compatible 2-argument form (`global`, `own`) plus optional
 * cascade layers (`theme`, `themeKind`, `kind`, `element`).
 */
export function resolveStyle(
  global: Style = {},
  own: Style = {},
  extra: Omit<StyleCascade, "global" | "widget"> = {},
): Resolution {
  return resolveCascade({ ...extra, global, widget: own });
}

/** A merge patch that sets one key, or resets it to inherit with `null`. */
export function stylePatch(key: StyleKey, value: unknown): Record<string, unknown> {
  return { [key]: value ?? null };
}

const compiledCache = new Map<string, Program | null>();

function getCompiled(expr: string): Program | null {
  if (compiledCache.has(expr)) return compiledCache.get(expr) ?? null;
  const res = Program.compile(expr, "expression");
  const program = res instanceof Program ? res : null;
  if (compiledCache.size > 256) compiledCache.clear();
  compiledCache.set(expr, program);
  return program;
}

export interface ConditionEvaluation {
  style: ResolvedStyle;
  /** Indices of the rules that matched (for inspector live previews and animations). */
  matched: readonly number[];
  /** True when at least one matched rule requests animation (default true). */
  animate: boolean;
}

/**
 * Evaluates a resolved style's ordered `conditions` against live topic values and applies every
 * matching rule's `set` keys in order. Never throws; malformed expressions are skipped safely.
 */
export function applyConditionalStyles(base: ResolvedStyle, host: ExprHost): ConditionEvaluation {
  const rules: readonly ConditionalStyle[] | null = base.conditions;
  if (!rules || rules.length === 0) {
    return { style: base, matched: [], animate: false };
  }
  let next: Record<StyleKey, unknown> | null = null;
  const matched: number[] = [];
  let animate = false;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (!rule) continue;
    const program = getCompiled(rule.when);
    if (!program) continue;
    const out = program.eval(host);
    if (out.value === true) {
      matched.push(i);
      if (rule.animate !== false) animate = true;
      const clean = sanitizeStyle(rule.set);
      next ??= { ...base };
      for (const [k, v] of Object.entries(clean)) {
        if (k === "conditions") continue;
        next[k as StyleKey] = v;
      }
    }
  }
  return {
    style: (next ?? base) as unknown as ResolvedStyle,
    matched,
    animate,
  };
}

/** Convenience helper to build an expression host from plain JS/JSON topic values. */
export function exprHostFromTopics(
  topics: Readonly<Record<string, ExprValue>>,
  now: () => number = () => Date.now(),
): ExprHost {
  return mapHost(topics, { nowMs: now, locale: () => "en" });
}
