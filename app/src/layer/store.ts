import { create } from "zustand";
import type { BackendKind, LayerEvent, Monitor, Value } from "./protocol";

export type Connection =
  | { state: "standalone" }
  | { state: "connecting"; attempt: number }
  | { state: "connected"; coreVersion: string; backend: BackendKind }
  | { state: "rejected"; reason: string };

export interface LayerState {
  connection: Connection;
  monitor: Monitor | null;
  monitors: Monitor[];
  values: Readonly<Record<string, Value>>;
  updatesPaused: boolean;
  /** This window's rectangle in global logical pixels (for wallpaper alignment). */
  geometry: { x: number; y: number; width: number; height: number } | null;
  /** Native mode: the desktop has focus (Automatic appearance). Null until core says. */
  desktopFocused: boolean | null;
  /** Native mode: this monitor's layer is covered by a maximized/fullscreen window. */
  covered: boolean;
  /** Shared Peek state across every monitor window. */
  peek: boolean;
  /** Shared Edit mode state across every monitor window. */
  edit: boolean;
  /** Rule id from an alert notification's "Open" action. */
  alertRule: string | null;
  /** Peek requests counted, so every request toggles once. */
  peekRequests: number;
  editRequests: number;
  apply: (event: LayerEvent) => void;
}

/** Pure reducer, exported for tests. */
export function reduce(state: LayerState, event: LayerEvent): Partial<LayerState> {
  switch (event.kind) {
    case "connecting":
      return { connection: { state: "connecting", attempt: event.attempt } };
    case "connected":
      return {
        connection: {
          state: "connected",
          coreVersion: event.coreVersion,
          backend: event.backend,
        },
        monitor: event.monitor,
        monitors: event.monitors ?? (event.monitor ? [event.monitor] : state.monitors),
      };
    case "rejected":
      return { connection: { state: "rejected", reason: event.reason } };
    case "update": {
      const values = { ...state.values };
      for (const u of event.updates) values[u.topic] = u.value;
      return { values };
    }
    case "spectrum":
    case "waveform":
    case "stereo":
      // Routed to the visualizer directly (widgets/spectrum.ts), never through the store.
      return {};
    case "geometry":
      return { geometry: { x: event.x, y: event.y, width: event.width, height: event.height } };
    case "peek":
      return { peek: event.active };
    case "edit":
      return { edit: event.active };
    case "core-event":
      switch (event.event.event) {
        case "updates-paused":
          return { updatesPaused: event.event.paused };
        case "monitors-changed": {
          const key = state.monitor?.key;
          const monitor = event.event.monitors.find((m) => m.key === key) ?? state.monitor;
          return { monitor, monitors: event.event.monitors };
        }
        case "peek-requested":
          return { peekRequests: state.peekRequests + 1 };
        case "peek-monitor-requested":
          return !event.event.connector || state.monitor?.connector === event.event.connector
            ? { peekRequests: state.peekRequests + 1 }
            : {};
        case "edit-requested":
          return { editRequests: state.editRequests + 1 };
        case "desktop-focus-changed":
          return { desktopFocused: event.event.focused };
        case "backend-changed":
          return state.connection.state === "connected"
            ? { connection: { ...state.connection, backend: event.event.backend } }
            : {};
        case "layer-covered":
          return state.monitor?.connector === event.event.connector
            ? { covered: event.event.covered }
            : {};
        case "alert-opened":
          return { alertRule: event.event.rule };
      }
  }
}

export const useLayer = create<LayerState>()((set) => ({
  connection: { state: "connecting", attempt: 0 },
  monitor: null,
  monitors: [],
  values: {},
  updatesPaused: false,
  geometry: null,
  desktopFocused: null,
  covered: false,
  peek: false,
  edit: false,
  alertRule: null,
  peekRequests: 0,
  editRequests: 0,
  apply: (event) => {
    set((state) => reduce(state, event));
  },
}));
