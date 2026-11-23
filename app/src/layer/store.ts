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
  values: Readonly<Record<string, Value>>;
  updatesPaused: boolean;
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
      };
    case "rejected":
      return { connection: { state: "rejected", reason: event.reason } };
    case "update": {
      const values = { ...state.values };
      for (const u of event.updates) values[u.topic] = u.value;
      return { values };
    }
    case "spectrum":
      // Routed to the visualizer directly (widgets/spectrum.ts), never through the store.
      return {};
    case "core-event":
      switch (event.event.event) {
        case "updates-paused":
          return { updatesPaused: event.event.paused };
        case "monitors-changed": {
          const key = state.monitor?.key;
          const monitor = event.event.monitors.find((m) => m.key === key) ?? state.monitor;
          return { monitor };
        }
        case "peek-requested":
        case "edit-requested":
        case "alert-opened":
          // Peek, Edit and detail views arrive with Phases 3–5; nothing to show yet.
          return {};
      }
  }
}

export const useLayer = create<LayerState>()((set) => ({
  connection: { state: "connecting", attempt: 0 },
  monitor: null,
  values: {},
  updatesPaused: false,
  apply: (event) => {
    set((state) => reduce(state, event));
  },
}));
