// Every widget kind Opaline ships (no third-party widgets in 1.0), in the brief's order.
import { battery } from "./battery";
import { calendar } from "./calendar";
import { clock } from "./clock";
import { cpu } from "./cpu";
import { docker } from "./docker";
import { fansWidget } from "./fans";
import { gpu } from "./gpu";
import { media } from "./media";
import { memory } from "./memory";
import { network } from "./network";
import { processes } from "./processes";
import { storage } from "./storage";
import type { WidgetDef } from "./types";
import { visualizer } from "./visualizer";
import { weather } from "./weather";

export const WIDGETS: readonly WidgetDef[] = [
  clock,
  cpu,
  memory,
  gpu,
  storage,
  network,
  battery,
  processes,
  fansWidget,
  media,
  visualizer,
  weather,
  calendar,
  docker,
];

export function widgetByKind(kind: string): WidgetDef | undefined {
  return WIDGETS.find((w) => w.kind === kind);
}
