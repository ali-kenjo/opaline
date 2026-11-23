import { describe, expect, it } from "vitest";
import type { Monitor } from "./protocol";
import { type LayerState, reduce } from "./store";

const edp: Monitor = {
  key: "AUO-0x82ed-0x00000000:eDP-1",
  connector: "eDP-1",
  vendor: "AUO",
  product: "0x82ed",
  serial: "0x00000000",
  x: 0,
  y: 0,
  width: 1536,
  height: 864,
  scale: 1.25,
  primary: true,
  builtin: true,
};

function base(): LayerState {
  return {
    connection: { state: "connecting", attempt: 0 },
    monitor: null,
    values: {},
    geometry: null,
    desktopFocused: null,
    peekRequests: 0,
    editRequests: 0,
    updatesPaused: false,
    apply: () => undefined,
  };
}

describe("layer reducer", () => {
  it("records the connection and this window's monitor", () => {
    const next = reduce(base(), {
      kind: "connected",
      coreVersion: "0.1.0",
      backend: "instant",
      monitor: edp,
    });
    expect(next.connection).toEqual({
      state: "connected",
      coreVersion: "0.1.0",
      backend: "instant",
    });
    expect(next.monitor).toBe(edp);
  });

  it("merges topic updates without dropping other topics", () => {
    const state = { ...base(), values: { "a.b": { kind: "num", v: 1 } as const } };
    const next = reduce(state, {
      kind: "update",
      seq: 1,
      atMs: 0,
      updates: [{ topic: "system.loadavg", value: { kind: "nums", v: [0.5, 0.4, 0.3] } }],
    });
    expect(next.values).toEqual({
      "a.b": { kind: "num", v: 1 },
      "system.loadavg": { kind: "nums", v: [0.5, 0.4, 0.3] },
    });
  });

  it("follows geometry changes of its own monitor", () => {
    const state = { ...base(), monitor: edp };
    const moved = { ...edp, x: 100 };
    const next = reduce(state, {
      kind: "core-event",
      event: { event: "monitors-changed", monitors: [moved] },
    });
    expect(next.monitor).toEqual(moved);
  });
});
