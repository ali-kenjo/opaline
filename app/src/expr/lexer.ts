// Tokens (docs/EXPRESSIONS.md §3). Positions are code-point offsets, as in Rust.
import { Diagnostic } from "./diagnostic";

export type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ident"; v: string }
  | { t: "op"; v: string }
  | { t: "eof" };

export interface Token {
  tok: Tok;
  at: number;
}

const OPS = [
  "??", "||", "&&", "==", "!=", "<=", ">=", "<", ">", "+", "-", "*", "/", "%", "!", "(", ")",
  "[", "]", ",", ".", "|",
]; // prettier-ignore

const WHITE = /^\p{White_Space}$/u;
const ALPHA = /^\p{Alphabetic}$/u;
const ALNUM = /^[\p{Alphabetic}\p{N}]$/u;
const DIGIT = /^[0-9]$/;
const HEX = /^[0-9a-fA-F]+$/;

const isDigit = (c: string | undefined) => c !== undefined && DIGIT.test(c);

export function lex(src: readonly string[], offset: number): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] ?? "";
    const at = offset + i;
    if (WHITE.test(c)) {
      i++;
      continue;
    }
    if (isDigit(c) || (c === "." && isDigit(src[i + 1]))) {
      const start = i;
      while (i < src.length && (isDigit(src[i]) || src[i] === ".")) i++;
      if (src[i] === "e" || src[i] === "E") {
        let j = i + 1;
        if (src[j] === "+" || src[j] === "-") j++;
        if (isDigit(src[j])) {
          i = j;
          while (isDigit(src[i])) i++;
        }
      }
      const text = src.slice(start, i).join("");
      // Rust's f64 parser and Number() agree on these shapes; "1.2.3" fails in both.
      const n = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text) ? Number(text) : NaN;
      if (Number.isNaN(n)) throw new Diagnostic("parse-error", at, "not a number");
      out.push({ tok: { t: "num", v: n }, at });
      continue;
    }
    if (c === "'" || c === '"') {
      const [s, next] = string(src, i, offset);
      out.push({ tok: { t: "str", v: s }, at });
      i = next;
      continue;
    }
    if (ALPHA.test(c) || c === "_" || c === "$") {
      const start = i;
      i++;
      while (i < src.length && (ALNUM.test(src[i] ?? "") || src[i] === "_")) i++;
      out.push({ tok: { t: "ident", v: src.slice(start, i).join("") }, at });
      continue;
    }
    const op = OPS.find((o) => src.slice(i, i + o.length).join("") === o);
    if (op === undefined) throw new Diagnostic("parse-error", at, `unexpected character ${c}`);
    i += op.length;
    out.push({ tok: { t: "op", v: op }, at });
  }
  out.push({ tok: { t: "eof" }, at: offset + src.length });
  return out;
}

function string(src: readonly string[], start: number, offset: number): [string, number] {
  const quote = src[start];
  let i = start + 1;
  let s = "";
  while (i < src.length) {
    const c = src[i] ?? "";
    if (c === quote) return [s, i + 1];
    if (c === "\\") {
      const esc = src[i + 1];
      if (esc === undefined) throw new Diagnostic("parse-error", offset + i, "unfinished escape");
      if (esc === "n") s += "\n";
      else if (esc === "t") s += "\t";
      else if (esc === "\\" || esc === "'" || esc === '"') s += esc;
      else if (esc === "u") {
        if (src[i + 2] !== "{") throw new Diagnostic("parse-error", offset + i, "bad \\u escape");
        const close = src.indexOf("}", i + 3);
        const hex = close < 0 ? "" : src.slice(i + 3, close).join("");
        const cp = HEX.test(hex) ? parseInt(hex, 16) : NaN;
        // char::from_u32: no surrogates, at most U+10FFFF.
        if (Number.isNaN(cp) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
          throw new Diagnostic("parse-error", offset + i, "bad \\u escape");
        }
        s += String.fromCodePoint(cp);
        i = close + 1;
        continue;
      } else throw new Diagnostic("parse-error", offset + i, "unknown escape");
      i += 2;
      continue;
    }
    s += c;
    i++;
  }
  throw new Diagnostic("parse-error", offset + start, "unclosed string");
}
