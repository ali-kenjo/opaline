// Decorations widget (brief §8.4, PLAN-2 7.4):
// Lightweight text banners, expressive shapes, and desktop dividers.
import { Icon } from "../design-system/icons";
import { cubicsToPath, materialShape, type MaterialShapeName } from "../design-system/shapes";
import styles from "./p7Widgets.module.css";
import type { RenderCtx, WidgetDef } from "./types";

const DECO_SHAPES: readonly MaterialShapeName[] = [
  "pill",
  "sunny",
  "clover4Leaf",
  "flower",
  "softBurst",
  "heart",
  "diamond",
];

function DecorationBody({ ctx }: { ctx: RenderCtx }) {
  const mode = ctx.content.opt<string>("mode");
  const text = ctx.content.opt<string>("text") || "Opaline";
  const shapeName = ctx.content.opt<string>("shape") as MaterialShapeName;

  if (mode === "divider") {
    return (
      <div className={styles.wrap} style={{ justifyContent: "center" }}>
        <div
          style={{
            width: "100%",
            height: 2,
            borderRadius: 99,
            background: "color-mix(in srgb, var(--md-on-surface, #fff) 35%, transparent)",
          }}
        />
      </div>
    );
  }

  if (mode === "shape") {
    const safeName = DECO_SHAPES.includes(shapeName) ? shapeName : "sunny";
    const d = cubicsToPath(materialShape(safeName).cubics);
    return (
      <div className={styles.wrap} style={{ justifyContent: "center", alignItems: "center" }}>
        <svg viewBox="0 0 1 1" style={{ width: "76%", height: "76%" }} aria-hidden="true">
          <path d={d} fill="rgb(var(--md-primary, 125 196 255))" fillOpacity="0.82" />
        </svg>
      </div>
    );
  }

  return (
    <div
      className={styles.wrap}
      style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}
    >
      <Icon name="star" size={18} />
      <div style={{ fontSize: "1.1rem", fontWeight: 700, letterSpacing: "-0.02em" }}>{text}</div>
    </div>
  );
}

export const decorationWidget: WidgetDef = {
  kind: "decoration",
  name: "Decoration",
  icon: "star",
  category: "info",
  sizes: ["1x1", "2x1", "4x1", "S", "M"],
  defaultSize: "2x1",
  topics: [],
  fields: [],
  defaultFields: [],
  options: [
    {
      kind: "enum",
      key: "mode",
      label: "Kind",
      default: "label",
      options: [
        { value: "label", label: "Text label" },
        { value: "shape", label: "Shape" },
        { value: "divider", label: "Separator line" },
      ],
    },
    {
      kind: "text",
      key: "text",
      label: "Label text",
      default: "Focus Mode",
      maxLength: 60,
    },
    {
      kind: "enum",
      key: "shape",
      label: "Shape",
      default: "sunny",
      options: DECO_SHAPES.map((s) => ({ value: s, label: s })),
    },
  ],
  status: () => ({ kind: "ready" }),
  render: (ctx) => <DecorationBody ctx={ctx} />,
};
