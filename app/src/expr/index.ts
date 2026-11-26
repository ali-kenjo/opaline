// The Opaline expression language (docs/EXPRESSIONS.md), layer side. Compile once, evaluate
// whenever an input changes; evaluation never throws. Rust twin: crates/opaline-expr.
import { Diagnostic } from "./diagnostic";
import { run, type Body, type Host, type Outcome } from "./eval";
import { parseExpression, parseTemplate, type Expr } from "./parser";
import { at, type Key, type Type, type Value } from "./value";

export { Diagnostic, MAX_DEPTH, MAX_LEN, type ErrorCode } from "./diagnostic";
export type { Agg, Host, Outcome } from "./eval";
export { localeFromTag, type Key, type Locale, type Type, type Value } from "./value";

export class Program {
  private constructor(private readonly body: Body) {}

  /** Compiles an expression; throws a `Diagnostic` with the error's position. */
  static expression(src: string): Program {
    return new Program({ expr: parseExpression(src) });
  }

  /** Compiles a template (`"{cpu.load | round}%"`); it always evaluates to a string. */
  static template(src: string): Program {
    return new Program({ template: parseTemplate(src) });
  }

  /** Like `expression`/`template`, but returns the diagnostic instead of throwing. */
  static compile(src: string, kind: "expression" | "template"): Program | Diagnostic {
    try {
      return kind === "expression" ? Program.expression(src) : Program.template(src);
    } catch (e) {
      if (e instanceof Diagnostic) return e;
      // A bug in the compiler must not take a widget down: report it like a parse error.
      return new Diagnostic("parse-error", 0, String(e));
    }
  }

  eval(host: Host): Outcome {
    try {
      return run(this.body, host);
    } catch (e) {
      // Errors never escape (§4); a throwing host counts as "no value".
      return { value: null, errors: [new Diagnostic("type-error", 0, String(e))], missing: true };
    }
  }

  private exprs(): Expr[] {
    if ("expr" in this.body) return [this.body.expr];
    return this.body.template.flatMap((p) => ("hole" in p ? [p.hole] : []));
  }

  /** The data paths this program reads, as written, for subscribing and for warnings. */
  paths(): string[] {
    const out = new Set<string>();
    walk(this.exprs(), (e) => {
      if (e.kind.k === "path") out.add(e.kind.p.segments.join("."));
    });
    return [...out];
  }

  /** Whether the result depends on the clock (`now()`, `until()`). */
  usesNow(): boolean {
    let found = false;
    walk(this.exprs(), (e) => {
      if (e.kind.k === "call" && (e.kind.f === "now" || e.kind.f === "until")) found = true;
    });
    return found;
  }

  resultType(): Type {
    return "expr" in this.body ? this.body.expr.ty : "str";
  }
}

function walk(exprs: readonly Expr[], f: (e: Expr) => void) {
  const stack = [...exprs];
  for (let e = stack.pop(); e; e = stack.pop()) {
    f(e);
    const k = e.kind;
    if (k.k === "neg" || k.k === "not" || k.k === "field") stack.push(k.e);
    else if (k.k === "bin") stack.push(k.a, k.b);
    else if (k.k === "index") stack.push(k.e, k.i);
    else if (k.k === "call") stack.push(...k.args);
  }
}

/** A host over plain topic values, for tests and simple callers. */
export function mapHost(
  topics: Readonly<Record<string, Value>>,
  extra: Partial<Omit<Host, "hasTopic" | "topic">> = {},
): Host {
  return {
    ...extra,
    hasTopic: (name) => Object.hasOwn(topics, name),
    topic: (name, keys: readonly Key[]) =>
      Object.hasOwn(topics, name) ? at(topics[name] ?? null, keys) : null,
  };
}
