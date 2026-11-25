// Storage widget: one volume (/ by default) and the drive it lives on: space, activity,
// temperature and health; eject or power off removable drives.
import type { Value } from "../layer/protocol";
import {
  type ByteUnit,
  bytes,
  fixed,
  map,
  missingReason,
  num,
  percent,
  temperature,
  type TempUnit,
  text,
} from "./format";
import { BYTE_UNIT, TEMP_UNIT, levels } from "./options";
import type { CardStatus, Choice, ReadCtx, Reading, WidgetAction, WidgetDef } from "./types";

const DRIVES = "storage.drives";
const IO = "storage.io";
const HEALTH = "storage.health";
const TEMPS = "storage.temps";

interface Volume {
  drive: string;
  part: Record<string, Value> | null;
  driveInfo: Record<string, Value>;
  id: string;
  label: string;
}

function volumes(v: Value | undefined): Volume[] {
  if (v?.kind !== "list") return [];
  const out: Volume[] = [];
  for (const d of v.v) {
    if (d.kind !== "map") continue;
    const drive = text(d.v.name) ?? "?";
    const model = text(d.v.model) ?? drive;
    const parts = d.v.partitions?.kind === "list" ? d.v.partitions.v : [];
    let any = false;
    for (const p of parts) {
      if (p.kind !== "map") continue;
      const mount = text(p.v.mount);
      if (!mount) continue;
      any = true;
      out.push({ drive, part: p.v, driveInfo: d.v, id: mount, label: `${mount} (${model})` });
    }
    if (!any)
      out.push({
        drive,
        part: null,
        driveInfo: d.v,
        id: `drive:${drive}`,
        label: `${model} (not mounted)`,
      });
  }
  return out;
}

export function volume(c: ReadCtx): Volume | null {
  const all = volumes(c.get(DRIVES));
  const want = c.content.opt<string>("volume");
  return all.find((v) => v.id === want) ?? all.find((v) => v.id === "/") ?? all[0] ?? null;
}

const unit = (c: ReadCtx) => c.content.opt<ByteUnit>("byteUnit");
const health = (c: ReadCtx) => {
  const v = volume(c);
  return v ? map(map(c.get(HEALTH))?.[v.drive]) : null;
};
const io = (c: ReadCtx) => {
  const v = volume(c);
  return v ? map(map(c.get(IO))?.[v.drive]) : null;
};

function rate(bps: number, u: ByteUnit): string {
  return `${bytes(bps, u, 1)}/s`;
}

function space(c: ReadCtx, key: "usedB" | "availB" | "totalB"): Reading | null {
  const v = volume(c);
  const n =
    num(v?.part?.[key]) ??
    (key === "totalB" ? (num(v?.part?.sizeB) ?? num(v?.driveInfo.sizeB)) : null);
  const total = num(v?.part?.totalB);
  return n === null
    ? null
    : {
        text: bytes(n, unit(c), c.content.decimals),
        value: n,
        ...(total ? { ratio: n / total, ramp: "load" as const } : {}),
      };
}

export const storage: WidgetDef = {
  kind: "storage",
  name: "Storage",
  icon: "hard_drive",
  category: "system",
  sizes: ["1x1", "2x1", "4x1", "S", "M", "L", "XL"],
  defaultSize: "S",
  heroStyles: ["ring", "bar", "number", "sparkline"],
  topics: [DRIVES],
  defaultFields: ["percent", "free", "activity", "health"],
  fields: [
    {
      id: "percent",
      label: "Used",
      icon: "hard_drive",
      topics: [],
      read: (c) => {
        const v = volume(c);
        const p = num(v?.part?.percent);
        const total = num(v?.part?.totalB);
        return p === null
          ? null
          : {
              text: percent(p, c.content.decimals),
              value: p,
              ratio: p / 100,
              ramp: "load",
              sub: `${v?.id ?? ""}${total ? ` · ${bytes(total, unit(c), 0)}` : ""}`,
            };
      },
    },
    {
      id: "used",
      label: "Used space",
      shortLabel: "Used",
      icon: "storage",
      topics: [],
      read: (c) => space(c, "usedB"),
    },
    { id: "free", label: "Free", icon: "check", topics: [], read: (c) => space(c, "availB") },
    { id: "total", label: "Size", icon: "storage", topics: [], read: (c) => space(c, "totalB") },
    {
      id: "activity",
      label: "Read / write",
      shortLabel: "I/O",
      icon: "swap_vert",
      topics: [IO],
      read: (c) => {
        const m = io(c);
        const r = num(m?.readBps);
        const w = num(m?.writeBps);
        return r === null && w === null
          ? null
          : {
              text: `↓ ${rate(r ?? 0, unit(c))} ↑ ${rate(w ?? 0, unit(c))}`,
              value: (r ?? 0) + (w ?? 0),
            };
      },
    },
    {
      id: "busy",
      label: "Busy",
      icon: "speed",
      topics: [IO],
      read: (c) => {
        const b = num(io(c)?.busyPercent);
        return b === null
          ? null
          : { text: percent(b, c.content.decimals), value: b, ratio: b / 100, ramp: "load" };
      },
    },
    {
      id: "temp",
      label: "Temperature",
      shortLabel: "Temp",
      icon: "thermostat",
      topics: [TEMPS, HEALTH],
      read: (c) => {
        const v = volume(c);
        const t = v ? map(map(c.get(TEMPS))?.[v.drive]) : null;
        const tc = num(t?.tempC) ?? num(health(c)?.tempC);
        if (tc === null) return null;
        const suspect = t?.suspectLow?.kind === "bool" && t.suspectLow.v;
        return {
          text: `${temperature(tc, c.content.opt<TempUnit>("tempUnit"), 0)}${suspect ? " ?" : ""}`,
          value: tc,
          ratio: (tc - 20) / 55,
          ramp: "thermal",
        };
      },
    },
    {
      id: "health",
      label: "Health",
      icon: "info",
      topics: [HEALTH],
      hero: false,
      read: (c) => {
        const h = health(c);
        if (!h) return null;
        const status = text(h.status);
        const warnings =
          h.warnings?.kind === "list"
            ? h.warnings.v.flatMap((w) => (w.kind === "text" ? [w.v] : []))
            : [];
        const used = num(h.percentUsed);
        const words: Record<string, string> = {
          "bad-sectors": "bad sectors",
          "spare-low": "spare low",
          "media-errors": "media errors",
        };
        return {
          text:
            status === "good"
              ? `Good${used !== null ? ` · ${fixed(used, 0)} % worn` : ""}`
              : `${status === "warning" ? "Warning" : (status ?? "Unknown")}${warnings.length ? `: ${warnings.map((w) => words[w] ?? w).join(", ")}` : ""}`,
        };
      },
    },
    {
      id: "written",
      label: "Written",
      shortLabel: "Written",
      icon: "upload",
      topics: [HEALTH],
      hero: false,
      read: (c) => {
        const w = num(health(c)?.writtenB);
        return w === null ? null : { text: bytes(w, unit(c), 1) };
      },
    },
    {
      id: "hours",
      label: "Powered on",
      shortLabel: "Hours",
      icon: "schedule",
      topics: [HEALTH],
      hero: false,
      read: (c) => {
        const h = num(health(c)?.powerOnHours);
        return h === null ? null : { text: `${fixed(h, 0)} h` };
      },
    },
    {
      id: "model",
      label: "Drive",
      icon: "hard_drive",
      topics: [HEALTH],
      hero: false,
      read: (c) => {
        const v = volume(c);
        const m = text(health(c)?.model) ?? text(v?.driveInfo.model);
        return m ? { text: m } : null;
      },
    },
    {
      id: "fs",
      label: "File system",
      icon: "dns",
      topics: [],
      hero: false,
      read: (c) => {
        const fs = text(volume(c)?.part?.fs);
        return fs ? { text: fs } : null;
      },
    },
    {
      id: "device",
      label: "Device",
      icon: "storage",
      topics: [],
      hero: false,
      read: (c) => {
        const v = volume(c);
        return v ? { text: v.drive } : null;
      },
    },
    {
      id: "driveKind",
      label: "Drive type",
      shortLabel: "Type",
      icon: "info",
      topics: [],
      hero: false,
      read: (c) => {
        const v = volume(c);
        if (!v) return null;
        const bus = text(v.driveInfo.bus)?.toUpperCase();
        const rot = v.driveInfo.rotational?.kind === "bool" ? v.driveInfo.rotational.v : null;
        if (bus === "NVME" || v.drive.startsWith("nvme")) return { text: "NVMe SSD" };
        if (rot === true) return { text: bus ? `${bus} HDD` : "HDD" };
        if (rot === false) return { text: bus ? `${bus} SSD` : "SSD" };
        return bus ? { text: bus } : null;
      },
    },
  ],
  options: [
    {
      kind: "source",
      key: "volume",
      label: "Volume",
      topic: DRIVES,
      choices: (v): Choice => volumes(v).map((x) => ({ value: x.id, label: x.label })),
      default: "/",
    },
    BYTE_UNIT,
    TEMP_UNIT,
    levels([85, 95], "For the main value (% used)."),
  ],
  actions(c): WidgetAction[] {
    const v = volume(c);
    const h = health(c);
    if (!v || !h) return [];
    const out: WidgetAction[] = [];
    if (h.ejectable?.kind === "bool" && h.ejectable.v)
      out.push({
        id: "eject",
        label: "Eject",
        icon: "eject",
        command: { cmd: "drive-eject", drive: v.drive },
        confirm: "Eject now?",
      });
    if (h.canPowerOff?.kind === "bool" && h.canPowerOff.v)
      out.push({
        id: "off",
        label: "Power off",
        icon: "power_settings_new",
        command: { cmd: "drive-power-off", drive: v.drive },
        confirm: "Power off the drive?",
      });
    return out;
  },
  status(c): CardStatus {
    const d = c.get(DRIVES);
    if (d === undefined) return { kind: "loading" };
    const reason = missingReason(d);
    if (reason) return { kind: "unavailable", reason: `Drives unavailable (${reason})` };
    return volume(c) ? { kind: "ready" } : { kind: "unavailable", reason: "No drives found" };
  },
};
