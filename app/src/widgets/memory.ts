// Memory widget: RAM use, what it's used for, swap, zswap and pressure.
import { type ByteUnit, bytes, map, missingReason, num, percent } from "./format";
import { BYTE_UNIT, levels } from "./options";
import type { CardStatus, ReadCtx, Reading, WidgetDef } from "./types";

const USAGE = "memory.usage";
const SWAP = "memory.swap";
const ZSWAP = "memory.zswap";
const PRESSURE = "memory.pressure";

const unit = (c: ReadCtx) => c.content.opt<ByteUnit>("byteUnit");
const usage = (c: ReadCtx, key: string) => num(map(c.get(USAGE))?.[key]);

function sizeField(
  id: string,
  label: string,
  key: string,
  icon: "memory" | "storage" | "layers" | "stacks" | "check",
): WidgetDef["fields"][number] {
  return {
    id,
    label,
    icon,
    topics: [USAGE],
    read: (c): Reading | null => {
      const v = usage(c, key);
      const total = usage(c, "totalB");
      return v === null
        ? null
        : {
            text: bytes(v, unit(c), c.content.decimals),
            value: v,
            ...(total ? { ratio: v / total, ramp: "load" as const } : {}),
          };
    },
  };
}

export const memory: WidgetDef = {
  kind: "memory",
  name: "Memory",
  icon: "memory_alt",
  category: "system",
  sizes: ["1x1", "2x1", "4x1", "S", "M", "L", "XL"],
  defaultSize: "S",
  heroStyles: ["ring", "number", "bar", "sparkline"],
  defaultFields: ["percent", "used", "available", "swap"],
  fields: [
    {
      id: "percent",
      label: "In use",
      icon: "memory_alt",
      topics: [USAGE],
      series: "memory.percent",
      read: (c) => {
        const p = usage(c, "percent");
        const total = usage(c, "totalB");
        return p === null
          ? null
          : {
              text: percent(p, c.content.decimals),
              value: p,
              ratio: p / 100,
              ramp: "load",
              ...(total ? { sub: `of ${bytes(total, unit(c), 1)}` } : {}),
            };
      },
    },
    sizeField("used", "Used", "usedB", "memory"),
    sizeField("available", "Available", "availableB", "check"),
    sizeField("total", "Total", "totalB", "storage"),
    sizeField("cached", "Cache", "cachedB", "layers"),
    sizeField("buffers", "Buffers", "buffersB", "stacks"),
    sizeField("shared", "Shared", "shmemB", "stacks"),
    {
      id: "swap",
      label: "Swap",
      icon: "swap_vert",
      topics: [SWAP],
      series: "memory.swapPercent",
      read: (c) => {
        const s = map(c.get(SWAP));
        const used = num(s?.usedB);
        const total = num(s?.totalB);
        const p = num(s?.percent);
        if (used === null || !total) return null;
        return {
          text: `${bytes(used, unit(c), 1)} / ${bytes(total, unit(c), 1)}`,
          value: p ?? 0,
          ratio: (p ?? 0) / 100,
          ramp: "load",
        };
      },
    },
    {
      id: "zswap",
      label: "Zswap",
      icon: "layers",
      topics: [ZSWAP],
      hero: false,
      read: (c) => {
        const z = map(c.get(ZSWAP));
        if (!z) return missingReason(c.get(ZSWAP)) === "zswap-disabled" ? { text: "Off" } : null;
        const stored = num(z.storedB) ?? num(z.originalB);
        const pool = num(z.poolB) ?? num(z.compressedB);
        return stored !== null && pool !== null
          ? { text: `${bytes(stored, unit(c), 1)} → ${bytes(pool, unit(c), 1)}` }
          : { text: "On" };
      },
    },
    {
      id: "pressure",
      label: "Pressure",
      icon: "hourglass_empty",
      topics: [PRESSURE],
      read: (c) => {
        const v = num(map(c.get(PRESSURE))?.some10);
        return v === null
          ? null
          : {
              text: percent(v, Math.max(1, c.content.decimals)),
              value: v,
              ratio: v / 100,
              ramp: "load",
              sub: "waiting for memory, 10 s",
            };
      },
    },
  ],
  options: [BYTE_UNIT, levels([85, 95], "For the main value. The card turns amber, then red.")],
  status(c): CardStatus {
    const u = c.get(USAGE);
    if (u === undefined) return { kind: "loading" };
    const reason = missingReason(u);
    return reason
      ? { kind: "unavailable", reason: `Memory unavailable (${reason})` }
      : { kind: "ready" };
  },
};
