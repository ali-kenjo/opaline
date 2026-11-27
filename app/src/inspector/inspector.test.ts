import { describe, expect, it } from "vitest";
import { sanitizeStyle } from "../design-system/style";
import { detectShortcutConflicts, searchSettings } from "../settings/settingsIndex";
import { INSPECTOR_STYLE_CHIPS, computeInspectorPos } from "./styleChips";

describe("Phase 5 Inspector & Settings helpers (5.1, 5.6)", () => {
  it("places floating Inspector beside the widget without overlapping it", () => {
    const widget = { x: 40, y: 80, width: 320, height: 180 };
    const pos = computeInspectorPos(widget, 1536, 864, 380, 620);
    expect(pos.left).toBeGreaterThanOrEqual(widget.x + widget.width);

    const rightWidget = { x: 1150, y: 80, width: 320, height: 180 };
    const leftPos = computeInspectorPos(rightWidget, 1536, 864, 380, 620);
    expect(leftPos.left + 380).toBeLessThanOrEqual(rightWidget.x);
  });

  it("all 8 Inspector style chips sanitize with zero dropped keys", () => {
    expect(INSPECTOR_STYLE_CHIPS).toHaveLength(8);
    for (const chip of INSPECTOR_STYLE_CHIPS) {
      const clean = sanitizeStyle(chip.patch);
      for (const k of Object.keys(chip.patch)) {
        expect(clean, `chip "${chip.id}" dropped "${k}"`).toHaveProperty(k);
      }
    }
  });

  it("searches Settings across every section and detects shortcut conflicts", () => {
    expect(searchSettings("crystal")[0]?.section).toBe("looks");
    expect(searchSettings("billing")[0]?.section).toBe("widget-defaults");
    expect(searchSettings("cell size")[0]?.section).toBe("layout");
    expect(detectShortcutConflicts("<Super><Alt>w", "<Super><Alt>e")).toEqual([]);
    expect(detectShortcutConflicts("<Super><Alt>w", "<Super><Alt>w").length).toBe(1);
    expect(detectShortcutConflicts("<Super>l", "<Super><Alt>e").length).toBe(1);
  });
});
