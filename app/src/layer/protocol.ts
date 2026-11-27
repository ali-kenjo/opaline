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
  work_area?: [number, number, number, number] | null;
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
  | { event: "peek-monitor-requested"; connector: string }
  | { event: "edit-requested" }
  | { event: "updates-paused"; paused: boolean }
  | { event: "alert-opened"; rule: string }
  | { event: "desktop-focus-changed"; focused: boolean }
  | { event: "backend-changed"; backend: BackendKind }
  | { event: "layer-covered"; connector: string; covered: boolean };

export type Command =
  | { cmd: "drive-eject"; drive: string }
  | { cmd: "drive-power-off"; drive: string }
  | { cmd: "set-power-profile"; profile: string }
  | { cmd: "media"; player: string; action: MediaAction }
  | { cmd: "media-seek"; player: string; position_us: number }
  | { cmd: "media-shuffle"; player: string; shuffle: boolean }
  | { cmd: "media-loop"; player: string; status: "None" | "Track" | "Playlist" }
  | { cmd: "media-volume"; player: string; volume: number }
  | { cmd: "end-task"; pid: number; start: number; force: boolean }
  | { cmd: "container"; id: string; action: "start" | "stop" | "restart" }
  | { cmd: "start-docker-desktop" }
  | { cmd: "update-settings"; patch: Value }
  | { cmd: "update-layouts"; layouts: Value }
  | { cmd: "geocode-search"; query: string; language: string }
  | { cmd: "history"; series: string; seconds: number }
  | { cmd: "list-fonts" }
  | { cmd: "open-settings" }
  | { cmd: "release-focus" }
  | { cmd: "run-source-now"; id: string }
  | { cmd: "set-variable"; name: string; value: Value }
  | { cmd: "save-custom-widget"; widget: Value }
  | { cmd: "delete-custom-widget"; id: string }
  | { cmd: "control-toggle"; control: string; enabled: boolean }
  | { cmd: "control-set-slider"; control: string; percent: number; target?: string }
  | { cmd: "launch-target"; kind: "app" | "url" | "path"; target: string }
  | { cmd: "note-save"; id: string; body: string; expected_sha256?: string }
  | { cmd: "note-toggle-checkbox"; id: string; line: number }
  | { cmd: "todo-add"; text: string; priority?: string; due?: string }
  | { cmd: "todo-toggle"; index: number }
  | { cmd: "todo-delete"; index: number }
  | {
      cmd: "timer-action";
      action: "start" | "pause" | "reset" | "lap" | "add" | "delete" | "next-phase";
      id: string;
      label?: string;
      duration_s?: number;
      kind?: "timer" | "stopwatch" | "pomodoro";
    }
  | {
      cmd: "ha-toggle-entity";
      base_url: string;
      entity_id: string;
      secret_name: string;
      allow_local_http?: boolean;
    }
  | {
      cmd: "n8n-set-workflow-active";
      base_url: string;
      workflow_id: string;
      active: boolean;
      secret_name: string;
      allow_local_http?: boolean;
    }
  | { cmd: "fetch-feed"; url: string };

export type MediaAction = "play" | "pause" | "play-pause" | "next" | "previous";

export type CommandResult =
  { result: "ok" } | { result: "data"; value: Value } | { result: "err"; reason: string };

export type ActivityClass = "idle" | "covered" | "ambient" | "interactive";

export type LayerEvent =
  | { kind: "connecting"; attempt: number }
  | {
      kind: "connected";
      coreVersion: string;
      backend: BackendKind;
      monitor: Monitor | null;
      monitors?: Monitor[];
    }
  | { kind: "rejected"; reason: string }
  | { kind: "update"; seq: number; atMs: number; updates: TopicUpdate[] }
  | { kind: "spectrum"; seq: number; levels: number[] }
  | { kind: "waveform"; seq: number; samples: number[] }
  | {
      kind: "stereo";
      seq: number;
      leftRms: number;
      rightRms: number;
      left: number[];
      right: number[];
    }
  | { kind: "geometry"; x: number; y: number; width: number; height: number }
  | { kind: "peek"; active: boolean }
  | { kind: "edit"; active: boolean }
  | { kind: "core-event"; event: CoreEvent };
