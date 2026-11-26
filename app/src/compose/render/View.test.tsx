// The renderer draws what the runtime evaluates: layouts by size, visibility, lists, data
// attributes, and an unavailable state for a field that errors.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Value as Wire } from "../../layer/protocol";
import type { Composition, SizeClass } from "../model.gen";
import { Runtime, type Env } from "../runtime";
import { CompositionView } from "./View";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no ResizeObserver; the renderer only needs it to exist.
  if (!("ResizeObserver" in globalThis)) {
    const noop = () => undefined;
    globalThis.ResizeObserver = class {
      observe = noop;
      unobserve = noop;
      disconnect = noop;
    };
  }
});

let host: HTMLDivElement | null = null;
afterEach(() => {
  host?.remove();
  host = null;
});

function render(c: Composition, topics: Record<string, Wire>, size: SizeClass, options = {}) {
  const env: Env = { topics, options, locale: "en", now: () => 0 };
  const rt = new Runtime(c, env);
  host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(<CompositionView runtime={rt} size={size} animate={false} />);
  });
  return { el: host, rt, root };
}

const widget: Composition = {
  version: 1,
  layouts: [
    {
      sizes: ["1x1"],
      root: { id: "value", type: "text", role: "hero", text: "{cpu.load | round}%" },
    },
    {
      root: {
        id: "face",
        type: "column",
        gap: 2,
        children: [
          { id: "value", type: "text", role: "hero", text: "{cpu.load | round}%" },
          {
            id: "hot",
            type: "text",
            role: "badge",
            visible: "cpu.load > 80",
            text: "Hot",
          },
          { id: "bad", type: "text", text: "{cpu.name * 2}" },
          {
            id: "procs",
            type: "list",
            items: "processes.list",
            max: 2,
            item: { id: "proc", type: "text", text: "{$item}" },
          },
          { id: "load", type: "bar", value: "cpu.load / 100", label: "Load" },
        ],
      },
    },
  ],
};

const topics = (load: number): Record<string, Wire> => ({
  "cpu.load": { kind: "num", v: load },
  "cpu.name": { kind: "text", v: "Ryzen" },
  "processes.list": {
    kind: "list",
    v: ["firefox", "code", "slack"].map((v) => ({ kind: "text", v })),
  },
});

const text = (el: Element, block: string) =>
  el.querySelector(`[data-block="${block}"] [data-fit-variant="0"]`)?.textContent;

describe("composition renderer", () => {
  it("picks the layout for the size", () => {
    const { el } = render(widget, topics(42), "1x1");
    expect(el.querySelectorAll("[data-block]").length).toBe(1);
    expect(text(el, "value")).toBe("42%");
    expect(el.querySelector("[data-size]")?.getAttribute("data-size")).toBe("1x1");
  });

  it("renders blocks with their data attributes, visibility and lists", () => {
    const { el } = render(widget, topics(42), "M");
    const value = el.querySelector('[data-block="value"]');
    expect(value?.getAttribute("data-role")).toBe("hero");
    expect(value?.getAttribute("data-type")).toBe("text");
    expect(el.querySelector('[data-block="hot"]')).toBeNull();
    expect([...el.querySelectorAll('[data-block="proc"]')].map((p) => p.textContent)).toEqual([
      "firefox",
      "code",
    ]);
    const bar = el.querySelector('[data-block="load"]');
    expect(bar?.getAttribute("aria-label")).toBe("Load");
    expect(bar?.querySelector('[role="meter"]')?.getAttribute("aria-valuenow")).toBe("0.42");
  });

  it("shows a field that errors as unavailable, and the rest as usual", () => {
    const { el } = render(widget, topics(42), "M");
    expect(el.querySelector('[data-block="bad"]')?.getAttribute("data-state")).toBe("unavailable");
    expect(text(el, "bad")).toBe("—");
  });

  it("re-renders only from fresh values", () => {
    const { el, rt, root } = render(widget, topics(42), "M");
    const n = rt.evaluations;
    act(() => {
      root.render(<CompositionView runtime={rt} size="M" animate={false} />);
    });
    expect(rt.evaluations).toBe(n);
    rt.setEnv({ topics: topics(90), options: {}, locale: "en", now: () => 0 });
    act(() => {
      root.render(<CompositionView runtime={rt} size="M" animate={false} />);
    });
    expect(text(el, "value")).toBe("90%");
    expect(el.querySelector('[data-block="hot"]')).not.toBeNull();
  });
});
