# Opaline compositions

Status: Phase 2 (2026-11-26). A widget is a **composition**: a tree of containers and blocks, with one layout per size
(brief §4.1). First-party widgets are compositions too (from P4), and any of them can be forked into a custom widget.

## 1. Where the format lives

- **Source of truth**: the Rust types in `crates/opaline-compose/src/model.rs` (serde + schemars).
- **JSON Schema**: `spec/composition.schema.json`, written from those types. A test fails when it's stale
  (`OPALINE_UPDATE_SCHEMA=1 cargo test -p opaline-compose` rewrites it).
- **TypeScript types**: `app/src/compose/model.gen.ts`, generated from the schema by `app/scripts/schema-to-ts.mjs`
  (`pnpm gen:types`). A test fails when it's stale.
- **Validation**: `opaline_compose::validate` checks what the schema can't (§5). Core validates every composition it
  loads; the layer renders only validated ones.
- **Fixtures**: `spec/compositions/*.json` must validate and round-trip unchanged.

Change the Rust types first, then regenerate both files.

## 2. Shape

```json
{
  "version": 1,
  "bindings": { "load": "cpu.load / 100" },
  "layouts": [
    { "sizes": ["S"], "root": { "id": "face", "type": "overlay", "children": [
      { "id": "ring", "type": "ring", "role": "meter", "value": "bind.load" },
      { "id": "value", "type": "text", "role": "hero", "text": "{cpu.load | round}%" }
    ] } },
    { "root": { "id": "face", "type": "row", "gap": 2, "children": ["…"] } }
  ]
}
```

- **Layouts** are tried in order; the first whose `sizes` contains the widget's size class (or that has no `sizes`)
  is used. `minW`/`minH` (grid cells) are for free sizes (P5).
- **Ids** are stable across layouts: the same id in two layouts is the same block, so a resize morphs it.
- **Bindings** are named expressions shared by all layouts, read as `bind.<name>`. A widget's fields become bindings.
  Bindings may read other bindings, never in a circle.

## 3. Nodes

Every node has `id`, `type` and optionally `role` (`hero`, `title`, `label`, `value`, `unit`, `caption`, `accent`,
`badge`, `meter`, `decoration`; themes style roles), `visible` (expression), `priority` (0 … 100, default 50; lower
goes first when space runs out), `label` (accessible name, template) and `style` (style keys, ADR 0011).

| Type | Fields (expressions *E*, templates *T*) |
| - | - |
| `stack` | children; side by side when wider than tall, else stacked |
| `row`, `column`, `overlay` | children |
| `grid` | `columns` 1 … 12, children |
| (all containers) | `gap`, `padding` (steps 0 … 8 of the 4-pt scale), `align`, `justify`, `grow` |
| `spacer` | `grow` |
| `text` | `text` *T*, `shorter` *T*[] (used in order when it doesn't fit; text is never cut), `maxLines` |
| `number` | `value` *E*, `text` *T*, `unit` *T*, `motion` (`odometer`, `fade`, `none`) |
| `icon` | `icon` *T* (Material Symbols name), `filled` *E* |
| `image` | `src` *E*, `fit` |
| `shape` | `shape` *T* (library name; morphs on change), `color` *E* |
| `ring` | `value` *E* 0 … 1, `sweep`, `thickness`, `caps`, `segments`, `wavy`, `ticks`, `needle`, `color` *E* |
| `bar` | `value` *E* (0 … 1, or a list for stacked parts), `axis`, `segments`, `color` *E* |
| `chart` | `values` *E* or `history` {`path`, `window`}, `plot` (`line`, `area`, `bars`, `step`, `dots`), `smooth`, `min`, `max` |
| `heatmap` | `values` *E*, `columns` |
| `list` | `items` *E*, `item` (a node, repeated), `max`, `axis`, `gap`; inside, `$item` and `$index` |
| `progress` | `value` *E*, `wavy` |
| `divider` | `axis` |
| `canvas` | `visual` (a built-in visual: `analog-clock`, …), `params` {name: *E*} |
| `button` | `text` *T*, `icon` *T*, `command`, `confirm` *T*, `enabled` *E* |
| `toggle` | `value` *E*, `command`, `text` *T* |
| `slider` | `value` *E*, `min`, `max`, `step`, `command` |
| `input` | `value` *E*, `command`, `placeholder` *T*, `maxLength` |
| `plugin` | `plugin` (id), `props` {name: *E*} (P9) |

A `command` is `{ "cmd": "<IPC command name>", "args": { "<name>": E } }`. The layer evaluates the arguments (`$value`
is the control's new value) and sends the command; core validates it like any other command (ARCHITECTURE §3.7).

## 4. Names in expressions

| Name | What |
| - | - |
| `cpu.load`, `weather.current.tempC`, … | topics, resolved by longest prefix (EXPRESSIONS.md §5) |
| `bind.<name>` | the composition's bindings |
| `opt.<key>` | the widget's content settings |
| `$item`, `$index` | inside a `list` item only |
| `$value` | in a control's command arguments: its new value |

## 5. Validation

`validate` reports each problem with a JSON pointer (`/layouts/0/root/children/1/text`) and, for expressions, the
error code and position, so the builder can mark the exact spot. It checks:

- version 1; 1 … 16 layouts; at most 64 bindings, named `[A-Za-z][A-Za-z0-9_]*`;
- ids `[a-z][a-z0-9-]*`, at most 32 characters, unique within a layout;
- every expression and template compiles and type-checks (`opaline-expr`); `$item`/`$index` only inside a list item;
  `bind.*` names exist; bindings have no cycles;
- ranges: spacing steps 0 … 8, grid columns 1 … 12, ring sweep 1 … 360, priority 0 … 100, slider `min < max` and
  `step > 0`, chart `min < max` and either `values` or `history`, `maxLength` 1 … 4096; visual, plugin and command
  names kebab-case;
- **limits that keep hostile files cheap**: at most 1 MiB, 1024 nodes, 64 children per container, nesting 24 deep.
  `parse` checks the raw text's JSON nesting (at most 64) before serde sees it: the model's flattened, tagged enums
  make serde recurse deeply per level, and a 5000-level file would otherwise overflow the stack.

Unknown fields are ignored (a newer file still opens in an older Opaline; the schema documents the known ones).
