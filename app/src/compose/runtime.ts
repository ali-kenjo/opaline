// The binding runtime of a composition (PLAN-2 2.4, 2.7; docs/COMPOSITION.md). Every expression
// is compiled once. Reading one evaluates it lazily and remembers exactly what it read (each
// topic's value object, each binding's value, each option); the next read re-evaluates only when
// one of those changed or the clock passed the step its formats need. Idle means zero
// evaluations: `evaluations` counts them so tests and the Lab can prove it (spike S10).
import {
  Diagnostic,
  Program,
  type Agg,
  type Host,
  type Key,
  type Locale,
  type Outcome,
  type Value,
} from "../expr";
import { at as valueAt } from "../expr/value";
import type { Value as Wire } from "../layer/protocol";
import type { Composition, Node } from "./model.gen";

export interface Env {
  /** The latest topic values (the layer store's objects; unchanged topics keep their object). */
  topics: Readonly<Record<string, Wire | undefined>>;
  /** Content settings, read as `opt.<key>`. */
  options: Readonly<Record<string, Value>>;
  locale: Locale;
  now(): number;
  date?(ms: number, skeleton: string, zone: string | undefined): string | null;
  ramp?(t: number, name: string): string | null;
  history?(path: string, agg: Agg, windowSecs: number): number | null;
}

/** Names a list item or a control adds. */
export interface Scope {
  item?: Value;
  index?: number;
  /** A control's new value (`$value` in its command's arguments). */
  value?: Value;
}

/** Which fields of each node type hold expressions (E) and templates (T); mirrors the Rust
 * validator (crates/opaline-compose/src/lib.rs). */
const FIELDS: Record<string, { e?: string[]; t?: string[]; tLists?: string[]; eMaps?: string[] }> =
  {
    text: { t: ["text"], tLists: ["shorter"] },
    number: { e: ["value"], t: ["text", "unit"] },
    icon: { e: ["filled"], t: ["icon"] },
    image: { e: ["src"] },
    shape: { e: ["color"], t: ["shape"] },
    ring: { e: ["value", "color"] },
    bar: { e: ["value", "color"] },
    chart: { e: ["values"] },
    heatmap: { e: ["values"] },
    list: { e: ["items"] },
    progress: { e: ["value"] },
    canvas: { eMaps: ["params"] },
    button: { e: ["enabled"], t: ["text", "icon", "confirm"] },
    toggle: { e: ["value"], t: ["text"] },
    slider: { e: ["value"] },
    input: { e: ["value"], t: ["placeholder"] },
    plugin: { eMaps: ["props"] },
  };

const NONE: Outcome = { value: null, errors: [], missing: true };

interface Memo {
  outcome: Outcome;
  /** Every name the evaluation looked up, with the identity of what it found. */
  deps: Map<string, unknown>;
  /** Re-evaluate from this time on (ms), for programs that read the clock. */
  nextAt: number;
}

const converted = new WeakMap<object, Value>();

/** Evaluations by every runtime in this window (the Lab shows it; spike S10). */
export const evaluationCount = { total: 0 };

/** A wire value as an expression value (cached per object, so identity means "unchanged"). */
export function fromWire(w: Wire | undefined): Value {
  if (w === undefined) return null;
  const hit = converted.get(w);
  if (hit !== undefined) return hit;
  let v: Value;
  switch (w.kind) {
    case "num":
    case "text":
    case "bool":
      v = w.v;
      break;
    case "nums":
      v = [...w.v];
      break;
    case "list":
      v = w.v.map(fromWire);
      break;
    case "map":
      v = Object.fromEntries(Object.entries(w.v).map(([k, x]) => [k, fromWire(x)]));
      break;
    case "missing":
      v = null;
      break;
  }
  converted.set(w, v);
  return v;
}

function* nodes(n: Node, at: string): Generator<[Node, string]> {
  yield [n, at];
  if ("children" in n) {
    for (const [i, c] of n.children.entries()) yield* nodes(c, `${at}/children/${String(i)}`);
  }
  if (n.type === "list") yield* nodes(n.item, `${at}/item`);
}

const escape = (k: string) => k.replace(/~/g, "~0").replace(/\//g, "~1");

export class Runtime {
  /** Compiled programs by source id (the JSON pointer of the field). */
  private readonly sources = new Map<string, Program | Diagnostic>();
  private readonly memo = new Map<string, Memo>();
  private readonly evaluating = new Set<string>();
  /** Memo keys read since the last `settle()` (what the view drew in its latest pass). */
  private readonly touched = new Set<string>();
  private readonly topicNames: readonly string[];
  /** Evaluations so far (spike S10: zero while idle). */
  evaluations = 0;

  constructor(
    readonly composition: Composition,
    private env: Env,
  ) {
    const add = (id: string, src: string | undefined, kind: "expression" | "template") => {
      if (src !== undefined) this.sources.set(id, Program.compile(src, kind));
    };
    for (const [name, e] of Object.entries(composition.bindings ?? {})) {
      add(`/bindings/${escape(name)}`, e, "expression");
    }
    composition.layouts.forEach((layout, i) => {
      for (const [n, at] of nodes(layout.root, `/layouts/${String(i)}/root`)) {
        add(`${at}/visible`, n.visible, "expression");
        add(`${at}/label`, n.label, "template");
        const f = FIELDS[n.type] ?? {};
        const fields = n as unknown as Record<string, unknown>;
        for (const k of f.e ?? []) add(`${at}/${k}`, fields[k] as string | undefined, "expression");
        for (const k of f.t ?? []) add(`${at}/${k}`, fields[k] as string | undefined, "template");
        for (const k of f.tLists ?? []) {
          const list = (fields[k] as string[] | undefined) ?? [];
          list.forEach((t, j) => {
            add(`${at}/${k}/${String(j)}`, t, "template");
          });
        }
        for (const k of f.eMaps ?? []) {
          for (const [name, e] of Object.entries(
            (fields[k] as Record<string, string> | undefined) ?? {},
          )) {
            add(`${at}/${k}/${escape(name)}`, e, "expression");
          }
        }
        if ("command" in n) {
          for (const [name, e] of Object.entries(n.command.args ?? {})) {
            add(`${at}/command/args/${escape(name)}`, e, "expression");
          }
        }
      }
    });
    const topics = new Set<string>();
    const paths: string[] = [];
    for (const p of this.sources.values()) {
      if (!(p instanceof Diagnostic)) paths.push(...p.paths());
    }
    // Charts over core's history follow their path's live value too.
    composition.layouts.forEach((layout) => {
      for (const [n] of nodes(layout.root, ""))
        if (n.type === "chart" && n.history) paths.push(n.history.path);
    });
    {
      for (const path of paths) {
        if (/^(bind|opt)\./.test(path) || path.startsWith("$")) continue;
        const segs = path.split(".");
        for (let n = segs.length; n >= 1; n--) topics.add(segs.slice(0, n).join("."));
      }
    }
    this.topicNames = [...topics].sort();
  }

  /** The topics to subscribe to: every prefix a path could resolve to (§5 of EXPRESSIONS.md). */
  topics(): readonly string[] {
    return this.topicNames;
  }

  /** A data path's current value (longest topic prefix), without remembering anything. */
  value(path: string): Value {
    const segs = path.split(".");
    for (let n = segs.length; n >= 1; n--) {
      const w = this.env.topics[segs.slice(0, n).join(".")];
      if (w !== undefined)
        return valueAt(
          fromWire(w),
          segs.slice(n).map((field) => ({ field })),
        );
    }
    return null;
  }

  setEnv(env: Env): void {
    this.env = env;
  }

  /** Compile errors, by source id. */
  problems(): [string, Diagnostic][] {
    return [...this.sources].filter((e): e is [string, Diagnostic] => e[1] instanceof Diagnostic);
  }

  has(source: string): boolean {
    return this.sources.has(source);
  }

  /** The earliest time (ms) a remembered result that reads the clock goes stale, if any. */
  nextWake(): number | null {
    let next = Infinity;
    for (const m of this.memo.values()) next = Math.min(next, m.nextAt);
    return Number.isFinite(next) ? next : null;
  }

  /** Ends a render pass: the earliest time (ms) a result read since the last call goes stale, if
   * any. Unlike `nextWake`, results nothing reads any more (another size's layout, a hidden face)
   * don't count: they stay stale, and waking for them would never make them fresh. */
  settle(): number | null {
    let next = Infinity;
    for (const key of this.touched) {
      const m = this.memo.get(key);
      if (m) next = Math.min(next, m.nextAt);
    }
    this.touched.clear();
    return Number.isFinite(next) ? next : null;
  }

  /** The time (ms) on the clock the expressions read. */
  now(): number {
    return this.env.now();
  }

  /** Forgets remembered list items from `count` on for every field under `prefix` (the list's
   * item, `/layouts/0/root/item`): the list got shorter. */
  trimItems(prefix: string, count: number): void {
    for (const key of this.memo.keys()) {
      const hash = key.lastIndexOf("#");
      if (hash > 0 && key.startsWith(`${prefix}/`) && Number(key.slice(hash + 1)) >= count) {
        this.memo.delete(key);
      }
    }
  }

  private lookup(
    name: string,
    scope: Scope | undefined,
  ): { exists: boolean; value: Value; ref: unknown } {
    if (name.startsWith("$")) {
      const v =
        name === "$item"
          ? scope?.item
          : name === "$index"
            ? scope?.index
            : name === "$value"
              ? scope?.value
              : undefined;
      return { exists: v !== undefined, value: v ?? null, ref: v };
    }
    if (name.startsWith("bind.")) {
      const id = `/bindings/${escape(name.slice(5))}`;
      if (name.slice(5).includes(".") || !this.sources.has(id))
        return { exists: false, value: null, ref: undefined };
      const v = this.read(id).value;
      return { exists: true, value: v, ref: v };
    }
    if (name.startsWith("opt.")) {
      const k = name.slice(4);
      if (!Object.hasOwn(this.env.options, k))
        return { exists: false, value: null, ref: undefined };
      const v = this.env.options[k] ?? null;
      return { exists: true, value: v, ref: v };
    }
    const w = this.env.topics[name];
    return { exists: w !== undefined, value: fromWire(w), ref: w };
  }

  private fresh(m: Memo, scope: Scope | undefined): boolean {
    if (this.env.now() >= m.nextAt) return false;
    for (const [name, ref] of m.deps) {
      if (!Object.is(this.lookup(name, scope).ref, ref)) return false;
    }
    return true;
  }

  /** The current outcome of one field (`/layouts/0/root/children/1/text`). */
  read(source: string, scope?: Scope): Outcome {
    const p = this.sources.get(source);
    if (p === undefined) return NONE;
    if (p instanceof Diagnostic) return { value: null, errors: [p], missing: false };
    const key = scope?.index !== undefined ? `${source}#${String(scope.index)}` : source;
    const memoize = scope?.value === undefined;
    const m = memoize ? this.memo.get(key) : undefined;
    if (m && this.fresh(m, scope)) {
      this.touched.add(key);
      return m.outcome;
    }
    // A binding that reaches itself (validation rejects it; guard anyway) is "no value".
    if (this.evaluating.has(key)) return NONE;
    this.evaluating.add(key);
    try {
      const deps = new Map<string, unknown>();
      let usesNow = false as boolean;
      let step = Infinity;
      const env = this.env;
      const host: Host = {
        hasTopic: (n) => {
          const r = this.lookup(n, scope);
          deps.set(n, r.ref);
          return r.exists;
        },
        topic: (n, keys: readonly Key[]) => {
          const r = this.lookup(n, scope);
          deps.set(n, r.ref);
          return valueAt(r.value, keys);
        },
        nowMs: () => {
          usesNow = true;
          return env.now();
        },
        locale: () => env.locale,
        history: (path, agg, secs) => {
          // History moves when its topic does.
          deps.set(path, this.lookup(path, scope).ref);
          return env.history?.(path, agg, secs) ?? null;
        },
        date: (ms, skeleton, zone) => {
          step = Math.min(step, /[sS]/.test(skeleton) ? 1000 : 60_000);
          return env.date?.(ms, skeleton, zone) ?? null;
        },
        ramp: (t, name) => env.ramp?.(t, name) ?? null,
      };
      this.evaluations++;
      evaluationCount.total++;
      const outcome = p.eval(host);
      if (memoize) {
        let nextAt = Infinity;
        if (usesNow) {
          // Formats set the step (a HH:mm clock wakes once a minute); raw time and until() tick
          // every second.
          if (!Number.isFinite(step) || p.calls().has("until")) step = 1000;
          const now = env.now();
          nextAt = (Math.floor(now / step) + 1) * step;
        }
        this.memo.set(key, { outcome, deps, nextAt });
        this.touched.add(key);
      }
      return outcome;
    } finally {
      this.evaluating.delete(key);
    }
  }
}
