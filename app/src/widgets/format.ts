// Formatting shared by widgets: locale-aware numbers with the user's decimals and units.
import type { Value } from "../layer/protocol";

export function num(v: Value | undefined): number | null {
  return v?.kind === "num" && Number.isFinite(v.v) ? v.v : null;
}

export function nums(v: Value | undefined): number[] | null {
  return v?.kind === "nums" ? v.v : null;
}

export function text(v: Value | undefined): string | null {
  return v?.kind === "text" ? v.v : null;
}

export function map(v: Value | undefined): Record<string, Value> | null {
  return v?.kind === "map" ? v.v : null;
}

export function fixed(n: number, decimals: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function percent(n: number, decimals: number): string {
  return `${fixed(n, decimals)} %`;
}

export type TempUnit = "c" | "f";

export function temperature(celsius: number, unit: TempUnit, decimals: number): string {
  return unit === "f"
    ? `${fixed((celsius * 9) / 5 + 32, decimals)} °F`
    : `${fixed(celsius, decimals)} °C`;
}

export type FreqUnit = "ghz" | "mhz";

export function frequency(mhz: number, unit: FreqUnit, decimals: number): string {
  return unit === "mhz"
    ? `${fixed(mhz, 0)} MHz`
    : `${fixed(mhz / 1000, Math.max(1, decimals))} GHz`;
}

export type ByteUnit = "si" | "iec";

/** Bytes as GB (SI) or GiB (IEC), picking a sensible magnitude. */
export function bytes(b: number, unit: ByteUnit, decimals: number): string {
  const base = unit === "iec" ? 1024 : 1000;
  const names = unit === "iec" ? ["B", "KiB", "MiB", "GiB", "TiB"] : ["B", "kB", "MB", "GB", "TB"];
  let v = b;
  let i = 0;
  while (Math.abs(v) >= base && i < names.length - 1) {
    v /= base;
    i++;
  }
  return `${fixed(v, i === 0 ? 0 : Math.max(decimals, 1))} ${names[i] ?? "B"}`;
}

export function missingReason(v: Value | undefined): string | null {
  if (v?.kind !== "missing") return null;
  const a = v.v;
  if (a.state === "asleep") return "asleep";
  if (a.state === "needs-permission") return "needs-permission";
  return a.reason;
}
