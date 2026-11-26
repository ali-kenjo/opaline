// Random programs for the fuzz and differential tests: the language's own pieces, so the parser
// gets past the first token often.

/** A small seeded PRNG, so a failure reproduces. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PIECES = [
  "cpu.load", "gpu.list", "t", "[0]", "[-1]", ".x", "1", "-0.5", "1e308", "'s'", "'#ff0000'",
  "null", "true", "+", "-", "*", "/", "%", "<", "==", "&&", "||", "??", "!", "|", "(", ")", ",",
  "{", "}", "round(", "bytes(", "duration(", "mix(", "pad(", "join(", "if(",
  "avg(cpu.load, '5m')", "max(", "unit(", "len(", "now()", " ", "'a}'", "'{x}'", "1.5", "0",
  "1234.5678", "-1e21", "fixed(", "percent(", "lighten(", "alpha(", "'iec'", "'clock'", "'%'",
  "<=", ">", "!=", "upper(", "string(", "clamp(", "map(", "sqrt(", "floor(", "until(", "'\\u{1F600}'",
  "'é'", "min(cpu.load, '1h')", "delta(", "false", "{{", "}}", "$item",
]; // prettier-ignore

export function soup(next: () => number): string {
  const n = Math.floor(next() * 24);
  let s = "";
  for (let i = 0; i < n; i++) s += PIECES[Math.floor(next() * PIECES.length)] ?? "";
  return s;
}
