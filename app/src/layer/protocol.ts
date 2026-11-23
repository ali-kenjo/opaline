// Mirrors the serde shapes of `opaline-ipc` and of the layer's `LayerEvent`
// (app/src-tauri/src/layer/bridge.rs). Keep both sides in sync.

export type BackendKind = "native" | "instant";

export interface Monitor {
  key: string;
  connector: string;
  vendor: string;
  product: string;
  serial: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  primary: boolean;
  builtin: boolean;
}

export type Availability =
  | { state: "unavailable"; reason: string }
  | { state: "asleep" }
  | { state: "needs-permission"; fix: string };

export type Value =
  | { kind: "num"; v: number }
  | { kind: "nums"; v: number[] }
  | { kind: "text"; v: string }
  | { kind: "bool"; v: boolean }
  | { kind: "list"; v: Value[] }
  | { kind: "map"; v: Record<string, Value> }
  | { kind: "missing"; v: Availability };

export interface TopicUpdate {
  topic: string;
  value: Value;
}

export type CoreEvent =
  | { event: "monitors-changed"; monitors: Monitor[] }
  | { event: "peek-requested" }
  | { event: "edit-requested" }
  | { event: "updates-paused"; paused: boolean };

export type ActivityClass = "idle" | "covered" | "ambient" | "interactive";

export type LayerEvent =
  | { kind: "connecting"; attempt: number }
  | { kind: "connected"; coreVersion: string; backend: BackendKind; monitor: Monitor | null }
  | { kind: "rejected"; reason: string }
  | { kind: "update"; seq: number; atMs: number; updates: TopicUpdate[] }
  | { kind: "core-event"; event: CoreEvent };
