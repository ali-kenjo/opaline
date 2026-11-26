# ADR 0017: Style-key parity between Rust and TypeScript

Status: accepted (2.0 · Phase 3, Spike S7) · 2026-11-27

## Context
In Opaline 1.x, style keys were hand-maintained in three places (`crates/opaline-core/src/style.rs`,
`app/src/design-system/style/types.ts`, and `app/src/design-system/style/fields.ts`). Phase 3 expands
the style model significantly (surface shapes, gradients, per-role typography, icon sets, hero visual
options, effects, behavior actions, conditional styles) and publishes JSON Schemas so users get editor
validation and autocomplete in `settings.json` and `theme.json`. Keeping three copies in sync by hand
is error-prone.

## Decision
The Rust types in `crates/opaline-core/src/style.rs` are the single source of truth, following the
exact pipeline established by `opaline-compose` in Phase 2:

1. `Style` and its supporting enums/structs derive `schemars::JsonSchema`.
2. `crates/opaline-core/tests/schemas.rs` asserts that `spec/style.schema.json` (and the other
   config/theme schemas) match `schemars` output; `OPALINE_UPDATE_SCHEMA=1 cargo test -p opaline-core
   --test schemas` regenerates them.
3. `app/scripts/schema-to-ts.mjs` generates `app/src/design-system/style/style.gen.ts` from
   `spec/style.schema.json`, including `export const STYLE_KEYS = [...] as const;` for the root
   `Style` object.
4. `app/src/design-system/style/types.ts` derives `StyleKey`, `ResolvedStyle`, and `BUILTIN_STYLE`
   from the generated `Style` interface and re-exports the generated enums.
5. `app/src/compose/model.test.ts` runs `schema-to-ts.mjs --check`, failing Vitest whenever any
   generated `.gen.ts` file is stale; `app/src/design-system/style/style.test.ts` asserts that
   `STYLE_FIELDS` covers every key in `STYLE_KEYS` and `tsc` enforces `BUILTIN_STYLE` completeness.

## Consequences
- Adding, renaming, or removing a style key in Rust automatically fails `cargo test` (stale schema),
  `vitest` (stale `style.gen.ts` or missing field metadata), and `tsc` (missing default in
  `BUILTIN_STYLE`) until every layer is updated.
- The generated `spec/style.schema.json` is reused directly by `settings.schema.json` and
  `theme.schema.json` and installed into `/usr/share/opaline/schemas/`.
