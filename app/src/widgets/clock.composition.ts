// The Clock as a composition (PLAN-2 2.8). Kept equal to spec/compositions/clock.json, which the
// Rust validator checks (clock.test.ts compares them; OPALINE_UPDATE_FIXTURES=1 rewrites it).
//
// Names it reads besides clock.settings: opt.face, opt.format, opt.seconds, opt.zone (validated),
// opt.zone2 (validated), opt.zone2Name, opt.dateSkeleton, opt.weekLabel, opt.systemZone and
// opt.lines (the shown fields other than the time, in the user's order).
import type { Composition, Node } from "../compose/model.gen";

/** One line per shown field, in the user's order. */
const LINE =
  "{if($item == 'date', date(now(), opt.dateSkeleton, bind.zone), " +
  "if($item == 'weekday', date(now(), 'EEEE', bind.zone), " +
  "if($item == 'week', opt.weekLabel + ' ' + date(now(), 'w', bind.zone), " +
  "if($item == 'zone', bind.zone ?? opt.systemZone, " +
  "if($item == 'zone2', opt.zone2Name + ' ' + date(now(), if(bind.h24, 'Hm', 'hm'), opt.zone2), '')))))}";

const lines = (id: string, max: number): Node => ({
  id,
  type: "list",
  items: "opt.lines",
  max,
  gap: 0,
  item: {
    id: `${id}-line`,
    type: "text",
    role: "caption",
    text: LINE,
    shorter: [
      "{if($item == 'date', date(now(), 'MMMEd', bind.zone), '')}",
      "{if($item == 'date', date(now(), 'MMMd', bind.zone), '')}",
    ],
  },
});

const time = (id: string, value: string): Node => ({
  id,
  type: "number",
  role: "hero",
  value,
  motion: "odometer",
  visible: "has(opt.fields, 'time')",
});

const analog = (id: string): Node => ({
  id,
  type: "canvas",
  visual: "analog-clock",
  label: "{bind.timeSeconds}",
  params: { ms: "now()", zone: "bind.zone", seconds: "bind.seconds" },
});

export const clockComposition: Composition = {
  version: 1,
  bindings: {
    h24: "if(opt.format == 'system', clock.settings.format24h ?? true, opt.format == '24')",
    seconds:
      "if(opt.seconds == 'system', clock.settings.showSeconds ?? false, opt.seconds == 'on')",
    zone: "if(len(opt.zone) > 0, opt.zone, clock.settings.timezone)",
    time: "date(now(), if(bind.h24, 'Hm', 'hm'), bind.zone)",
    // Only a clock that shows seconds reads them, so a minute clock wakes once a minute.
    timeSeconds: "if(bind.seconds, date(now(), if(bind.h24, 'Hms', 'hms'), bind.zone), bind.time)",
  },
  layouts: [
    {
      sizes: ["1x1"],
      root: {
        id: "face",
        type: "column",
        align: "center",
        justify: "center",
        children: [time("time", "bind.time")],
      },
    },
    {
      sizes: ["2x1", "4x1"],
      root: {
        id: "face",
        type: "column",
        justify: "center",
        gap: 2,
        children: [time("time", "bind.timeSeconds"), lines("lines", 2)],
      },
    },
    {
      sizes: ["S"],
      root: {
        id: "face",
        type: "column",
        justify: "center",
        gap: 2,
        children: [
          { ...analog("analog"), visible: "opt.face == 'analog'" },
          {
            ...time("time", "bind.timeSeconds"),
            visible: "has(opt.fields, 'time') && opt.face != 'analog'",
          },
          lines("lines", 2),
        ],
      },
    },
    {
      sizes: ["M", "L"],
      root: {
        id: "face",
        type: "column",
        justify: "center",
        children: [
          {
            id: "analog-face",
            type: "row",
            align: "center",
            gap: 4,
            grow: 1,
            visible: "opt.face == 'analog'",
            children: [analog("analog"), lines("analog-lines", 6)],
          },
          {
            id: "digital-face",
            type: "column",
            justify: "center",
            gap: 2,
            grow: 1,
            visible: "opt.face != 'analog'",
            children: [time("time", "bind.timeSeconds"), lines("lines", 6)],
          },
        ],
      },
    },
  ],
};
