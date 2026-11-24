import { describe, expect, it } from "vitest";
import { springs } from "../tokens/tokens";
import { type Clock, Scheduler } from "./scheduler";
import { Spring, stepSpring } from "./spring";

const run = (s: Spring, seconds: number, dt = 1 / 60) => {
  const values: number[] = [];
  for (let t = 0; t < seconds; t += dt) {
    s.step(dt);
    values.push(s.value);
  }
  return values;
};

describe("spring", () => {
  it("effects springs never overshoot", () => {
    const s = new Spring(0, "effectsDefault");
    s.setTarget(1);
    const v = run(s, 1);
    expect(Math.max(...v)).toBeLessThanOrEqual(1 + 1e-9);
    expect(s.atRest).toBe(true);
    expect(s.value).toBe(1);
  });

  it("spatial.fast overshoots, then settles", () => {
    const s = new Spring(0, "spatialFast");
    s.setTarget(1);
    const v = run(s, 2);
    expect(Math.max(...v)).toBeGreaterThan(1.05);
    expect(s.atRest).toBe(true);
  });

  it("is stable for the stiffest token at a long frame", () => {
    const s = new Spring(0, "effectsFast");
    s.setTarget(100);
    run(s, 1, 1 / 15);
    expect(s.value).toBe(100);
  });

  it("retargeting keeps the velocity", () => {
    const s = new Spring(0, "spatialDefault");
    s.setTarget(100);
    run(s, 0.1);
    const v = s.velocity;
    expect(v).toBeGreaterThan(0);
    s.setTarget(-100);
    expect(s.velocity).toBe(v);
    s.step(1 / 60);
    expect(s.value).toBeGreaterThan(0);
  });

  it("matches the analytic solution across damping regimes", () => {
    for (const damping of [0.6, 1, 1.4]) {
      // Many small steps and one big step agree (exact integration).
      let a: [number, number] = [1, 0];
      for (let i = 0; i < 100; i++) a = stepSpring(a[0], a[1], 0.001, { stiffness: 380, damping });
      const b = stepSpring(1, 0, 0.1, { stiffness: 380, damping });
      expect(a[0]).toBeCloseTo(b[0], 6);
      expect(a[1]).toBeCloseTo(b[1], 5);
    }
    expect(springs.spatialSlow).toEqual({ stiffness: 200, damping: 0.8 });
  });
});

describe("scheduler", () => {
  function fakeClock() {
    const queue: ((now: number) => void)[] = [];
    let now = 0;
    const clock: Clock = {
      request: (cb) => queue.push(cb),
      cancel: () => undefined,
    };
    const frame = () => {
      now += 16;
      const cb = queue.shift();
      cb?.(now);
      return cb !== undefined;
    };
    return { clock, frame, pending: () => queue.length };
  }

  it("runs while springs move and then stops asking for frames", () => {
    const { clock, frame, pending } = fakeClock();
    const sch = new Scheduler(clock);
    const s = new Spring(0, "effectsFast");
    s.setTarget(1);
    let rendered = 0;
    sch.onFrame(() => rendered++);
    sch.add(s);
    let frames = 0;
    while (frame()) frames++;
    expect(s.value).toBe(1);
    expect(frames).toBeGreaterThan(3);
    expect(rendered).toBe(frames);
    expect(pending()).toBe(0);
    expect(sch.running).toBe(false);
  });

  it("invalidate renders exactly one frame", () => {
    const { clock, frame } = fakeClock();
    const sch = new Scheduler(clock);
    let rendered = 0;
    sch.onFrame(() => rendered++);
    sch.invalidate();
    sch.invalidate();
    while (frame());
    expect(rendered).toBe(1);
  });

  it("renders nothing while paused and flushes once uncovered", () => {
    const { clock, frame, pending } = fakeClock();
    const sch = new Scheduler(clock);
    let rendered = 0;
    sch.onFrame(() => rendered++);
    sch.setPaused(true);
    sch.invalidate();
    expect(pending()).toBe(0);
    expect(frame()).toBe(false);
    expect(rendered).toBe(0);
    sch.setPaused(false);
    expect(pending()).toBe(1);
    while (frame());
    expect(rendered).toBe(1);
  });
});
