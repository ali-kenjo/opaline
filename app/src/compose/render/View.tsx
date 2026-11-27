// The composition renderer (PLAN-2 2.5): one component per node. Values come from the runtime,
// which evaluates only what changed; layout is CSS (flex, grid, a container query for `stack`).
// Every node carries data attributes themes and tests target: data-block, data-type, data-role,
// data-state.
import { type ReactNode, useEffect, useState } from "react";
import { Fit, WavyProgress, useFitRows } from "../../design-system/components";
import { useNumberFit } from "../../design-system/components/fitNumber";
import { ICONS, Icon, type IconName } from "../../design-system/icons";
import { Odometer } from "../../design-system/motion";
import type { Value } from "../../expr";
import { NNBSP, plain } from "../../expr/format";
import type { Composition, Node, SizeClass } from "../model.gen";
import type { Runtime } from "../runtime";
import {
  ChartBlock,
  ButtonBlock,
  HeatmapBlock,
  ImageBlock,
  InputBlock,
  PluginBlock,
  RingBlock,
  ShapeBlock,
  SliderBlock,
  ToggleBlock,
} from "./blocks";
import {
  type Attrs,
  type CSSVars,
  Ctx,
  type Services,
  cssColor,
  px,
  ratio,
  useAsString,
  useField,
  useView,
  vars,
} from "./context";
import styles from "./View.module.css";
import { VISUALS } from "./visuals";

export type { Services } from "./context";

/** The layout for a size: the first that lists it, or has no sizes. */
export function pickLayout(c: Composition, size: SizeClass): number {
  return c.layouts.findIndex((l) => !l.sizes?.length || l.sizes.includes(size));
}

export interface CompositionViewProps {
  runtime: Runtime;
  size: SizeClass;
  /** Numbers roll and rings ease (the widget's animation setting). */
  animate: boolean;
  /** Commands, history and ramps from where it runs (none: controls do nothing). */
  services?: Services | undefined;
}

/** The longest a view sleeps before it looks at the clock again. Timers run on the monotonic
 * clock, which stops while the machine sleeps; the wall clock doesn't, so a minute clock that
 * slept through a suspend is right again within this long. */
const MAX_SLEEP_MS = 5000;

/** Renders a composition and re-renders itself when a clock-reading value goes stale. */
export function CompositionView({ runtime, size, animate, services }: CompositionViewProps) {
  const [, setTick] = useState(0);
  const index = pickLayout(runtime.composition, size);
  const layout = runtime.composition.layouts[index];
  // After every commit: by now the children have read their fields, so the runtime knows when
  // the first of them goes stale (asked in the render body it would be a pass behind, or empty).
  // The wait is measured on the runtime's own clock and re-checked when the timer fires, so a
  // timer that fires early, or late after a covered window or a suspend, never stops the chain.
  useEffect(() => {
    const wake = runtime.settle();
    if (wake === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const left = Math.max(0, wake - runtime.now());
      timer = setTimeout(
        () => {
          if (runtime.now() >= wake) setTick((n) => n + 1);
          else arm();
        },
        Math.min(left + 5, MAX_SLEEP_MS),
      );
    };
    arm();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  });
  if (!layout) return null;
  return (
    <Ctx.Provider value={{ rt: runtime, scope: undefined, animate, services }}>
      <div className={styles.root} data-size={size} data-composition="">
        <NodeView node={layout.root} at={`/layouts/${String(index)}/root`} />
      </div>
    </Ctx.Provider>
  );
}

const ALIGN = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
  baseline: "baseline",
} as const;

const JUSTIFY = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
  around: "space-around",
  evenly: "space-evenly",
} as const;

function NodeView({ node, at }: { node: Node; at: string }) {
  const field = useField(at);
  const asString = useAsString();
  const visible = field("visible");
  if (visible.present && visible.value !== true) return null;
  const label = field("label");
  const attrs = {
    "data-block": node.id,
    "data-type": node.type,
    "data-role": node.role,
    "aria-label": label.present ? asString(label.value) : undefined,
  };

  switch (node.type) {
    case "stack":
    case "row":
    case "column":
    case "grid":
    case "overlay": {
      const grow = node.grow !== undefined ? { flexGrow: node.grow } : {};
      const style: CSSVars = {
        "--c-gap": px(node.gap),
        "--c-pad": px(node.padding),
        "--c-columns": node.type === "grid" ? node.columns : undefined,
        alignItems: node.align ? ALIGN[node.align] : undefined,
        justifyContent: node.justify ? JUSTIFY[node.justify] : undefined,
        ...grow,
      };
      const cls = `${styles.box ?? ""} ${styles[node.type] ?? ""}`;
      const children = node.children.map((c, i) => (
        <NodeView key={c.id} node={c} at={`${at}/children/${String(i)}`} />
      ));
      if (node.type === "stack") {
        return (
          <div className={styles.stackOuter} style={grow} {...attrs}>
            <div className={cls} style={{ ...style, flexGrow: undefined }}>
              {children}
            </div>
          </div>
        );
      }
      return (
        <div className={cls} style={style} {...attrs}>
          {children}
        </div>
      );
    }
    case "spacer":
      return (
        <div
          className={styles.spacer}
          style={{ flexGrow: node.grow ?? 1 }}
          {...attrs}
          aria-hidden
        />
      );
    case "divider":
      return (
        <div
          className={styles.divider}
          data-axis={node.axis ?? "horizontal"}
          role="separator"
          {...attrs}
        />
      );
    case "list":
      return <ListView node={node} at={at} attrs={attrs} />;
    default:
      return <BlockView node={node} at={at} attrs={attrs} />;
  }
}

function ListView({
  node,
  at,
  attrs,
}: {
  node: Node & { type: "list" };
  at: string;
  attrs: Attrs;
}) {
  const view = useView();
  const field = useField(at);
  const items = field("items");
  const list = Array.isArray(items.value) ? items.value.slice(0, node.max ?? 50) : [];
  const itemAt = `${at}/item`;
  // Items are fit rows: one that would end below the card is dropped, never half shown.
  const ref = useFitRows<HTMLDivElement>();
  useEffect(() => {
    view.rt.trimItems(itemAt, list.length);
  });
  return (
    <div
      ref={ref}
      className={styles.list}
      data-axis={node.axis ?? "vertical"}
      style={vars({ "--c-gap": px(node.gap) })}
      data-state={items.failed ? "unavailable" : undefined}
      role="list"
      {...attrs}
    >
      {list.map((item, index) => (
        <Ctx.Provider key={index} value={{ ...view, scope: { item, index } }}>
          <div role="listitem" data-fit-row="" className={styles.item}>
            <NodeView node={node.item} at={itemAt} />
          </div>
        </Ctx.Provider>
      ))}
    </div>
  );
}

function BlockView({ node, at, attrs }: { node: Node; at: string; attrs: Attrs }) {
  const { animate, rt } = useView();
  const field = useField(at);
  const asString = useAsString();
  // Hero numbers narrow, then shrink, to fit their card (DESIGN-2 §3.3).
  const [blockRef, numberRef] = useNumberFit<HTMLDivElement, HTMLSpanElement>(
    node.type === "number" && node.role === "hero",
  );
  let failed = false as boolean;
  const read = (key: string) => {
    const f = field(key);
    failed ||= f.failed;
    return f.value;
  };
  let content: ReactNode;
  switch (node.type) {
    case "text": {
      const text = asString(read("text"));
      const shorter = (node.shorter ?? []).map((_, i) => asString(read(`shorter/${String(i)}`)));
      // Empty shorter forms mean "no shorter form" (a template's `if(…, …, '')`).
      const variants = [...new Set([text, ...shorter.filter((v) => v !== "")])];
      content = <Fit className={styles.text} label={text} variants={variants} />;
      break;
    }
    case "number": {
      const value = read("value");
      const text =
        node.text !== undefined
          ? asString(read("text"))
          : typeof value === "number"
            ? plain(value, rt.locale())
            : typeof value === "string"
              ? value
              : "—";
      const unit = node.unit !== undefined ? asString(read("unit")) : "";
      const motion = node.motion ?? "odometer";
      content = (
        <span
          ref={numberRef}
          className={styles.number}
          aria-label={unit ? `${text}${NNBSP}${unit}` : text}
        >
          {animate && motion === "odometer" ? <Odometer text={text} /> : <span>{text}</span>}
          {unit ? (
            <span data-role="unit" aria-hidden>
              {unit}
            </span>
          ) : null}
        </span>
      );
      break;
    }
    case "icon": {
      const name = asString(read("icon"));
      const filled = node.filled !== undefined && read("filled") === true;
      content = Object.hasOwn(ICONS, name) ? (
        <Icon name={name as IconName} fill={filled ? 1 : 0} size={20} />
      ) : null;
      break;
    }
    case "ring":
      return <RingBlock node={node} at={at} attrs={attrs} />;
    case "chart":
      return <ChartBlock node={node} at={at} attrs={attrs} />;
    case "heatmap":
      return <HeatmapBlock node={node} at={at} attrs={attrs} />;
    case "shape":
      return <ShapeBlock node={node} at={at} attrs={attrs} />;
    case "image":
      return <ImageBlock node={node} at={at} attrs={attrs} />;
    case "button":
      return <ButtonBlock node={node} at={at} attrs={attrs} />;
    case "toggle":
      return <ToggleBlock node={node} at={at} attrs={attrs} />;
    case "slider":
      return <SliderBlock node={node} at={at} attrs={attrs} />;
    case "input":
      return <InputBlock node={node} at={at} attrs={attrs} />;
    case "plugin":
      return <PluginBlock node={node} at={at} attrs={attrs} />;
    case "bar":
    case "progress": {
      const v = ratio(read("value"));
      const color = node.type === "bar" && node.color !== undefined ? read("color") : null;
      if (node.type === "progress" && node.wavy) {
        content = <WavyProgress value={v ?? 0} label={attrs["aria-label"] ?? ""} />;
        break;
      }
      const axis = node.type === "bar" ? (node.axis ?? "horizontal") : "horizontal";
      content = (
        <div
          className={styles.track}
          data-axis={axis}
          role="meter"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={v ?? undefined}
          style={vars({ "--c-color": cssColor(color ?? null) })}
        >
          <div
            className={styles.bar}
            style={{
              transform:
                axis === "vertical" ? `scaleY(${String(v ?? 0)})` : `scaleX(${String(v ?? 0)})`,
            }}
          />
        </div>
      );
      break;
    }
    case "canvas": {
      const Visual = VISUALS[node.visual];
      const params: Record<string, Value> = {};
      for (const k of Object.keys(node.params ?? {})) params[k] = read(`params/${k}`);
      content = Visual ? (
        <Visual params={params} label={attrs["aria-label"]} animate={animate} />
      ) : null;
      break;
    }
    default:
      content = null;
  }
  return (
    <div
      ref={blockRef}
      className={`${styles.block ?? ""} ${node.type === "canvas" ? (styles.fill ?? "") : ""}`}
      data-state={failed ? "unavailable" : undefined}
      {...attrs}
    >
      {content}
    </div>
  );
}
