// Ported from androidx graphics-shapes (Features.kt), Apache-2.0, © The Android Open Source
// Project. See THIRD_PARTY.md.
import { Cubic } from "./cubic";
import { DISTANCE_EPSILON, type PointTransformer } from "./point";

/** A run of cubics: an edge (ignorable when morphing) or a convex/concave corner. */
export class Feature {
  private constructor(
    readonly cubics: readonly Cubic[],
    readonly kind: "edge" | "corner",
    readonly convex: boolean,
  ) {}

  static edge(cubics: readonly Cubic[]): Feature {
    return new Feature(cubics, "edge", false);
  }

  static ignorable(cubics: readonly Cubic[]): Feature {
    return Feature.validated(new Feature(cubics, "edge", false));
  }

  static corner(cubics: readonly Cubic[], convex = true): Feature {
    return Feature.validated(new Feature(cubics, "corner", convex));
  }

  private static validated(f: Feature): Feature {
    if (f.cubics.length === 0) throw new Error("Features need at least one cubic.");
    for (let i = 1; i < f.cubics.length; i++) {
      const prev = f.cubics[i - 1];
      const c = f.cubics[i];
      if (
        prev &&
        c &&
        (Math.abs(c.anchor0X - prev.anchor1X) > DISTANCE_EPSILON ||
          Math.abs(c.anchor0Y - prev.anchor1Y) > DISTANCE_EPSILON)
      ) {
        throw new Error("Feature must be continuous");
      }
    }
    return f;
  }

  get isIgnorable(): boolean {
    return this.kind === "edge";
  }
  get isEdge(): boolean {
    return this.kind === "edge";
  }
  get isConvexCorner(): boolean {
    return this.kind === "corner" && this.convex;
  }
  get isConcaveCorner(): boolean {
    return this.kind === "corner" && !this.convex;
  }

  transformed(f: PointTransformer): Feature {
    return new Feature(
      this.cubics.map((c) => c.transformed(f)),
      this.kind,
      this.convex,
    );
  }

  reversed(): Feature {
    const cubics = [...this.cubics].reverse().map((c) => c.reverse());
    return new Feature(cubics, this.kind, this.kind === "corner" ? !this.convex : false);
  }
}
