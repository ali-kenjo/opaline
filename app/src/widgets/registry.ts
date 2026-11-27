// Every built-in widget kind Opaline 2.0 ships (14 redesigned 1.x + 16 new Phase 7 widgets).
import { auraWidget } from "./aura";
import { battery } from "./battery";
import { calendar } from "./calendar";
import { clock } from "./clock";
import { controlsWidget } from "./controls";
import { countdownWidget } from "./countdown";
import { cpu } from "./cpu";
import { customWidgetByKind } from "./customWidgets";
import { decorationWidget } from "./decoration";
import {
  feedsWidget,
  githubWidget,
  homeAssistantWidget,
  mqttWidget,
  n8nWidget,
} from "./devWidgets";
import { docker } from "./docker";
import { fansWidget } from "./fans";
import { gpu } from "./gpu";
import { media } from "./media";
import { memory } from "./memory";
import { network } from "./network";
import { notesWidget } from "./notes";
import { photoFrameWidget } from "./photoFrame";
import { processes } from "./processes";
import { quoteWidget } from "./quote";
import { storage } from "./storage";
import { sunMoonWidget } from "./sunMoon";
import { timersWidget } from "./timers";
import { todoWidget } from "./todo";
import type { WidgetDef } from "./types";
import { visualizer } from "./visualizer";
import { weather } from "./weather";
import { worldClockWidget } from "./worldClock";

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
  // Phase 7 — Controls, Personal & Time, Photos & Ambient, Developer & Online
  controlsWidget,
  notesWidget,
  todoWidget,
  timersWidget,
  countdownWidget,
  worldClockWidget,
  photoFrameWidget,
  sunMoonWidget,
  quoteWidget,
  auraWidget,
  decorationWidget,
  githubWidget,
  homeAssistantWidget,
  mqttWidget,
  feedsWidget,
  n8nWidget,
];

export function widgetByKind(kind: string): WidgetDef | undefined {
  return WIDGETS.find((w) => w.kind === kind) ?? customWidgetByKind(kind);
}
