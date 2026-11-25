// The widget contract (brief §5.2, ADR 0011). A widget declares its data fields once; the frame
// turns them into the card (hero + rows), the content settings (which fields, order, labels,
// hero, units) and the loading / unavailable / asleep states. Custom layouts (clock, media)
// render themselves but get the same style, content and states.
import type { ReactNode } from "react";
import type { RampName } from "../design-system/color/ramps";
import type { IconName } from "../design-system/icons";
import type { ResolvedStyle } from "../design-system/style";
import type { SizeClass } from "../design-system/tokens/tokens";
import type { ActivityClass, Command, Value } from "../layer/protocol";
import type { ResolvedContent } from "./content";

export type Choice = readonly { value: string; label: string }[];

/** A content option a widget offers (beyond the common ones every widget gets). */
export type ContentOption =
  | { kind: "enum"; key: string; label: string; help?: string; options: Choice; default: string }
  | { kind: "bool"; key: string; label: string; help?: string; default: boolean }
  | {
      kind: "range";
      key: string;
      label: string;
      help?: string;
      min: number;
      max: number;
      step: number;
      unit?: string;
      default: number;
    }
  | {
      kind: "text";
      key: string;
      label: string;
      help?: string;
      maxLength: number;
      placeholder?: string;
      default: string;
    }
  | {
      /** Warning and critical levels of the hero value. */
      kind: "thresholds";
      key: string;
      label: string;
      help?: string;
      min: number;
      max: number;
      step: number;
      unit: string;
      default: readonly [number, number];
    }
  | {
      /** A choice whose options come from live data (which GPU, drive, interface, player). */
      kind: "source";
      key: string;
      label: string;
      help?: string;
      topic: string;
      choices: (v: Value | undefined) => Choice;
      default: string;
    }
  | {
      /** The weather location (a global setting, searched with core's geocoding). */
      kind: "location";
      key: string;
      label: string;
      help?: string;
      default: string;
    };

export interface ReadCtx {
  get(topic: string): Value | undefined;
  content: ResolvedContent;
}

/** One formatted reading of a field. */
export interface Reading {
  text: string;
  /** Numeric value (for the sparkline history and thresholds). */
  value?: number;
  /** 0 … 1 for ring and bar heroes. */
  ratio?: number;
  /** The meaning ramp for "By value" hero coloring. */
  ramp?: RampName;
  /** A short second line under the hero ("of 15.9 GB"). */
  sub?: string;
}

export interface FieldDef {
  id: string;
  label: string;
  /**
   * A written short form of the label for tight sizes ("Video" for "Video memory"). Never made by
   * cutting the label (2.0 brief §3.2); without one, a label that doesn't fit is hidden instead.
   */
  shortLabel?: string;
  icon?: IconName;
  /** Topics this field reads (subscribed only while the field is shown); may depend on the
   * widget's base topics and content (which GPU, which drive). */
  topics: readonly string[] | ((ctx: ReadCtx) => readonly string[]);
  /** `null` = no data for this field right now (shown as "—"). */
  read(ctx: ReadCtx): Reading | null;
  /** Can be the hero (default true). */
  hero?: boolean;
  /** Core's history series of this field, to backfill the sparkline. */
  series?: string;
}

/** A button on the card (M and larger): eject, power mode, start Docker Desktop. */
export interface WidgetAction {
  id: string;
  label: string;
  icon: IconName;
  command: Command;
  /** Ask first ("Power off the drive?"). */
  confirm?: string;
  /** Shown as selected (the active power profile). */
  active?: boolean;
}

export type HeroStyle = "ring" | "bar" | "sparkline" | "number";

export type CardStatus =
  | { kind: "ready" }
  | { kind: "loading" }
  | { kind: "unavailable"; reason: string }
  | { kind: "asleep"; reason: string }
  | { kind: "needs-permission"; reason: string };

export interface RenderCtx extends ReadCtx {
  size: SizeClass;
  style: ResolvedStyle;
  /** Readings of the visible fields in the user's order (hero first when it's a field). */
  readings: readonly { field: FieldDef; label: string; reading: Reading | null }[];
}

export interface WidgetDef {
  /** Stable kind id (`settings.json` `widgets.*.kind`). */
  kind: string;
  name: string;
  icon: IconName;
  category: "system" | "time" | "media" | "network" | "info";
  sizes: readonly SizeClass[];
  defaultSize: SizeClass;
  fields: readonly FieldDef[];
  /** Field ids shown by default, in order. */
  defaultFields: readonly string[];
  /** Hero visuals this widget supports (first = default). Omit for custom layouts. */
  heroStyles?: readonly HeroStyle[];
  /** Topics always needed (besides the visible fields'). */
  topics?: readonly string[];
  /** More topics that depend on the base topics and content (the chosen GPU's state). */
  extraTopics?: (ctx: ReadCtx) => readonly string[];
  /** Widget-specific options. */
  options?: readonly ContentOption[];
  /** Whether the widget can show anything (else the reason). */
  status(ctx: ReadCtx): CardStatus;
  /** Buttons under the standard layout. */
  actions?: (ctx: ReadCtx) => readonly WidgetAction[];
  /** Custom layout; omit to use the standard hero + rows layout. */
  render?: (ctx: RenderCtx) => ReactNode;
  /** The activity class its topics are subscribed at while visible. */
  activity?: ActivityClass;
}

/** Common to every widget; stored in `content` next to the widget's own options. */
export interface CommonContent {
  title: string;
  showTitle: boolean;
  fields: string[];
  labels: Record<string, string>;
  hero: string;
  heroStyle: HeroStyle;
  historyMinutes: number;
  decimals: number;
  updateRate: "fast" | "normal" | "relaxed";
}
