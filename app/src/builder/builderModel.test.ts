import { describe, expect, it } from "vitest";
import {
  collectNodeIds,
  collectTopicsFromComposition,
  createBlockNode,
  createStarterPackage,
  deleteNodeById,
  evaluateBindingPreview,
  findNodeById,
  generateAccessibleName,
  insertChildInto,
  makePreviewHost,
  moveNodeInParent,
} from "./builderModel";

describe("Widget Builder model (PLAN-2 6.7)", () => {
  it("inserts, moves, and deletes nodes while keeping unique ids", () => {
    const pkg = createStarterPackage("build-stat", "Build Status");
    const root = pkg.composition.layouts[0]?.root;
    if (!root) throw new Error("missing root");

    const ids = collectNodeIds(root);
    const bar = createBlockNode("bar", ids);
    expect(ids.has(bar.id)).toBe(false);

    const added = insertChildInto(root, "root", bar);
    expect(findNodeById(added, bar.id)).not.toBeNull();

    const moved = moveNodeInParent(added, bar.id, -1);
    if (moved.type !== "column") throw new Error("expected column");
    expect(moved.children[moved.children.length - 2]?.id).toBe(bar.id);

    const removed = deleteNodeById(moved, bar.id);
    expect(findNodeById(removed, bar.id)).toBeNull();
    // Root itself is never deleted.
    expect(deleteNodeById(removed, "root").id).toBe("root");
  });

  it("extracts topics and generates accessible names from bindings", () => {
    const pkg = createStarterPackage("n8n-runs", "n8n Runs");
    pkg.composition.bindings = { count: "source.n8n_workflows.length" };
    const topics = collectTopicsFromComposition(pkg.composition);
    expect(topics).toContain("source.n8n_workflows");
    expect(topics).toContain("cpu.load");
    expect(generateAccessibleName(pkg)).toContain("n8n Runs showing");

    pkg.accessibleName = "Custom n8n status card";
    expect(generateAccessibleName(pkg)).toBe("Custom n8n status card");
  });

  it("evaluates live expression previews and reports inline syntax errors", () => {
    const host = makePreviewHost({ "cpu.load": 42.6, "var.build": "green" });
    const ok = evaluateBindingPreview("{cpu.load | round}% · {var.build}", "template", host);
    expect(ok).toEqual({ ok: true, formatted: "43% · green" });

    const err = evaluateBindingPreview("cpu.load +", "expression", host);
    expect(err.ok).toBe(false);
  });
});
