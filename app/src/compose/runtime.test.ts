// The binding runtime evaluates lazily and only when an input changed (PLAN-2 2.4, spike S10).
import { describe, expect, it } from "vitest";
import type { Value as Wire } from "../layer/protocol";
import type { Composition } from "./model.gen";
import { Runtime, type Env } from "./runtime";

const num = (v: number): Wire => ({ kind: "num", v });
const text = (v: string): Wire => ({ kind: "text", v });

function env(topics: Record<string, Wire>, now = 0, options = {}): Env {
  return {
    topics,
    options,
    locale: "en",
    now: () => now,
    date: (ms, skeleton, zone) => `${skeleton}@${String(ms)}${zone ? ` ${zone}` : ""}`,
  };
}

const composition: Composition = {
  version: 1,
  bindings: { load: "cpu.load / 100", hot: "bind.load > 0.8" },
  layouts: [
    {
      root: {
        id: "root",
        type: "column",
        children: [
          { id: "value", type: "text", text: "{cpu.load | round}%" },
          { id: "ring", type: "ring", value: "bind.load", visible: "!bind.hot" },
          { id: "place", type: "text", text: "{weather.current.place}" },
          { id: "clock", type: "text", text: "{date(now(), 'Hm')}" },
          {
            id: "procs",
            type: "list",
            items: "processes.list",
            item: { id: "row", type: "text", text: "{$index + 1}. {$item.name}" },
          },
        ],
      },
    },
  ],
};

const R = "/layouts/0/root/children";

describe("composition runtime", () => {
  it("knows the topics to subscribe to", () => {
    const rt = new Runtime(composition, env({}));
    expect(rt.topics()).toEqual([
      "cpu",
      "cpu.load",
      "processes",
      "processes.list",
      "weather",
      "weather.current",
      "weather.current.place",
    ]);
    expect(rt.problems()).toEqual([]);
  });

  it("evaluates templates, bindings and paths by longest prefix", () => {
    const rt = new Runtime(
      composition,
      env({
        "cpu.load": num(43.4),
        "weather.current": { kind: "map", v: { place: text("Berlin") } },
      }),
    );
    expect(rt.read(`${R}/0/text`).value).toBe("43%");
    expect(rt.read(`${R}/1/value`).value).toBeCloseTo(0.434);
    expect(rt.read(`${R}/1/visible`).value).toBe(true);
    expect(rt.read(`${R}/2/text`).value).toBe("Berlin");
  });

  it("does nothing while idle and re-evaluates only what read a changed topic", () => {
    const load = num(43.4);
    const place = { kind: "map", v: { place: text("Berlin") } } as const;
    const rt = new Runtime(composition, env({ "cpu.load": load, "weather.current": place }));
    const all = [`${R}/0/text`, `${R}/1/value`, `${R}/1/visible`, `${R}/2/text`];
    const readAll = () => all.map((s) => rt.read(s).value);
    readAll();
    const after = rt.evaluations;
    for (let i = 0; i < 100; i++) readAll();
    expect(rt.evaluations).toBe(after);

    // Another topic changes: nothing here read it.
    rt.setEnv(env({ "cpu.load": load, "weather.current": place, "net.ssid": text("x") }));
    readAll();
    expect(rt.evaluations).toBe(after);

    // cpu.load changes: the text, the two bindings and the two ring fields re-evaluate; the
    // weather text doesn't.
    rt.setEnv(env({ "cpu.load": num(90), "weather.current": place }));
    expect(readAll()).toEqual(["90%", 0.9, false, "Berlin"]);
    expect(rt.evaluations - after).toBe(5);
  });

  it("wakes a minute clock once a minute", () => {
    const rt = new Runtime(composition, env({}, 90_000));
    const clock = `${R}/3/text`;
    expect(rt.read(clock).value).toBe("Hm@90000");
    expect(rt.nextWake()).toBe(120_000);
    const n = rt.evaluations;
    rt.setEnv(env({}, 119_999));
    rt.read(clock);
    expect(rt.evaluations).toBe(n);
    rt.setEnv(env({}, 120_000));
    expect(rt.read(clock).value).toBe("Hm@120000");
    expect(rt.evaluations).toBe(n + 1);
    expect(rt.nextWake()).toBe(180_000);
  });

  it("ticks every second when a format shows seconds", () => {
    const c: Composition = {
      version: 1,
      layouts: [
        {
          root: {
            id: "t",
            type: "text",
            text: "{date(now(), if(opt.seconds, 'Hms', 'Hm'))}",
          },
        },
      ],
    };
    const rt = new Runtime(c, env({}, 1500, { seconds: true }));
    rt.read("/layouts/0/root/text");
    expect(rt.nextWake()).toBe(2000);
    // Seconds off: the same template now wakes at the minute.
    rt.setEnv(env({}, 1500, { seconds: false }));
    rt.read("/layouts/0/root/text");
    expect(rt.nextWake()).toBe(60_000);
  });

  it("remembers list items per index", () => {
    const list = (names: string[]): Wire => ({
      kind: "list",
      v: names.map((n) => ({ kind: "map", v: { name: text(n) } })),
    });
    const procs = list(["firefox", "code"]);
    const rt = new Runtime(composition, env({ "processes.list": procs }));
    const items = rt.read(`${R}/4/items`).value as unknown[];
    const row = (i: number) =>
      rt.read(`${R}/4/item/text`, { item: items[i] as never, index: i }).value;
    expect([row(0), row(1)]).toEqual(["1. firefox", "2. code"]);
    const n = rt.evaluations;
    expect([row(0), row(1)]).toEqual(["1. firefox", "2. code"]);
    expect(rt.evaluations).toBe(n);
  });

  it("reports compile errors per field and survives them", () => {
    const c: Composition = {
      version: 1,
      layouts: [{ root: { id: "t", type: "text", text: "{round('x')}" } }],
    };
    const rt = new Runtime(c, env({}));
    expect(rt.problems().map(([id, d]) => [id, d.code])).toEqual([
      ["/layouts/0/root/text", "type-error"],
    ]);
    expect(rt.read("/layouts/0/root/text").value).toBeNull();
  });
});
