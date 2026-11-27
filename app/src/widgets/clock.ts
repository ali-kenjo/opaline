// Clock widget (PLAN-2 4.1, brief §8.1): 11 faces (Digital inline/stacked, Expressive, Analog ×6
// dials, Flip, Word, Typographic, Segment, Binary, Terminal, Day ring, Big date), per-element
// colors, second hand modes, custom ICU skeleton date, second zone, and optional next-event
// subline. Drawn by the composition engine (clock.composition.ts).
import { defaultOptions } from "../compose/widget";
import { clockComposition } from "./clock.composition";
import type { CardStatus, WidgetDef } from "./types";

const SETTINGS = "clock.settings";

/** An IANA zone this system knows, or "" (empty follows the system). */
export function validZone(zone: string): string {
  const z = zone.trim();
  if (!z) return "";
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: z });
    return z;
  } catch {
    return "";
  }
}

const DATE_SKELETONS: Record<string, string> = {
  full: "yMMMMEEEEd",
  long: "yMMMMd",
  medium: "yMMMd",
  short: "yMd",
};

export const clock: WidgetDef = {
  kind: "clock",
  name: "Clock",
  icon: "schedule",
  category: "time",
  sizes: ["1x1", "2x1", "4x1", "S", "M", "L"],
  defaultSize: "M",
  topics: [SETTINGS],
  extraTopics: (c) =>
    c.content.opt<string>("subline") === "next-event" ? ["calendar.events"] : [],
  defaultFields: ["time", "date"],
  fields: [
    {
      id: "time",
      label: "Time",
      icon: "schedule",
      topics: [],
      hero: false,
      read: () => ({ text: "" }),
    },
    {
      id: "date",
      label: "Date",
      icon: "calendar_today",
      topics: [],
      hero: false,
      read: () => ({ text: "" }),
    },
    {
      id: "weekday",
      label: "Weekday",
      icon: "event",
      topics: [],
      hero: false,
      read: () => ({ text: "" }),
    },
    {
      id: "week",
      label: "Week",
      icon: "event",
      topics: [],
      hero: false,
      read: () => ({ text: "" }),
    },
    {
      id: "zone",
      label: "Time zone",
      icon: "public",
      topics: [],
      hero: false,
      read: () => ({ text: "" }),
    },
    {
      id: "zone2",
      label: "Second time zone",
      icon: "language",
      topics: [],
      hero: false,
      read: () => ({ text: "" }),
    },
  ],
  options: [
    {
      kind: "enum",
      key: "face",
      label: "Face",
      options: [
        { value: "digital", label: "Digital" },
        { value: "expressive", label: "Expressive" },
        { value: "analog", label: "Analog" },
        { value: "flip", label: "Flip" },
        { value: "word", label: "Word clock" },
        { value: "typographic", label: "Typographic" },
        { value: "segment", label: "Segment / LCD" },
        { value: "binary", label: "Binary" },
        { value: "terminal", label: "Terminal" },
        { value: "day-ring", label: "Day ring" },
        { value: "big-date", label: "Big date" },
      ],
      default: "digital",
    },
    {
      kind: "enum",
      key: "digitalLayout",
      label: "Digital layout",
      options: [
        { value: "inline", label: "Inline (10:09)" },
        { value: "stacked", label: "Stacked" },
      ],
      default: "inline",
    },
    {
      kind: "enum",
      key: "dialStyle",
      label: "Analog dial",
      options: [
        { value: "minimal", label: "Minimal" },
        { value: "classic", label: "Classic" },
        { value: "numerals", label: "Numerals" },
        { value: "roman", label: "Roman" },
        { value: "chronograph", label: "Chronograph" },
        { value: "railway", label: "Railway" },
      ],
      default: "minimal",
    },
    {
      kind: "enum",
      key: "secondHand",
      label: "Second hand",
      options: [
        { value: "tick", label: "Tick" },
        { value: "sweep", label: "Sweep" },
        { value: "hide", label: "Hide" },
      ],
      default: "tick",
    },
    {
      kind: "enum",
      key: "format",
      label: "Time format",
      options: [
        { value: "system", label: "Like the system" },
        { value: "24", label: "24-hour" },
        { value: "12", label: "12-hour" },
      ],
      default: "system",
    },
    {
      kind: "enum",
      key: "seconds",
      label: "Seconds",
      options: [
        { value: "system", label: "Like the system" },
        { value: "on", label: "Show" },
        { value: "off", label: "Hide" },
      ],
      default: "system",
    },
    {
      kind: "enum",
      key: "dateStyle",
      label: "Date style",
      options: [
        { value: "full", label: "Monday, 23 November 2026" },
        { value: "long", label: "23 November 2026" },
        { value: "medium", label: "23 Nov 2026" },
        { value: "short", label: "23/11/2026" },
        { value: "custom", label: "Custom ICU skeleton" },
      ],
      default: "full",
    },
    {
      kind: "text",
      key: "dateSkeleton",
      label: "Custom date skeleton",
      help: "ICU skeleton such as EEE d MMM or yMMMd (used when Date style is Custom).",
      maxLength: 32,
      placeholder: "EEE d MMM",
      default: "",
    },
    {
      kind: "enum",
      key: "subline",
      label: "Subline",
      options: [
        { value: "none", label: "None" },
        { value: "next-event", label: "Next calendar event" },
      ],
      default: "none",
    },
    {
      kind: "text",
      key: "handColor",
      label: "Hand color",
      help: "Optional hex color for analog clock hands (empty uses theme ink).",
      maxLength: 24,
      placeholder: "Theme default",
      default: "",
    },
    {
      kind: "text",
      key: "tickColor",
      label: "Tick color",
      help: "Optional hex color for dial ticks.",
      maxLength: 24,
      placeholder: "Theme default",
      default: "",
    },
    {
      kind: "text",
      key: "numeralColor",
      label: "Numeral color",
      help: "Optional hex color for clock digits or dial numerals.",
      maxLength: 24,
      placeholder: "Theme default",
      default: "",
    },
    {
      kind: "text",
      key: "zone",
      label: "Time zone",
      help: "IANA name like Europe/Berlin; empty follows the system.",
      maxLength: 64,
      placeholder: "System",
      default: "",
    },
    {
      kind: "text",
      key: "zone2",
      label: "Second time zone",
      help: "Shown when the Second time zone field is on.",
      maxLength: 64,
      placeholder: "America/New_York",
      default: "",
    },
    {
      kind: "text",
      key: "zone2Label",
      label: "Second zone name",
      maxLength: 32,
      placeholder: "City name",
      default: "",
    },
  ],
  status(): CardStatus {
    // The clock works without core: system settings only refine it.
    return { kind: "ready" };
  },
  composition: clockComposition,
  compositionOptions(content) {
    const zone2 = validZone(content.opt<string>("zone2"));
    const custom = content.opt<string>("zone2Label").trim();
    const dateStyle = content.opt<string>("dateStyle");
    const customSkel = content.opt<string>("dateSkeleton").trim();
    const dateSkeleton =
      dateStyle === "custom" && customSkel !== ""
        ? customSkel
        : (DATE_SKELETONS[dateStyle] ?? "yMMMMEEEEd");
    return {
      ...defaultOptions(clock, content),
      zone: validZone(content.opt<string>("zone")),
      zone2,
      zone2Name: custom !== "" ? custom : (zone2.split("/").pop()?.replace(/_/g, " ") ?? zone2),
      dateSkeleton,
      weekLabel: content.label("week", "Week"),
      systemZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      // The lines under the time: the shown fields in the user's order (a second zone only
      // when one is set).
      lines: content.fields.filter((f) => f !== "time" && (f !== "zone2" || zone2 !== "")),
    };
  },
};
