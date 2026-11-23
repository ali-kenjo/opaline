// Every widget kind Opaline ships (no third-party widgets in 1.0).
import { clock } from "./clock";
import { cpu } from "./cpu";
import type { WidgetDef } from "./types";

export const WIDGETS: readonly WidgetDef[] = [clock, cpu];

export function widgetByKind(kind: string): WidgetDef | undefined {
  return WIDGETS.find((w) => w.kind === kind);
}
