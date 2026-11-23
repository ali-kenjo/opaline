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

export type Command =
  | { cmd: "drive-eject"; drive: string }
  | { cmd: "drive-power-off"; drive: string }
  | { cmd: "set-power-profile"; profile: string }
  | { cmd: "media"; player: string; action: MediaAction }
  | { cmd: "media-seek"; player: string; position_us: number }
  | { cmd: "end-task"; pid: number; start: number; force: boolean }
  | { cmd: "container"; id: string; action: "start" | "stop" | "restart" }
  | { cmd: "start-docker-desktop" }
  | { cmd: "update-settings"; patch: Value }
  | { cmd: "geocode-search"; query: string; language: string }
  | { cmd: "history"; series: string; seconds: number };

export type MediaAction = "play" | "pause" | "play-pause" | "next" | "previous";

export type CommandResult =
  { result: "ok" } | { result: "data"; value: Value } | { result: "err"; reason: string };

export type ActivityClass = "idle" | "covered" | "ambient" | "interactive";

export type LayerEvent =
  | { kind: "connecting"; attempt: number }
  | { kind: "connected"; coreVersion: string; backend: BackendKind; monitor: Monitor | null }
  | { kind: "rejected"; reason: string }
  | { kind: "update"; seq: number; atMs: number; updates: TopicUpdate[] }
  | { kind: "core-event"; event: CoreEvent };
