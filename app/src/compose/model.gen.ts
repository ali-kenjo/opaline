// Generated from spec/composition.schema.json by app/scripts/schema-to-ts.mjs; don't edit.
// The Rust types are the source: change them, then run `pnpm gen:types`.

/** A widget as a tree of containers and blocks, with one layout per size. */
export interface Composition {
  /**
   * Named values shared by every layout, read in expressions as `bind.<name>`. A widget's
   * fields become bindings. Bindings may read other bindings, but not in a circle.
   */
  bindings?: Record<string, Expr>;
  /** Layouts, tried in order; the first that matches the widget's size is used. */
  layouts: Layout[];
  /** Format version (1). */
  version: number;
}

export type Align = "start" | "center" | "end" | "stretch" | "baseline";

export type Axis = "horizontal" | "vertical";

export type Caps = "round" | "butt";

/**
 * A command for core, which validates it before acting (ARCHITECTURE §3.7). `cmd` is a command
 * name of the IPC protocol; the arguments are expressions, and `$value` is the control's new
 * value (slider, toggle, text input).
 */
export interface CommandRef {
  args?: Record<string, Expr>;
  cmd: string;
}

/** An expression (docs/EXPRESSIONS.md): `cpu.load >= 90`, `clamp(battery.percent / 100, 0, 1)`. */
export type Expr = string;

export type Fit = "cover" | "contain";

/** Core's history of a path over a window (`'5m'`), for charts. */
export interface HistoryRef {
  path: string;
  window: string;
}

export type Justify = "start" | "center" | "end" | "between" | "around" | "evenly";

/** One layout: the sizes it's for and its tree. */
export interface Layout {
  /** For free sizes: the smallest height in grid cells this layout fits. */
  minH?: number;
  /** For free sizes: the smallest width in grid cells this layout fits. */
  minW?: number;
  root: Node;
  /** Size classes this layout is for; empty means any. */
  sizes?: SizeClass[];
}

/** A container or a block. */
export type Node = {
  /**
   * Stable id (`[a-z][a-z0-9-]*`, unique in its layout). The same id in two layouts is the
   * same block, so resizing morphs it.
   */
  id: string;
  /** The accessible name; generated from the content when absent. */
  label?: Template;
  /** When space runs out, lower priorities go first (0 … 100, default 50). */
  priority?: number;
  /** What the block is for; themes style roles, not elements. */
  role?: Role;
  /** Style keys for this node (the style model, ADR 0011), applied over its role's style. */
  style?: Record<string, unknown>;
  /** Shown only while this is true. */
  visible?: Expr;
} &
  /** Children side by side when the box is wider than tall, else one under the other. */
  (
    | {
        /** Cross-axis alignment of the children. */
        align?: Align;
        children: Node[];
        gap?: number;
        /** Share of the free space this container takes in its parent (like flex-grow). */
        grow?: number;
        /** Main-axis distribution of the children. */
        justify?: Justify;
        padding?: number;
        type: "stack";
      }
    /** Children side by side. */
    | {
        /** Cross-axis alignment of the children. */
        align?: Align;
        children: Node[];
        gap?: number;
        /** Share of the free space this container takes in its parent (like flex-grow). */
        grow?: number;
        /** Main-axis distribution of the children. */
        justify?: Justify;
        padding?: number;
        type: "row";
      }
    /** Children one under the other. */
    | {
        /** Cross-axis alignment of the children. */
        align?: Align;
        children: Node[];
        gap?: number;
        /** Share of the free space this container takes in its parent (like flex-grow). */
        grow?: number;
        /** Main-axis distribution of the children. */
        justify?: Justify;
        padding?: number;
        type: "column";
      }
    /** Children in a grid of equal columns. */
    | {
        /** Cross-axis alignment of the children. */
        align?: Align;
        children: Node[];
        /** 1 … 12. */
        columns: number;
        gap?: number;
        /** Share of the free space this container takes in its parent (like flex-grow). */
        grow?: number;
        /** Main-axis distribution of the children. */
        justify?: Justify;
        padding?: number;
        type: "grid";
      }
    /** Children on top of each other (a value over a ring). */
    | {
        /** Cross-axis alignment of the children. */
        align?: Align;
        children: Node[];
        gap?: number;
        /** Share of the free space this container takes in its parent (like flex-grow). */
        grow?: number;
        /** Main-axis distribution of the children. */
        justify?: Justify;
        padding?: number;
        type: "overlay";
      }
    /** Empty space that takes a share of what's left. */
    | {
        grow?: number;
        type: "spacer";
      }
    /** Text from a template. */
    | {
        maxLines?: number;
        /** Shorter forms, used in order when the text doesn't fit (it's never cut). */
        shorter?: Template[];
        text: Template;
        type: "text";
      }
    | {
        motion?: NumberMotion;
        /** The text shown; default: the value with at most 3 decimals. */
        text?: Template;
        type: "number";
        unit?: Template;
        value: Expr;
      }
    | {
        filled?: Expr;
        /** A Material Symbols name. */
        icon: Template;
        type: "icon";
      }
    | {
        fit?: Fit;
        src: Expr;
        type: "image";
      }
    /** One of the library's shapes; it morphs when the name changes. */
    | {
        color?: Expr;
        shape: Template;
        type: "shape";
      }
    | {
        caps?: Caps;
        color?: Expr;
        needle?: boolean;
        segments?: number;
        /** Arc length in degrees (1 … 360, default 360). */
        sweep?: number;
        thickness?: number;
        ticks?: number;
        type: "ring";
        /** 0 … 1. */
        value: Expr;
        wavy?: boolean;
      }
    | {
        axis?: Axis;
        color?: Expr;
        segments?: number;
        type: "bar";
        /** 0 … 1, or a list of parts for a stacked bar. */
        value: Expr;
      }
    | {
        history?: HistoryRef;
        max?: number;
        min?: number;
        plot?: Plot;
        smooth?: boolean;
        type: "chart";
        /** A list of numbers; or use `history`. */
        values?: Expr;
      }
    | {
        columns: number;
        /** The value that is full heat (default 1). */
        max?: number;
        type: "heatmap";
        /** Values 0 … `max`. */
        values: Expr;
      }
    /** Repeats `item` for each element of `items`; inside, `$item` and `$index`. */
    | {
        axis?: Axis;
        gap?: number;
        item: Node;
        items: Expr;
        max?: number;
        type: "list";
      }
    | {
        type: "progress";
        value: Expr;
        wavy?: boolean;
      }
    | {
        axis?: Axis;
        type: "divider";
      }
    /** A built-in visual (analog clock, visualizer, weather sky, photo frame). */
    | {
        params?: Record<string, Expr>;
        type: "canvas";
        visual: string;
      }
    | {
        command: CommandRef;
        /** Ask first ("Power off the drive?"). */
        confirm?: Template;
        enabled?: Expr;
        icon?: Template;
        text: Template;
        type: "button";
      }
    | {
        command: CommandRef;
        text?: Template;
        type: "toggle";
        value: Expr;
      }
    | {
        command: CommandRef;
        max: number;
        min: number;
        step: number;
        type: "slider";
        value: Expr;
      }
    | {
        command: CommandRef;
        maxLength: number;
        placeholder?: Template;
        type: "input";
        value: Expr;
      }
    /** A plugin's block (P9). */
    | {
        plugin: string;
        props?: Record<string, Expr>;
        type: "plugin";
      }
  );

export type NumberMotion = "fade" | "none" | "odometer";

export type Plot = "line" | "area" | "bars" | "step" | "dots";

/** Roles themes target (brief §4.1). */
export type Role =
  | "hero"
  | "title"
  | "label"
  | "value"
  | "unit"
  | "caption"
  | "accent"
  | "badge"
  | "meter"
  | "decoration";

/** Grid spans: `1x1`, `2x1`, `1x2`, `4x1`, `S` (2×2), `2x3`, `M` (4×2), `L` (4×4), `6x4`, `XL` (8×4). */
export type SizeClass = "1x1" | "2x1" | "1x2" | "4x1" | "S" | "2x3" | "M" | "L" | "6x4" | "XL";

/** A template: text with expressions in braces, `"{cpu.load | round}%"`. */
export type Template = string;
