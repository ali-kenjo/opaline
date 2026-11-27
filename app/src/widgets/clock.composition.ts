// The Clock as a composition (PLAN-2 2.8 & 4.1). Kept equal to spec/compositions/clock.json,
// which the Rust validator checks (clock.test.ts compares them; OPALINE_UPDATE_FIXTURES=1 rewrites it).
//
// Supports all 11 faces (digital inline/stacked, expressive, analog ×6 dials, flip, word,
// typographic, segment, binary, terminal, day-ring, big-date), per-element colors, second hand
// modes (tick/sweep/hide), custom ICU date skeleton, second time zone, and optional next-event
// subline.
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

const subline = (id: string): Node => ({
  id,
  type: "text",
  role: "caption",
  text: "{bind.sublineText}",
  visible: "opt.subline == 'next-event' && len(bind.sublineText) > 0",
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
  params: {
    ms: "now()",
    zone: "bind.zone",
    seconds: "bind.seconds",
    dialStyle: "opt.dialStyle",
    secondHand: "opt.secondHand",
    handColor: "opt.handColor",
    tickColor: "opt.tickColor",
    numeralColor: "opt.numeralColor",
  },
});

const customFace = (id: string): Node => ({
  id,
  type: "canvas",
  visual: "clock-face",
  label: "{bind.timeSeconds}",
  params: {
    ms: "now()",
    face: "bind.faceKey",
    zone: "bind.zone",
    h24: "bind.h24",
    seconds: "bind.seconds",
    dateText: "bind.dateText",
    numeralColor: "opt.numeralColor",
  },
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
    customFace:
      "(opt.face != 'digital' && opt.face != 'analog') || (opt.face == 'digital' && opt.digitalLayout == 'stacked')",
    faceKey: "if(opt.face == 'digital', 'stacked', opt.face)",
    dateText: "date(now(), opt.dateSkeleton, bind.zone)",
    sublineText:
      "if(opt.subline == 'next-event' && len(calendar.events) > 0, (calendar.events[0].title ?? '') + ' · ' + date(calendar.events[0].startMs, if(bind.h24, 'Hm', 'hm'), bind.zone), '')",
  },
  layouts: [
    {
      sizes: ["1x1"],
      root: {
        id: "face",
        type: "column",
        align: "center",
        justify: "center",
        children: [
          { ...analog("analog"), visible: "opt.face == 'analog'" },
          { ...customFace("custom"), visible: "bind.customFace" },
          {
            ...time("time", "bind.time"),
            visible:
              "has(opt.fields, 'time') && opt.face == 'digital' && opt.digitalLayout != 'stacked'",
          },
        ],
      },
    },
    {
      sizes: ["2x1", "4x1"],
      root: {
        id: "face",
        type: "column",
        justify: "center",
        gap: 2,
        children: [
          { ...customFace("custom"), visible: "bind.customFace" },
          {
            ...time("time", "bind.timeSeconds"),
            visible: "has(opt.fields, 'time') && !bind.customFace",
          },
          { ...lines("lines", 2), visible: "!bind.customFace" },
          subline("subline"),
        ],
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
          { ...customFace("custom"), visible: "bind.customFace" },
          {
            ...time("time", "bind.timeSeconds"),
            visible:
              "has(opt.fields, 'time') && opt.face == 'digital' && opt.digitalLayout != 'stacked'",
          },
          { ...lines("lines", 2), visible: "!bind.customFace" },
          subline("subline"),
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
            visible: "opt.face == 'digital' && opt.digitalLayout != 'stacked'",
            children: [time("time", "bind.timeSeconds"), lines("lines", 6), subline("subline")],
          },
          {
            id: "custom-face",
            type: "row",
            align: "center",
            gap: 4,
            grow: 1,
            visible: "bind.customFace",
            children: [
              customFace("custom"),
              {
                id: "custom-meta",
                type: "column",
                justify: "center",
                gap: 1,
                visible: "opt.face != 'terminal' && opt.face != 'big-date'",
                children: [lines("custom-lines", 4), subline("custom-subline")],
              },
            ],
          },
        ],
      },
    },
  ],
};
