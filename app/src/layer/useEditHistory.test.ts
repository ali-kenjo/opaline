import { describe, expect, it } from "vitest";
import type { StoredSettings } from "../widgets/host";
import { settingsDiffPatch } from "./useEditHistory";

describe("unified Edit-session settingsDiffPatch (5.2)", () => {
  it("emits minimal RFC 7396 merge patch including null tombstones for removed keys", () => {
    const before: StoredSettings = {
      theme: "opaline",
      style: { blur: 30, transparency: 75 },
      styles: {},
      widgets: {
        "w-cpu": { kind: "cpu", style: { accentColor: "#ff0000" }, content: { title: "CPU" } },
      },
    };
    const after: StoredSettings = {
      theme: "neon",
      style: { blur: 30, transparency: 60, grain: 20 },
      styles: {},
      widgets: {
        "w-cpu": {
          kind: "cpu",
          style: { accentColor: "#00ffaa", radius: 16 },
          content: { title: "Processor" },
        },
        "w-dup": { kind: "cpu", style: {}, content: {} },
      },
    };

    // Undo: after -> before
    const patch = settingsDiffPatch(after, before);
    expect(patch).toEqual({
      theme: "opaline",
      style: { transparency: 75, grain: null },
      widgets: {
        "w-cpu": {
          style: { accentColor: "#ff0000", radius: null },
          content: { title: "CPU" },
        },
        "w-dup": null,
      },
    });

    // No-op diff returns null.
    expect(settingsDiffPatch(before, before)).toBeNull();
  });
});
