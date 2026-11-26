// Number, byte, duration and color formatting (docs/EXPRESSIONS.md §6). Rust twin:
// crates/opaline-expr/src/format.rs: the same arithmetic in the same order, so both agree to the
// digit. Locale data comes from here, not Intl, so it doesn't depend on the platform.
import { isList, type Locale, type Value } from "./value";

/** Narrow no-break space, between a number and its unit. */
export const NNBSP = " ";

/** Rounds half away from zero (Math.round rounds half up). */
export function roundHalfAway(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

export function roundTo(x: number, digits: number): number {
  if (digits === 0) return roundHalfAway(x);
  const k = 10 ** digits;
  return roundHalfAway(x * k) / k;
}

const separators = (locale: Locale): [string, string] =>
  locale === "de" ? [",", "."] : [".", ","];

function number(x: number, digits: number, trim: boolean, locale: Locale): string {
  if (!Number.isFinite(x)) return "—";
  let scaled = roundHalfAway(Math.abs(x) * 10 ** digits);
  // The exact decimal digits of an integral double, like Rust's `{:.0}`.
  let d: string;
  if (Number.isFinite(scaled)) {
    d = BigInt(scaled).toString();
  } else {
    // Too large to scale: no fraction is representable anyway.
    scaled = roundHalfAway(Math.abs(x));
    d = BigInt(scaled).toString() + "0".repeat(digits);
  }
  if (d.length <= digits) d = "0".repeat(digits + 1 - d.length) + d;
  const int = d.slice(0, d.length - digits);
  let frac = d.slice(d.length - digits);
  const [dec, group] = separators(locale);
  let out = x < 0 && scaled !== 0 ? "-" : "";
  for (let i = 0; i < int.length; i++) {
    if (i > 0 && (int.length - i) % 3 === 0) out += group;
    out += int[i] ?? "";
  }
  if (trim) frac = frac.replace(/0+$/, "");
  if (frac) out += dec + frac;
  return out;
}

export const fixed = (x: number, digits: number, locale: Locale) =>
  number(x, digits, false, locale);

/** At most 3 decimals, trailing zeros dropped: template holes and `unit` without digits. */
export const plain = (x: number, locale: Locale) => number(x, 3, true, locale);

/** A value as text, the template-hole rules (§4). `null` is `—`. */
export function text(v: Value, locale: Locale): string {
  if (v === null) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return plain(v, locale);
  if (typeof v === "string") return v;
  if (isList(v)) return v.map((x) => text(x, locale)).join(", ");
  return "—";
}

export function bytes(x: number, iec: boolean, locale: Locale): string {
  const [factor, units] = iec
    ? [1024, ["B", "KiB", "MiB", "GiB", "TiB"]]
    : [1000, ["B", "kB", "MB", "GB", "TB"]];
  let a = Math.abs(x);
  if (a < factor) return `${fixed(x, 0, locale)}${NNBSP}B`;
  let i = 0;
  while (a >= factor && i + 1 < units.length) {
    a /= factor;
    i++;
  }
  const signed = x < 0 ? -a : a;
  return `${fixed(signed, 1, locale)}${NNBSP}${units[i] ?? "B"}`;
}

export function duration(secs: number, clock: boolean, locale: Locale): string {
  const sign = secs < 0 ? "-" : "";
  const total = roundHalfAway(Math.abs(secs));
  const two = (n: number) => String(n).padStart(2, "0");
  if (clock) {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${sign}${fixed(h, 0, locale)}:${two(m)}:${two(s)}` : `${sign}${m}:${two(s)}`;
  }
  const parts: [number, string][] = [
    [Math.floor(total / 86400), "d"],
    [Math.floor((total % 86400) / 3600), "h"],
    [Math.floor((total % 3600) / 60), "min"],
    [total % 60, "s"],
  ];
  const first = parts.findIndex(([v]) => v > 0);
  if (first < 0) return `0${NNBSP}s`;
  let out = sign;
  parts.slice(first, first + 2).forEach(([v, unit], j) => {
    if (v === 0) return;
    if (j > 0) out += " ";
    out += `${fixed(v, 0, locale)}${NNBSP}${unit}`;
  });
  return out;
}

export type Rgba = [number, number, number, number];

/** `#rrggbb` or `#rrggbbaa` → channels 0 … 255. */
export function parseColor(s: string): Rgba | null {
  const m = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(s);
  const hex = m?.[1];
  if (!hex) return null;
  const ch = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return [ch(0), ch(2), ch(4), hex.length === 8 ? ch(6) : 255];
}

export function color(c: Rgba): string {
  const b = (v: number) => Math.min(255, Math.max(0, roundHalfAway(v)));
  const hex = (v: number) => b(v).toString(16).padStart(2, "0");
  const rgb = `#${hex(c[0])}${hex(c[1])}${hex(c[2])}`;
  return b(c[3]) === 255 ? rgb : rgb + hex(c[3]);
}

export function mix(a: Rgba, b: Rgba, t: number, channels: number): Rgba {
  const k = Math.min(1, Math.max(0, t));
  return a.map((v, i) => (i < channels ? roundHalfAway(v + ((b[i] ?? v) - v) * k) : v)) as Rgba;
}
