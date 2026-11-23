// Content options several widgets share.
import type { ContentOption } from "./types";

export const TEMP_UNIT: ContentOption = {
  kind: "enum",
  key: "tempUnit",
  label: "Temperature unit",
  options: [
    { value: "c", label: "Celsius (°C)" },
    { value: "f", label: "Fahrenheit (°F)" },
  ],
  default: "c",
};

export const BYTE_UNIT: ContentOption = {
  kind: "enum",
  key: "byteUnit",
  label: "Size units",
  help: "GB counts in thousands (like drive makers), GiB in 1024s (like the kernel).",
  options: [
    { value: "si", label: "GB" },
    { value: "iec", label: "GiB" },
  ],
  default: "si",
};

export function levels(defaults: readonly [number, number], help: string): ContentOption {
  return {
    kind: "thresholds",
    key: "levels",
    label: "Warning and critical levels",
    help,
    min: 0,
    max: 100000,
    step: 1,
    unit: "",
    default: defaults,
  };
}
