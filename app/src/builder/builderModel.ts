// Pure tree manipulation, expression evaluation, topic discovery, and accessible-name generation
// for the visual Widget Builder (PLAN-2 6.7).
import type { Composition, Layout, Node, Role, SizeClass } from "../compose/model.gen";
import { type Host, Program, type Value } from "../expr";
import type { CustomWidgetPackage } from "../widgets/customWidgets";

export type ContainerType = "stack" | "row" | "column" | "grid" | "overlay";
export type PaletteBlockType =
  | ContainerType
  | "spacer"
  | "text"
  | "number"
  | "icon"
  | "shape"
  | "ring"
  | "bar"
  | "progress"
  | "chart"
  | "list"
  | "divider";

export interface PaletteItem {
  type: PaletteBlockType;
  label: string;
  group: "containers" | "content" | "visuals";
  icon: string;
}

export const PALETTE_ITEMS: readonly PaletteItem[] = [
  { type: "column", label: "Column", group: "containers", icon: "view_agenda" },
  { type: "row", label: "Row", group: "containers", icon: "grid_view" },
  { type: "stack", label: "Auto Stack", group: "containers", icon: "layers" },
  { type: "grid", label: "Grid", group: "containers", icon: "grid_view" },
  { type: "overlay", label: "Overlay", group: "containers", icon: "layers" },
  { type: "spacer", label: "Spacer", group: "containers", icon: "open_in_full" },
  { type: "text", label: "Text", group: "content", icon: "text_fields" },
  { type: "number", label: "Number", group: "content", icon: "speed" },
  { type: "icon", label: "Icon", group: "content", icon: "star" },
  { type: "shape", label: "Shape", group: "content", icon: "palette" },
  { type: "divider", label: "Divider", group: "content", icon: "reorder" },
  { type: "ring", label: "Ring / Gauge", group: "visuals", icon: "monitoring" },
  { type: "bar", label: "Bar", group: "visuals", icon: "equalizer" },
  { type: "progress", label: "Progress", group: "visuals", icon: "tune" },
  { type: "chart", label: "Chart", group: "visuals", icon: "monitoring" },
  { type: "list", label: "List", group: "visuals", icon: "reorder" },
];

export const ROLES: readonly Role[] = [
  "hero",
  "title",
  "label",
  "value",
  "unit",
  "caption",
  "accent",
  "badge",
  "meter",
  "decoration",
];

export const BUILDER_SIZES: readonly SizeClass[] = [
  "1x1",
  "2x1",
  "1x2",
  "4x1",
  "S",
  "2x3",
  "M",
  "L",
  "6x4",
  "XL",
];

export function isContainerNode(
  node: Node,
): node is Extract<Node, { type: ContainerType; children: Node[] }> {
  return (
    node.type === "stack" ||
    node.type === "row" ||
    node.type === "column" ||
    node.type === "grid" ||
    node.type === "overlay"
  );
}

export function collectNodeIds(node: Node, out = new Set<string>()): Set<string> {
  out.add(node.id);
  if (isContainerNode(node)) {
    for (const c of node.children) collectNodeIds(c, out);
  } else if (node.type === "list") {
    collectNodeIds(node.item, out);
  }
  return out;
}

export function nextUniqueId(prefix: string, existing: ReadonlySet<string>): string {
  const clean = prefix.toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "block";
  const base = /^[a-z]/.test(clean) ? clean : `b-${clean}`;
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${String(i)}`)) i += 1;
  return `${base}-${String(i)}`;
}

export function createBlockNode(type: PaletteBlockType, existingIds: ReadonlySet<string>): Node {
  const id = nextUniqueId(type, existingIds);
  switch (type) {
    case "column":
      return { id, type: "column", gap: 2, children: [] };
    case "row":
      return { id, type: "row", gap: 2, align: "center", children: [] };
    case "stack":
      return { id, type: "stack", gap: 2, children: [] };
    case "grid":
      return { id, type: "grid", columns: 2, gap: 2, children: [] };
    case "overlay":
      return { id, type: "overlay", align: "center", justify: "center", children: [] };
    case "spacer":
      return { id, type: "spacer", grow: 1 };
    case "text":
      return { id, type: "text", role: "label", text: "Label" };
    case "number":
      return { id, type: "number", role: "hero", value: "cpu.load ?? 0", unit: "%" };
    case "icon":
      return { id, type: "icon", role: "accent", icon: "star" };
    case "shape":
      return { id, type: "shape", role: "decoration", shape: "pill" };
    case "ring":
      return { id, type: "ring", role: "meter", value: "clamp((cpu.load ?? 0) / 100, 0, 1)" };
    case "bar":
      return { id, type: "bar", role: "meter", value: "clamp((cpu.load ?? 0) / 100, 0, 1)" };
    case "progress":
      return { id, type: "progress", role: "meter", value: "clamp((cpu.load ?? 0) / 100, 0, 1)" };
    case "chart":
      return { id, type: "chart", role: "meter", plot: "area", values: "[20, 35, 50, 42, 65]" };
    case "list":
      return {
        id,
        type: "list",
        items: "[]",
        gap: 1,
        max: 5,
        item: {
          id: nextUniqueId("item", new Set([...existingIds, id])),
          type: "text",
          role: "value",
          text: "{$item}",
        },
      };
    case "divider":
      return { id, type: "divider", axis: "horizontal" };
  }
}

export function findNodeById(root: Node, id: string): Node | null {
  if (root.id === id) return root;
  if (isContainerNode(root)) {
    for (const c of root.children) {
      const hit = findNodeById(c, id);
      if (hit) return hit;
    }
  } else if (root.type === "list") {
    return findNodeById(root.item, id);
  }
  return null;
}

export function updateNodeById(root: Node, id: string, fn: (n: Node) => Node): Node {
  if (root.id === id) return fn(root);
  if (isContainerNode(root)) {
    return { ...root, children: root.children.map((c) => updateNodeById(c, id, fn)) };
  }
  if (root.type === "list") {
    return { ...root, item: updateNodeById(root.item, id, fn) };
  }
  return root;
}

export function insertChildInto(root: Node, parentId: string, child: Node): Node {
  return updateNodeById(root, parentId, (target) => {
    if (isContainerNode(target)) {
      return { ...target, children: [...target.children, child] };
    }
    return target;
  });
}

export function deleteNodeById(root: Node, id: string): Node {
  if (root.id === id) return root; // never delete root
  if (isContainerNode(root)) {
    return {
      ...root,
      children: root.children.filter((c) => c.id !== id).map((c) => deleteNodeById(c, id)),
    };
  }
  if (root.type === "list") {
    return { ...root, item: deleteNodeById(root.item, id) };
  }
  return root;
}

export function moveNodeInParent(root: Node, id: string, delta: -1 | 1): Node {
  if (isContainerNode(root)) {
    const idx = root.children.findIndex((c) => c.id === id);
    if (idx >= 0) {
      const nextIdx = idx + delta;
      if (nextIdx >= 0 && nextIdx < root.children.length) {
        const copy = [...root.children];
        const [moved] = copy.splice(idx, 1);
        if (moved) copy.splice(nextIdx, 0, moved);
        return { ...root, children: copy };
      }
      return root;
    }
    return { ...root, children: root.children.map((c) => moveNodeInParent(c, id, delta)) };
  }
  if (root.type === "list") {
    return { ...root, item: moveNodeInParent(root.item, id, delta) };
  }
  return root;
}

export function createStarterPackage(id = "my-widget", name = "My Widget"): CustomWidgetPackage {
  const layoutM: Layout = {
    sizes: ["M", "L", "S"],
    root: {
      id: "root",
      type: "column",
      gap: 2,
      padding: 3,
      children: [
        {
          id: "header",
          type: "row",
          gap: 2,
          align: "center",
          children: [
            { id: "icon", type: "icon", role: "accent", icon: "widgets" },
            { id: "title", type: "text", role: "title", text: name },
          ],
        },
        {
          id: "metric",
          type: "number",
          role: "hero",
          value: "cpu.load ?? 0",
          unit: "%",
          motion: "odometer",
        },
        {
          id: "caption",
          type: "text",
          role: "caption",
          text: "Bind any topic or custom source",
        },
      ],
    },
  };
  return {
    version: 1,
    id,
    name,
    description: "Custom widget built in Opaline Widget Builder",
    category: "custom",
    icon: "widgets",
    sizes: ["S", "M", "L"],
    defaultSize: "M",
    topics: ["cpu.load"],
    composition: {
      version: 1,
      bindings: {},
      layouts: [layoutM],
    },
  };
}

/** Collects every external topic prefix referenced by expressions/templates in `comp`. */
export function collectTopicsFromComposition(comp: Composition): string[] {
  const topics = new Set<string>();
  const scan = (src: string | undefined, mode: "expression" | "template") => {
    if (!src) return;
    const compiled = Program.compile(src, mode);
    if (!(compiled instanceof Program)) return;
    for (const p of compiled.paths()) {
      const head = p.split(".")[0];
      if (!head || head === "bind" || head === "opt" || head === "$item" || head === "$index") {
        continue;
      }
      // Keep first two segments (e.g. `source.my_api`, `var.build`, `cpu.load`).
      const segs = p.split(".");
      topics.add(segs.length >= 2 ? `${segs[0] ?? ""}.${segs[1] ?? ""}` : p);
    }
  };
  for (const expr of Object.values(comp.bindings ?? {})) {
    scan(expr, "expression");
  }
  const walk = (n: Node) => {
    scan(n.visible, "expression");
    scan(n.label, "template");
    switch (n.type) {
      case "text":
        scan(n.text, "template");
        for (const s of n.shorter ?? []) scan(s, "template");
        break;
      case "number":
        scan(n.value, "expression");
        scan(n.text, "template");
        scan(n.unit, "template");
        break;
      case "icon":
        scan(n.icon, "template");
        scan(n.filled, "expression");
        break;
      case "image":
        scan(n.src, "expression");
        break;
      case "shape":
        scan(n.shape, "template");
        scan(n.color, "expression");
        break;
      case "ring":
      case "bar":
        scan(n.value, "expression");
        scan(n.color, "expression");
        break;
      case "progress":
        scan(n.value, "expression");
        break;
      case "chart":
        scan(n.values, "expression");
        break;
      case "heatmap":
        scan(n.values, "expression");
        break;
      case "list":
        scan(n.items, "expression");
        walk(n.item);
        break;
      default:
        if (isContainerNode(n)) {
          for (const c of n.children) walk(c);
        }
    }
  };
  for (const layout of comp.layouts) walk(layout.root);
  return [...topics].sort();
}

/** Auto-generates an accessible name from the widget title and its bound topics/bindings (PLAN-2 6.7). */
export function generateAccessibleName(pkg: CustomWidgetPackage): string {
  if (pkg.accessibleName && pkg.accessibleName.trim().length > 0) {
    return pkg.accessibleName.trim();
  }
  const topics = collectTopicsFromComposition(pkg.composition);
  if (topics.length === 0) return pkg.name;
  return `${pkg.name} showing ${topics.slice(0, 3).join(", ")}`;
}

export type EvalPreview =
  { ok: true; formatted: string } | { ok: false; error: string; at: number };

/** Builds a lightweight expression Host over a map of live topic values. */
export function makePreviewHost(topics: Readonly<Record<string, Value>>): Host {
  return {
    hasTopic: (name) => name in topics,
    topic: (name, keys) => {
      let cur: Value = topics[name] ?? null;
      for (const k of keys) {
        if (cur === null || typeof cur !== "object") return null;
        if (Array.isArray(cur)) {
          cur = typeof k === "number" ? (cur[k] ?? null) : null;
        } else if (typeof k === "string" || typeof k === "number") {
          cur = (cur as Record<string, Value>)[String(k)] ?? null;
        } else {
          cur = null;
        }
      }
      return cur;
    },
    nowMs: () => Date.now(),
    locale: () => "en",
  };
}

/** Compiles and evaluates one expression or template against live values for inline Builder feedback. */
export function evaluateBindingPreview(
  src: string,
  mode: "expression" | "template",
  host: Host,
): EvalPreview {
  const compiled = Program.compile(src, mode);
  if (!(compiled instanceof Program)) {
    return { ok: false, error: compiled.message, at: compiled.at };
  }
  const res = compiled.eval(host);
  if (res.errors.length > 0) {
    const first = res.errors[0];
    return { ok: false, error: first?.message ?? "Evaluation error", at: first?.at ?? 0 };
  }
  return { ok: true, formatted: formatPreviewValue(res.value) };
}

function formatPreviewValue(v: Value): string {
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "boolean") return v ? "true" : "false";
  return JSON.stringify(v);
}
