# Third-party material

Opaline is GPL-3.0-or-later. This file lists third-party material that is **bundled or ported** into Opaline, with
its license and attribution. Libraries pulled in through Cargo and pnpm keep their own license files; a full
dependency license report is generated for releases (Phase 8).

| Material | Where | License | Notes |
| - | - | - | - |
| androidx `graphics-shapes` (Cubic, Feature, RoundedPolygon, CornerRounding, Shapes, Morph, PolygonMeasure, FeatureMapping, FloatMapping), ported to TypeScript | `app/src/design-system/shapes/` | Apache-2.0 | © The Android Open Source Project. Source: `androidx/androidx`, `graphics/graphics-shapes/src/commonMain`, androidx-main as of 2026-11-23. |
| Material 3 `MaterialShapes` (the 35 shape definitions) and the loading-indicator shape sequence, ported | `app/src/design-system/shapes/material.ts` | Apache-2.0 | © The Android Open Source Project. Source: `compose/material3/material3/src/commonMain/.../MaterialShapes.kt`, `LoadingIndicator.kt`. |
| Material 3 Expressive motion token values (stiffness, damping) | `app/src/design-system/tokens/tokens.ts` | Apache-2.0 | Values from `ExpressiveMotionTokens.kt` (androidx). |
| Roboto Flex (variable) | bundled via `@fontsource-variable/roboto-flex` 5.3.0 | OFL-1.1 | © The Roboto Flex Project Authors. |
| Inter (variable) | bundled via `@fontsource-variable/inter` 5.3.0 | OFL-1.1 | © The Inter Project Authors. |
| Noto Sans Arabic (variable) | bundled via `@fontsource-variable/noto-sans-arabic` 5.3.0 | OFL-1.1 | © The Noto Project Authors. |
| Material Symbols Rounded (variable), subset to the icons Opaline uses | `app/src/design-system/icons/material-symbols-rounded-subset.woff2` (from `material-symbols` 0.49.0; codepoints from `google/material-design-icons`) | Apache-2.0 | © Google. Regenerate with `pnpm icons`. |

The app icon (`packaging/icons/opaline.svg`) is original artwork made for this project.
