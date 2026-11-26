// Pure parts of the richer blocks: chart geometry, arcs, and what images and colors accept.
import { describe, expect, it } from "vitest";
import { arcPath, chartPaths, safeImage } from "./blocks";
import { cssColor } from "./context";

describe("blocks", () => {
  it("draws charts inside their box", () => {
    const p = chartPaths([0, 50, 100], 100, 40, "line", false, 0, 100);
    expect(p.line).toBe("M0.00 38.00L50.00 20.00L100.00 2.00");
    const bars = chartPaths([0, 100], 100, 40, "bars", false, 0, 100).bars;
    expect(bars.map((b) => Math.round(b.h))).toEqual([0, 36]);
    expect(chartPaths([5, 5], 100, 40, "area", false).area).toMatch(/Z$/);
    expect(chartPaths([], 100, 40, "line", false).line).toBe("");
  });

  it("draws arcs clockwise from the top", () => {
    expect(arcPath(10, 10, 10, 0, 90).startsWith("M10.00 0.00")).toBe(true);
    expect(arcPath(10, 10, 10, 0, 90).endsWith("L20.00 10.00")).toBe(true);
    expect(arcPath(10, 10, 10, 0, 0)).toBe("");
  });

  it("loads images only from core or inline data", () => {
    expect(safeImage("opaline-asset://art/a.jpg")).toBe("opaline-asset://art/a.jpg");
    expect(safeImage("data:image/png;base64,AAAA")).not.toBeNull();
    expect(safeImage("https://example.com/a.png")).toBeNull();
    expect(safeImage("file:///etc/passwd")).toBeNull();
    expect(safeImage("data:text/html;base64,AAAA")).toBeNull();
  });

  it("accepts plain colors only", () => {
    expect(cssColor("#ff8800")).toBe("#ff8800");
    expect(cssColor("rgb(1 2 3 / 0.5)")).toBe("rgb(1 2 3 / 0.5)");
    expect(cssColor("var(--md-primary)")).toBe("var(--md-primary)");
    expect(cssColor("red; background: url(x)")).toBeUndefined();
    expect(cssColor(42)).toBeUndefined();
  });
});
