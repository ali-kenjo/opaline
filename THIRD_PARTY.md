# Third-party material

Opaline is GPL-3.0-or-later. This file lists third-party material that is **bundled or ported** into Opaline, with
its license and attribution. Libraries pulled in through Cargo and pnpm keep their own license files; a full
dependency license report is generated for releases (Phase 8).

| Material | Where | License | Notes |
| - | - | - | - |
| androidx `graphics-shapes` (Cubic, Feature, RoundedPolygon, CornerRounding, Shapes, Morph, PolygonMeasure, FeatureMapping, FloatMapping), ported to TypeScript | `app/src/design-system/shapes/` | Apache-2.0 | © The Android Open Source Project. Source: `androidx/androidx`, `graphics/graphics-shapes/src/commonMain`, androidx-main as of 2026-11-23. |
| Material 3 `MaterialShapes` (the 35 shape definitions) and the loading-indicator shape sequence, ported | `app/src/design-system/shapes/material.ts` | Apache-2.0 | © The Android Open Source Project. Source: `compose/material3/material3/src/commonMain/.../MaterialShapes.kt`, `LoadingIndicator.kt`. |
| Material 3 Expressive motion token values (stiffness, damping) | `app/src/design-system/tokens/tokens.ts` | Apache-2.0 | Values from `ExpressiveMotionTokens.kt` (androidx). |

Planned entries (added when the material lands): Roboto Flex and Inter (OFL-1.1), Noto Sans Arabic (OFL-1.1),
Material Symbols Rounded (Apache-2.0).

The app icon (`packaging/icons/opaline.svg`) is original artwork made for this project.
