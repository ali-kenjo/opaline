// Memory widget: RAM use, hardware specs (slots, speed, type, sticks, vendor), swap, zram, zswap and pressure.
import { defaultOptions } from "../compose/widget";
import { type ByteUnit, bytes, fixed, map, missingReason, num, percent, text } from "./format";
import { memoryComposition } from "./memory.composition";
import { BYTE_UNIT, levels } from "./options";
import type { CardStatus, ReadCtx, Reading, WidgetDef } from "./types";

const USAGE = "memory.usage";
const SWAP = "memory.swap";
const ZSWAP = "memory.zswap";
const ZRAM = "memory.zram";
const PRESSURE = "memory.pressure";
const INFO = "memory.info";

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
      id: "zram",
      label: "Zram",
      icon: "layers",
      topics: [ZRAM],
      hero: false,
      read: (c) => {
        const z = map(c.get(ZRAM));
        if (!z) return missingReason(c.get(ZRAM)) === "no-zram" ? { text: "Off" } : null;
        const orig = num(z.origDataB);
        const compr = num(z.comprDataB);
        return orig !== null && compr !== null
          ? { text: `${bytes(orig, unit(c), 1)} → ${bytes(compr, unit(c), 1)}` }
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
    {
      id: "slots",
      label: "RAM slots",
      shortLabel: "Slots",
      icon: "grid_view",
      topics: [INFO],
      hero: false,
      read: (c) => {
        const info = map(c.get(INFO));
        const used = num(info?.slotsUsed);
        const total = num(info?.slotsTotal);
        if (used === null || total === null) return null;
        const sticks = text(info?.sticks);
        return {
          text: sticks
            ? `${String(used)} / ${String(total)} · ${sticks}`
            : `${String(used)} / ${String(total)}`,
        };
      },
    },
    {
      id: "speed",
      label: "RAM speed",
      shortLabel: "Speed",
      icon: "speed",
      topics: [INFO],
      hero: false,
      read: (c) => {
        const info = map(c.get(INFO));
        const speed = num(info?.speedMTs);
        if (speed === null) return null;
        const rated = num(info?.ratedSpeedMTs);
        return {
          text:
            rated !== null && rated !== speed
              ? `${fixed(speed, 0)} MT/s (${fixed(rated, 0)} max)`
              : `${fixed(speed, 0)} MT/s`,
          value: speed,
        };
      },
    },
    {
      id: "type",
      label: "Memory type",
      shortLabel: "Type",
      icon: "memory",
      topics: [INFO],
      hero: false,
      read: (c) => {
        const info = map(c.get(INFO));
        const parts = [text(info?.type), text(info?.formFactor)].filter(Boolean);
        return parts.length ? { text: parts.join(" ") } : null;
      },
    },
    {
      id: "manufacturer",
      label: "Manufacturer",
      shortLabel: "Maker",
      icon: "info",
      topics: [INFO],
      hero: false,
      read: (c) => {
        const m = text(map(c.get(INFO))?.manufacturer);
        return m ? { text: m } : null;
      },
    },
    {
      id: "maxCapacity",
      label: "Max capacity",
      shortLabel: "Max",
      icon: "storage",
      topics: [INFO],
      hero: false,
      read: (c) => {
        const max = num(map(c.get(INFO))?.maxCapacityB);
        return max === null ? null : { text: bytes(max, unit(c), 0), value: max };
      },
    },
    {
      id: "partNumber",
      label: "Part number",
      shortLabel: "Part",
      icon: "developer_board",
      topics: [INFO],
      hero: false,
      read: (c) => {
        const p = text(map(c.get(INFO))?.partNumber);
        return p ? { text: p } : null;
      },
    },
  ],
  options: [
    {
      kind: "enum",
      key: "heroVisual",
      label: "Hero visual",
      options: [
        { value: "liquid", label: "Liquid fill" },
        { value: "ring", label: "Ring" },
        { value: "number", label: "Number" },
      ],
      default: "liquid",
    },
    BYTE_UNIT,
    levels([85, 95], "For the main value. The card turns amber, then red."),
  ],
  composition: memoryComposition,
  useClassicStat: true,
  compositionOptions: (content) => defaultOptions(memory, content),
  status(c): CardStatus {
    const u = c.get(USAGE);
    if (u === undefined) return { kind: "loading" };
    const reason = missingReason(u);
    return reason
      ? { kind: "unavailable", reason: `Memory unavailable (${reason})` }
      : { kind: "ready" };
  },
};
