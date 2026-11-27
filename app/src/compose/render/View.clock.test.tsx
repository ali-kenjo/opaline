// The Clock keeps following the system clock (regression: the view computed its wake time in its
// own render body, before its children had read anything, so the timer was never armed or went
// stale after a tick or two and the Clock froze). Real Clock composition, fake timers and Date.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clock } from "../../widgets/clock";
import { clockComposition } from "../../widgets/clock.composition";
import { resolveContent } from "../../widgets/content";
import { formatDate } from "../dates";
import { Runtime, type Env } from "../runtime";
import { CompositionView } from "./View";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!("ResizeObserver" in globalThis)) {
    const noop = () => undefined;
    globalThis.ResizeObserver = class {
      observe = noop;
      unobserve = noop;
      disconnect = noop;
    };
  }
});

// 2026-11-23 09:09:20.100 UTC: not on a second or minute boundary.
const START = Date.UTC(2026, 10, 23, 9, 9, 20, 100);

let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.setSystemTime(START);
});

afterEach(() => {
  if (root) {
    const r = root;
    act(() => {
      r.unmount();
    });
  }
  root = null;
  host?.remove();
  host = null;
  vi.useRealTimers();
});

function options(content: Record<string, unknown>) {
  const c = resolveContent(clock, { zone: "UTC", format: "24", ...content });
  return clock.compositionOptions?.(c) ?? {};
}

/** The Clock as the layer draws it, with `now()` read from `now` (the system clock by default). */
function mount(content: Record<string, unknown>, now: () => number = () => Date.now()) {
  const env = (opts: Record<string, unknown>): Env => ({
    topics: { "clock.settings": { kind: "map", v: {} } },
    options: options(opts),
    locale: "en",
    now,
    date: (ms, sk, zone) => formatDate(ms, sk, zone, "en-US"),
  });
  const rt = new Runtime(clockComposition, env(content));
  host = document.createElement("div");
  document.body.append(host);
  const r = createRoot(host);
  root = r;
  const draw = () => {
    act(() => {
      r.render(<CompositionView runtime={rt} size="M" animate={false} />);
    });
  };
  draw();
  const el = host;
  return {
    rt,
    /** The digital time as shown. */
    time: () => el.querySelector('[data-block="time"] [aria-label]')?.getAttribute("aria-label"),
    /** The analog face's label (its time with seconds). */
    analog: () => el.querySelector('[data-block="analog"]')?.getAttribute("aria-label"),
    /** New options, as the widget host passes them after a settings change. */
    reconfigure: (opts: Record<string, unknown>) => {
      rt.setEnv(env(opts));
      draw();
    },
  };
}

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

const hms = (ms: number) => new Date(ms).toISOString().slice(11, 19);

describe("the Clock follows the system clock", () => {
  it("advances every second with seconds on", () => {
    const c = mount({ seconds: "on" });
    expect(c.time()).toBe("09:09:20");
    for (let i = 1; i <= 12; i++) {
      advance(1000);
      expect(c.time()).toBe(hms(START + i * 1000));
    }
  });

  it("changes exactly at the minute with seconds off, and evaluates nothing in between", () => {
    const c = mount({ seconds: "off" });
    expect(c.time()).toBe("09:09");
    const n = c.rt.evaluations;
    // 09:09:20.100 → 09:09:59.9: nothing to do.
    advance(39_800);
    expect(c.time()).toBe("09:09");
    expect(c.rt.evaluations).toBe(n);
    // Past 09:10:00 (the view wakes a few ms after the boundary).
    advance(200);
    expect(c.time()).toBe("09:10");
    expect(c.rt.evaluations).toBeGreaterThan(n);
    // And again a minute later.
    advance(60_000);
    expect(c.time()).toBe("09:11");
  });

  it("keeps going when a timer fires before the clock reaches the wake time", () => {
    // The clock the composition reads runs 20 ms behind the timers' clock, so every timer fires
    // while the remembered time still looks fresh.
    const c = mount({ seconds: "on" }, () => Date.now() - 20);
    for (let i = 1; i <= 10; i++) {
      advance(1000);
      expect(c.time()).toBe(hms(START - 20 + i * 1000));
    }
  });

  it("shows the right time when timers resume after a pause", () => {
    const c = mount({ seconds: "on" });
    // A covered window (or a suspended machine): the clock moves on, no timer runs.
    vi.setSystemTime(START + 90_000);
    advance(1000);
    expect(c.time()).toBe(hms(START + 91_000));
    advance(1000);
    expect(c.time()).toBe(hms(START + 92_000));
  });

  it("catches up within seconds after a suspend with seconds off", () => {
    const c = mount({ seconds: "off" });
    // Suspend: the wall clock jumps 3 minutes, the timers' monotonic clock does not.
    vi.setSystemTime(START + 180_000);
    advance(5_100);
    expect(c.time()).toBe("09:12");
  });

  it("does not spin on results a hidden face read earlier", () => {
    // The analog face reads now() every second; switching to a digital minute clock leaves its
    // remembered results behind, and they must not keep the view awake.
    const c = mount({ face: "analog", seconds: "on" });
    expect(c.analog()).toBe("09:09:20");
    advance(1000);
    expect(c.analog()).toBe("09:09:21");
    c.reconfigure({ face: "digital", seconds: "off" });
    expect(c.time()).toBe("09:09");
    const n = c.rt.evaluations;
    advance(30_000);
    expect(c.rt.evaluations).toBe(n);
    expect(c.time()).toBe("09:09");
    advance(10_000);
    expect(c.time()).toBe("09:10");
  });

  it("leaves no timer behind when it unmounts", () => {
    mount({ seconds: "on" });
    advance(2000);
    const r = root;
    if (r) {
      act(() => {
        r.unmount();
      });
    }
    root = null;
    expect(vi.getTimerCount()).toBe(0);
  });
});
