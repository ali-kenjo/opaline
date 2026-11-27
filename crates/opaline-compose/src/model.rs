//! The composition model (docs/COMPOSITION.md, brief §4.1). These types are the source of truth:
//! `spec/composition.schema.json` and the layer's TypeScript types are generated from them.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// The format version this build reads and writes.
pub const VERSION: u32 = 1;

/// A widget as a tree of containers and blocks, with one layout per size.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Composition {
    /// Format version (1).
    pub version: u32,
    /// Named values shared by every layout, read in expressions as `bind.<name>`. A widget's
    /// fields become bindings. Bindings may read other bindings, but not in a circle.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub bindings: BTreeMap<String, Expr>,
    /// Layouts, tried in order; the first that matches the widget's size is used.
    pub layouts: Vec<Layout>,
}

/// One layout: the sizes it's for and its tree.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    /// Size classes this layout is for; empty means any.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sizes: Vec<SizeClass>,
    /// For free sizes: the smallest width in grid cells this layout fits.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_w: Option<u8>,
    /// For free sizes: the smallest height in grid cells this layout fits.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_h: Option<u8>,
    pub root: Node,
}

/// Grid spans: `1x1`, `2x1`, `1x2`, `4x1`, `S` (2×2), `2x3`, `M` (4×2), `L` (4×4), `6x4`, `XL` (8×4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub enum SizeClass {
    #[serde(rename = "1x1")]
    Tiny,
    #[serde(rename = "2x1")]
    Wide,
    #[serde(rename = "1x2")]
    TallNarrow,
    #[serde(rename = "4x1")]
    Strip,
    S,
    #[serde(rename = "2x3")]
    Tall,
    M,
    L,
    #[serde(rename = "6x4")]
    LargeWide,
    XL,
}

/// An expression (docs/EXPRESSIONS.md): `cpu.load >= 90`, `clamp(battery.percent / 100, 0, 1)`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct Expr(pub String);

/// A template: text with expressions in braces, `"{cpu.load | round}%"`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct Template(pub String);

/// A container or a block.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    /// Stable id (`[a-z][a-z0-9-]*`, unique in its layout). The same id in two layouts is the
    /// same block, so resizing morphs it.
    pub id: String,
    /// What the block is for; themes style roles, not elements.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<Role>,
    /// Shown only while this is true.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible: Option<Expr>,
    /// When space runs out, lower priorities go first (0 … 100, default 50).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<u8>,
    /// The accessible name; generated from the content when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<Template>,
    /// Style keys for this node (the style model, ADR 0011), applied over its role's style.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub style: BTreeMap<String, serde_json::Value>,
    #[serde(flatten)]
    pub kind: Kind,
}

/// Roles themes target (brief §4.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Role {
    Hero,
    Title,
    Label,
    Value,
    Unit,
    Caption,
    Accent,
    Badge,
    Meter,
    Decoration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Align {
    Start,
    Center,
    End,
    Stretch,
    Baseline,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Justify {
    Start,
    Center,
    End,
    Between,
    Around,
    Evenly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Axis {
    Horizontal,
    Vertical,
}

/// Box properties shared by the containers. Spacing is a step of the 4-pt scale (0 … 8:
/// 0, 4, 8, 12, 16, 20, 24, 32, 40 px).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Boxing {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gap: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub padding: Option<u8>,
    /// Cross-axis alignment of the children.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<Align>,
    /// Main-axis distribution of the children.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub justify: Option<Justify>,
    /// Share of the free space this container takes in its parent (like flex-grow).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grow: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum NumberMotion {
    /// Digits roll (the default).
    Odometer,
    Fade,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Caps {
    Round,
    Butt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Plot {
    Line,
    Area,
    Bars,
    Step,
    Dots,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Fit {
    Cover,
    Contain,
}

/// Core's history of a path over a window (`'5m'`), for charts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRef {
    pub path: String,
    pub window: String,
}

/// A command for core, which validates it before acting (ARCHITECTURE §3.7). `cmd` is a command
/// name of the IPC protocol; the arguments are expressions, and `$value` is the control's new
/// value (slider, toggle, text input).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommandRef {
    pub cmd: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub args: BTreeMap<String, Expr>,
}

/// What a node is. Containers have children; blocks show something.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum Kind {
    /// Children side by side when the box is wider than tall, else one under the other.
    Stack {
        children: Vec<Node>,
        #[serde(flatten)]
        boxing: Boxing,
    },
    /// Children side by side.
    Row {
        children: Vec<Node>,
        #[serde(flatten)]
        boxing: Boxing,
    },
    /// Children one under the other.
    Column {
        children: Vec<Node>,
        #[serde(flatten)]
        boxing: Boxing,
    },
    /// Children in a grid of equal columns.
    Grid {
        /// 1 … 12.
        columns: u8,
        children: Vec<Node>,
        #[serde(flatten)]
        boxing: Boxing,
    },
    /// Children on top of each other (a value over a ring).
    Overlay {
        children: Vec<Node>,
        #[serde(flatten)]
        boxing: Boxing,
    },
    /// Empty space that takes a share of what's left.
    Spacer {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        grow: Option<f64>,
    },
    /// Text from a template.
    Text {
        text: Template,
        /// Shorter forms, used in order when the text doesn't fit (it's never cut).
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        shorter: Vec<Template>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max_lines: Option<u8>,
    },
    Number {
        value: Expr,
        /// The text shown; default: the value with at most 3 decimals.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<Template>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        unit: Option<Template>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        motion: Option<NumberMotion>,
    },
    Icon {
        /// A Material Symbols name.
        icon: Template,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        filled: Option<Expr>,
    },
    Image {
        src: Expr,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fit: Option<Fit>,
    },
    /// One of the library's shapes; it morphs when the name changes.
    Shape {
        shape: Template,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<Expr>,
    },
    Ring {
        /// 0 … 1.
        value: Expr,
        /// Arc length in degrees (1 … 360, default 360).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sweep: Option<u16>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        thickness: Option<u8>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        caps: Option<Caps>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        segments: Option<u8>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        wavy: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ticks: Option<u8>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        needle: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<Expr>,
    },
    Bar {
        /// 0 … 1, or a list of parts for a stacked bar.
        value: Expr,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        axis: Option<Axis>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        segments: Option<u8>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<Expr>,
    },
    Chart {
        /// A list of numbers; or use `history`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        values: Option<Expr>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        history: Option<HistoryRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        plot: Option<Plot>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        smooth: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        min: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max: Option<f64>,
    },
    Heatmap {
        /// Values 0 … `max`.
        values: Expr,
        columns: u8,
        /// The value that is full heat (default 1).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max: Option<f64>,
    },
    /// Repeats `item` for each element of `items`; inside, `$item` and `$index`.
    List {
        items: Expr,
        item: Box<Node>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max: Option<u16>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        axis: Option<Axis>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        gap: Option<u8>,
    },
    Progress {
        value: Expr,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        wavy: bool,
    },
    Divider {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        axis: Option<Axis>,
    },
    /// A built-in visual (analog clock, visualizer, weather sky, photo frame).
    Canvas {
        visual: String,
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        params: BTreeMap<String, Expr>,
    },
    Button {
        text: Template,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        icon: Option<Template>,
        command: CommandRef,
        /// Ask first ("Power off the drive?").
        #[serde(default, skip_serializing_if = "Option::is_none")]
        confirm: Option<Template>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        enabled: Option<Expr>,
    },
    Toggle {
        value: Expr,
        command: CommandRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<Template>,
    },
    Slider {
        value: Expr,
        min: f64,
        max: f64,
        step: f64,
        command: CommandRef,
    },
    Input {
        value: Expr,
        command: CommandRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        placeholder: Option<Template>,
        max_length: u16,
    },
    /// A plugin's block (P9).
    Plugin {
        plugin: String,
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        props: BTreeMap<String, Expr>,
    },
}

impl Kind {
    /// The node's children, with the JSON key they're under.
    pub fn children(&self) -> Vec<(&'static str, Option<usize>, &Node)> {
        match self {
            Self::Stack { children, .. }
            | Self::Row { children, .. }
            | Self::Column { children, .. }
            | Self::Grid { children, .. }
            | Self::Overlay { children, .. } => children
                .iter()
                .enumerate()
                .map(|(i, c)| ("children", Some(i), c))
                .collect(),
            Self::List { item, .. } => vec![("item", None, item.as_ref())],
            _ => Vec::new(),
        }
    }

    pub fn is_container(&self) -> bool {
        matches!(
            self,
            Self::Stack { .. }
                | Self::Row { .. }
                | Self::Column { .. }
                | Self::Grid { .. }
                | Self::Overlay { .. }
        )
    }
}
