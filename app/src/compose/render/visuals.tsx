// Built-in visuals for the `canvas` block (docs/COMPOSITION.md §3): things a tree of blocks
// can't express. Each takes its evaluated params and the widget's animation flag.
import type { ReactNode } from "react";
import { AnalogClock, ClockFace, type VisualProps } from "./clockVisuals";
import {
  AppListVisual,
  CoreBarsVisual,
  GpuEnginesVisual,
  LiquidFillVisual,
  StackedBarVisual,
  ThermalBadgeVisual,
} from "./monitorVisuals";
import {
  BatteryPillVisual,
  DriveListVisual,
  FanGaugesVisual,
  FanSpinnerVisual,
  NetWaveVisual,
  PeripheralListVisual,
  WifiShapeVisual,
} from "./round2Visuals";

export type { VisualProps };

export const VISUALS: Readonly<Record<string, (p: VisualProps) => ReactNode>> = {
  "analog-clock": AnalogClock,
  "clock-face": ClockFace,
  "thermal-badge": ThermalBadgeVisual,
  "liquid-fill": LiquidFillVisual,
  "stacked-bar": StackedBarVisual,
  "core-bars": CoreBarsVisual,
  "app-list": AppListVisual,
  "gpu-engines": GpuEnginesVisual,
  "drive-list": DriveListVisual,
  "net-wave": NetWaveVisual,
  "wifi-shape": WifiShapeVisual,
  "battery-pill": BatteryPillVisual,
  "peripheral-list": PeripheralListVisual,
  "fan-spinner": FanSpinnerVisual,
  "fan-gauges": FanGaugesVisual,
};
