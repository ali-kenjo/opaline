// Parser and static checker (docs/EXPRESSIONS.md §3). Rust twin: crates/opaline-expr/src/parser.rs;
// keep both in step (same nesting accounting, same checks, same error positions).
import { Diagnostic, MAX_DEPTH, MAX_LEN } from "./diagnostic";
import { accepts, arityOk, durationSecs, lookup, paramAt, type Func, type Param } from "./funcs";
import { lex, type Tok, type Token } from "./lexer";
import { typeOf, type Key, type Type, type Value } from "./value";

export type BinOp =
  | "+" | "-" | "*" | "/" | "%" | "<" | "<=" | ">" | ">=" | "==" | "!=" | "&&" | "||" | "??"; // prettier-ignore

export interface PathRef {
  segments: string[];
  keys: Key[];
  /** Candidate topic names, longest first, each with the keys left inside it. */
  candidates: [string, Key[]][];
}

export type Kind =
  | { k: "lit"; v: Value }
  | { k: "path"; p: PathRef }
  | { k: "neg"; e: Expr }
  | { k: "not"; e: Expr }
  | { k: "bin"; op: BinOp; a: Expr; b: Expr }
  | { k: "field"; e: Expr; name: string }
  | { k: "index"; e: Expr; i: Expr }
  | { k: "call"; f: Func; args: Expr[] };

export interface Expr {
  kind: Kind;
  ty: Type;
  at: number;
  depth: number;
}

export type Part = { text: string } | { hole: Expr };

export function pathRef(segments: string[], keys: Key[]): PathRef {
  const candidates: [string, Key[]][] = [];
  for (let n = segments.length; n >= 1; n--) {
    const rest: Key[] = segments.slice(n).map((s) => ({ field: s }));
    candidates.push([segments.slice(0, n).join("."), [...rest, ...keys]]);
  }
  return { segments, keys, candidates };
}

function node(kind: Kind, ty: Type, at: number): Expr {
  let depth = 0;
  switch (kind.k) {
    case "lit":
    case "path":
      break;
    case "neg":
    case "not":
    case "field":
      depth = kind.e.depth;
      break;
    case "bin":
      depth = Math.max(kind.a.depth, kind.b.depth);
      break;
    case "index":
      depth = Math.max(kind.e.depth, kind.i.depth);
      break;
    case "call":
      depth = kind.args.reduce((m, a) => Math.max(m, a.depth), 0);
      break;
  }
  depth += 1;
  if (depth > MAX_DEPTH) throw new Diagnostic("too-deep", at, "nested too deeply");
  return { kind, ty, at, depth };
}

export function parseExpression(src: string): Expr {
  const chars = Array.from(src);
  if (chars.length > MAX_LEN) throw new Diagnostic("too-long", MAX_LEN, "expression too long");
  return parseChars(chars, 0);
}

export function parseTemplate(src: string): Part[] {
  const chars = Array.from(src);
  if (chars.length > MAX_LEN) throw new Diagnostic("too-long", MAX_LEN, "template too long");
  const parts: Part[] = [];
  let text = "";
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    const next = chars[i + 1];
    if (c === "{" && next === "{") {
      text += "{";
      i += 2;
    } else if (c === "}" && next === "}") {
      text += "}";
      i += 2;
    } else if (c === "{") {
      const end = holeEnd(chars, i + 1);
      if (end < 0) throw new Diagnostic("parse-error", i, "unclosed {");
      if (text) parts.push({ text });
      text = "";
      parts.push({ hole: parseChars(chars.slice(i + 1, end), i + 1) });
      i = end + 1;
    } else {
      text += c ?? "";
      i++;
    }
  }
  if (text) parts.push({ text });
  return parts;
}

function holeEnd(chars: readonly string[], from: number): number {
  let quote: string | null = null;
  for (let i = from; i < chars.length; i++) {
    const c = chars[i];
    if (quote !== null) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "}") return i;
  }
  return -1;
}

function parseChars(chars: readonly string[], offset: number): Expr {
  const p = new Parser(lex(chars, offset));
  const e = p.expr();
  const t = p.peek();
  if (t.tok.t !== "eof") throw new Diagnostic("parse-error", t.at, "unexpected token");
  return e;
}

const EOF: Token = { tok: { t: "eof" }, at: 0 };

const COMPARE: [string, BinOp][] = [
  ["<", "<"],
  ["<=", "<="],
  [">", ">"],
  [">=", ">="],
];

class Parser {
  private pos = 0;
  private depth = 0;

  constructor(private readonly toks: readonly Token[]) {}

  peek(): Token {
    return this.toks[this.pos] ?? this.toks[this.toks.length - 1] ?? EOF;
  }

  private peekAt(n: number): Tok {
    return this.toks[this.pos + n]?.tok ?? { t: "eof" };
  }

  private bump(): Token {
    const t = this.peek();
    if (this.pos < this.toks.length) this.pos++;
    return t;
  }

  private isOp(op: string): boolean {
    const t = this.peek().tok;
    return t.t === "op" && t.v === op;
  }

  private eat(op: string): boolean {
    const yes = this.isOp(op);
    if (yes) this.pos++;
    return yes;
  }

  private expect(op: string) {
    if (!this.eat(op)) throw new Diagnostic("parse-error", this.peek().at, `expected ${op}`);
  }

  private enter() {
    this.depth++;
    if (this.depth > MAX_DEPTH)
      throw new Diagnostic("too-deep", this.peek().at, "nested too deeply");
  }

  expr(): Expr {
    this.enter();
    const e = this.pipe();
    this.depth--;
    return e;
  }

  private pipe(): Expr {
    let lhs = this.coalesce();
    while (this.isOp("|")) {
      this.bump();
      const name = this.bump();
      if (name.tok.t !== "ident") {
        throw new Diagnostic("parse-error", name.at, "expected a function name");
      }
      const args = [lhs];
      if (this.eat("(")) this.args(args);
      lhs = call(name.tok.v, name.at, args);
    }
    return lhs;
  }

  private args(args: Expr[]) {
    if (this.eat(")")) return;
    for (;;) {
      args.push(this.expr());
      if (this.eat(")")) return;
      this.expect(",");
    }
  }

  private opOf(ops: readonly [string, BinOp][]): BinOp | undefined {
    return ops.find(([s]) => this.isOp(s))?.[1];
  }

  private loop(ops: readonly [string, BinOp][], next: () => Expr): Expr {
    let lhs = next();
    for (let op = this.opOf(ops); op !== undefined; op = this.opOf(ops)) {
      const at = this.bump().at;
      const rhs = next();
      lhs = binary(op, lhs, rhs, at);
    }
    return lhs;
  }

  private coalesce(): Expr {
    return this.loop([["??", "??"]], () => this.or());
  }

  private or(): Expr {
    return this.loop([["||", "||"]], () => this.and());
  }

  private and(): Expr {
    return this.loop([["&&", "&&"]], () => this.equality());
  }

  private equality(): Expr {
    const ops: [string, BinOp][] = [
      ["==", "=="],
      ["!=", "!="],
    ];
    const lhs = this.compare();
    const op = this.opOf(ops);
    if (op === undefined) return lhs;
    const at = this.bump().at;
    const rhs = this.compare();
    if (this.opOf(ops) !== undefined) {
      throw new Diagnostic("chained-comparison", this.peek().at, "comparisons don't chain; use &&");
    }
    return binary(op, lhs, rhs, at);
  }

  private compare(): Expr {
    const lhs = this.additive();
    const op = this.opOf(COMPARE);
    if (op === undefined) return lhs;
    const at = this.bump().at;
    const rhs = this.additive();
    if (this.opOf(COMPARE) !== undefined) {
      throw new Diagnostic("chained-comparison", this.peek().at, "comparisons don't chain; use &&");
    }
    return binary(op, lhs, rhs, at);
  }

  private additive(): Expr {
    return this.loop(
      [
        ["+", "+"],
        ["-", "-"],
      ],
      () => this.multiplicative(),
    );
  }

  private multiplicative(): Expr {
    return this.loop(
      [
        ["*", "*"],
        ["/", "/"],
        ["%", "%"],
      ],
      () => this.unary(),
    );
  }

  private unary(): Expr {
    if (this.isOp("-") || this.isOp("!")) {
      const t = this.bump();
      this.enter();
      const operand = this.unary();
      this.depth--;
      if (t.tok.t === "op" && t.tok.v === "-") {
        check("num", operand);
        return node({ k: "neg", e: operand }, "num", t.at);
      }
      checkBool(operand);
      return node({ k: "not", e: operand }, "bool", t.at);
    }
    return this.postfix();
  }

  private postfix(): Expr {
    let e = this.primary();
    // Constant steps right after a path fold into it, so the host can look them up directly.
    let folding = e.kind.k === "path";
    for (;;) {
      if (this.isOp(".")) {
        const dot = this.bump();
        const name = this.bump();
        if (name.tok.t !== "ident") {
          throw new Diagnostic("parse-error", name.at, "expected a field name");
        }
        if (folding && e.kind.k === "path") {
          const p = e.kind.p;
          e.kind.p = pathRef(p.segments, [...p.keys, { field: name.tok.v }]);
          continue;
        }
        e = node({ k: "field", e, name: name.tok.v }, "any", dot.at);
      } else if (this.isOp("[")) {
        const open = this.bump();
        const index = this.expr();
        this.expect("]");
        if (folding && e.kind.k === "path") {
          const p = e.kind.p;
          if (index.kind.k === "lit" && typeof index.kind.v === "number") {
            e.kind.p = pathRef(p.segments, [...p.keys, { index: index.kind.v }]);
            continue;
          }
          if (index.kind.k === "lit" && typeof index.kind.v === "string") {
            e.kind.p = pathRef(p.segments, [...p.keys, { field: index.kind.v }]);
            continue;
          }
          folding = false;
        }
        e = node({ k: "index", e, i: index }, "any", open.at);
      } else {
        return e;
      }
    }
  }

  private primary(): Expr {
    const t = this.bump();
    const at = t.at;
    const lit = (v: Value) => node({ k: "lit", v }, typeOf(v), at);
    switch (t.tok.t) {
      case "num":
        return lit(Number.isFinite(t.tok.v) ? t.tok.v : null);
      case "str":
        return lit(t.tok.v);
      case "ident": {
        const id = t.tok.v;
        if (id === "true") return lit(true);
        if (id === "false") return lit(false);
        if (id === "null") return lit(null);
        if (this.isOp("(")) {
          this.bump();
          const args: Expr[] = [];
          this.args(args);
          return call(id, at, args);
        }
        const segments = [id];
        for (;;) {
          const next = this.peekAt(1);
          if (!this.isOp(".") || next.t !== "ident") break;
          segments.push(next.v);
          this.pos += 2;
        }
        return node({ k: "path", p: pathRef(segments, []) }, "any", at);
      }
      case "op":
        if (t.tok.v === "(") {
          const e = this.expr();
          this.expect(")");
          return e;
        }
        throw new Diagnostic("parse-error", at, `unexpected ${t.tok.v}`);
      case "eof":
        throw new Diagnostic("parse-error", at, "unexpected end");
    }
  }
}

const typeError = (at: number, what: string) => new Diagnostic("type-error", at, what);

function check(p: Param, e: Expr) {
  if (!accepts(p, e.ty)) {
    const want = { num: "a number", str: "a string", list: "a list", any: "a value" }[p];
    throw typeError(e.at, `expected ${want}`);
  }
}

function checkBool(e: Expr) {
  if (e.ty !== "bool" && e.ty !== "null" && e.ty !== "any") {
    throw typeError(e.at, "expected true or false");
  }
}

const concrete = (t: Type) => t === "num" || t === "str" || t === "bool";

function binary(op: BinOp, lhs: Expr, rhs: Expr, at: number): Expr {
  const [a, b] = [lhs.ty, rhs.ty];
  let ty: Type;
  switch (op) {
    case "+":
      if (a === "str" && b === "str") ty = "str";
      else if (a === "num" && b === "num") ty = "num";
      else if ((concrete(a) && concrete(b)) || a === "bool" || b === "bool") {
        throw typeError(at, "+ needs two numbers or two strings");
      } else ty = "any";
      break;
    case "-":
    case "*":
    case "/":
    case "%":
      check("num", lhs);
      check("num", rhs);
      ty = "num";
      break;
    case "<":
    case "<=":
    case ">":
    case ">=":
      if (a === "bool" || b === "bool" || (concrete(a) && concrete(b) && a !== b)) {
        throw typeError(at, "compares numbers with numbers or strings with strings");
      }
      ty = "bool";
      break;
    case "==":
    case "!=":
      ty = "bool";
      break;
    case "&&":
    case "||":
      checkBool(lhs);
      checkBool(rhs);
      ty = "bool";
      break;
    case "??":
      ty = a === "null" ? b : a === b ? a : b === "null" ? a : "any";
      break;
  }
  return node({ k: "bin", op, a: lhs, b: rhs }, ty, at);
}

const isPlainPath = (e: Expr) => e.kind.k === "path" && e.kind.p.keys.length === 0;

function call(name: string, at: number, args: Expr[]): Expr {
  // min/max with a path and a duration literal are the history form (§6).
  let hist: Func | undefined;
  if (name === "avg") hist = "hist-avg";
  else if (name === "delta") hist = "hist-delta";
  else if (
    (name === "min" || name === "max") &&
    args.length === 2 &&
    args[0] !== undefined &&
    isPlainPath(args[0]) &&
    args[1]?.kind.k === "lit" &&
    typeof args[1].kind.v === "string"
  ) {
    hist = name === "min" ? "hist-min" : "hist-max";
  }
  if (hist !== undefined) {
    const [path, window] = args;
    if (args.length !== 2 || path === undefined || window === undefined) {
      throw new Diagnostic("arity", at, `${name} takes a path and a window`);
    }
    if (!isPlainPath(path)) throw typeError(path.at, "expected a data path");
    const secs =
      window.kind.k === "lit" && typeof window.kind.v === "string"
        ? durationSecs(window.kind.v)
        : null;
    if (secs === null) throw typeError(window.at, "expected a duration such as '5m'");
    args[1] = node({ k: "lit", v: secs }, "num", window.at);
    return node({ k: "call", f: hist, args }, "num", at);
  }
  const sig = lookup(name);
  if (!sig) throw new Diagnostic("unknown-function", at, `unknown function ${name}`);
  if (!arityOk(sig, args.length)) {
    throw new Diagnostic("arity", at, `wrong number of arguments for ${name}`);
  }
  args.forEach((a, i) => {
    check(paramAt(sig, i), a);
  });
  let ty = sig.ret;
  if (sig.func === "if") {
    const [, a, b] = args;
    ty = a?.ty !== undefined && a.ty === b?.ty ? a.ty : "any";
  }
  return node({ k: "call", f: sig.func, args }, ty, at);
}
