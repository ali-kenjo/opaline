// The composition renderer (PLAN-2 2.5): one component per node. Values come from the runtime,
// which evaluates only what changed; layout is CSS (flex, grid, a container query for `stack`).
// Every node carries data attributes themes and tests target: data-block, data-type, data-role,
// data-state.
import {
  type CSSProperties,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Fit, Ring, WavyProgress, useFitRows } from "../../design-system/components";
import { ICONS, Icon, type IconName } from "../../design-system/icons";
import { Odometer } from "../../design-system/motion";
import { space } from "../../design-system/tokens/tokens";
import type { Value } from "../../expr";
import { NNBSP, plain, text } from "../../expr/format";
import type { Composition, Node, SizeClass } from "../model.gen";
import type { Runtime, Scope } from "../runtime";
import styles from "./View.module.css";
import { VISUALS } from "./visuals";

interface ViewCtx {
  rt: Runtime;
  scope: Scope | undefined;
  animate: boolean;
}

const Ctx = createContext<ViewCtx | null>(null);

function useView(): ViewCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("composition node rendered outside a CompositionView");
  return v;
}

/** The layout for a size: the first that lists it, or has no sizes. */
export function pickLayout(c: Composition, size: SizeClass): number {
  return c.layouts.findIndex((l) => !l.sizes?.length || l.sizes.includes(size));
}

export interface CompositionViewProps {
  runtime: Runtime;
  size: SizeClass;
  /** Numbers roll and rings ease (the widget's animation setting). */
  animate: boolean;
}

/** Renders a composition and re-renders itself when a clock-reading value goes stale. */
export function CompositionView({ runtime, size, animate }: CompositionViewProps) {
  const [, setTick] = useState(0);
  const index = pickLayout(runtime.composition, size);
  const layout = runtime.composition.layouts[index];
  const wake = runtime.nextWake();
  useEffect(() => {
    if (wake === null) return;
    const t = setTimeout(
      () => {
        setTick((n) => n + 1);
      },
      Math.max(0, wake - Date.now()) + 5,
    );
    return () => {
      clearTimeout(t);
    };
  }, [wake]);
  if (!layout) return null;
  return (
    <Ctx.Provider value={{ rt: runtime, scope: undefined, animate }}>
      <div className={styles.root} data-size={size} data-composition="">
        <NodeView node={layout.root} at={`/layouts/${String(index)}/root`} />
      </div>
    </Ctx.Provider>
  );
}

/** Reads one field of the node at `at`: its value, and whether it errored. */
function useField(at: string) {
  const { rt, scope } = useView();
  return (key: string): { value: Value; failed: boolean; present: boolean } => {
    const id = `${at}/${key}`;
    if (!rt.has(id)) return { value: null, failed: false, present: false };
    const o = rt.read(id, scope);
    return { value: o.value, failed: o.errors.length > 0, present: true };
  };
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

const px = (step: number | undefined) =>
  step === undefined ? undefined : `${String(space[Math.min(8, Math.max(0, step))] ?? 0)}px`;

const asString = (v: Value) => (typeof v === "string" ? v : v === null ? "" : text(v, "en"));

function NodeView({ node, at }: { node: Node; at: string }) {
  const field = useField(at);
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

type Attrs = Record<string, string | undefined>;

/** Inline style with the renderer's custom properties. */
type CSSVars = CSSProperties & Record<`--${string}`, string | number | undefined>;
const vars = (o: CSSVars): CSSProperties => o;

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

/** The side of the box a block is given (rings and canvases fill it). */
function useBoxSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox((b) => (b.w === r.width && b.h === r.height ? b : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);
  return [ref, box] as const;
}

const ratio = (v: Value) => (typeof v === "number" ? Math.min(1, Math.max(0, v)) : null);

function BlockView({ node, at, attrs }: { node: Node; at: string; attrs: Attrs }) {
  const { animate } = useView();
  const field = useField(at);
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
            ? plain(value, "en")
            : typeof value === "string"
              ? value
              : "—";
      const unit = node.unit !== undefined ? asString(read("unit")) : "";
      const motion = node.motion ?? "odometer";
      content = (
        <span className={styles.number} aria-label={unit ? `${text}${NNBSP}${unit}` : text}>
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
          style={vars({ "--c-color": typeof color === "string" ? color : undefined })}
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
      content = Visual ? <Visual params={params} label={attrs["aria-label"]} /> : null;
      break;
    }
    default:
      // Image, shape, chart, heatmap and the controls arrive with the rest of the blocks.
      content = null;
  }
  return (
    <div
      className={`${styles.block ?? ""} ${node.type === "canvas" ? (styles.fill ?? "") : ""}`}
      data-state={failed ? "unavailable" : undefined}
      {...attrs}
    >
      {content}
    </div>
  );
}

function RingBlock({
  node,
  at,
  attrs,
}: {
  node: Node & { type: "ring" };
  at: string;
  attrs: Attrs;
}) {
  const { animate } = useView();
  const field = useField(at);
  const value = field("value");
  const color = node.color !== undefined ? field("color").value : null;
  const [ref, box] = useBoxSize<HTMLDivElement>();
  const side = Math.floor(Math.min(box.w, box.h));
  const v = ratio(value.value);
  return (
    <div
      ref={ref}
      className={`${styles.block ?? ""} ${styles.fill ?? ""}`}
      style={{ flex: 1, alignSelf: "stretch" }}
      data-state={value.failed || v === null ? "unavailable" : undefined}
      {...attrs}
    >
      {side > 0 ? (
        <Ring
          value={v ?? 0}
          size={side}
          thickness={node.thickness ?? Math.max(4, Math.round(side / 10))}
          {...(typeof color === "string" ? { color } : {})}
          label={attrs["aria-label"] ?? `${String(Math.round((v ?? 0) * 100))} %`}
          instant={!animate}
        />
      ) : null}
    </div>
  );
}
