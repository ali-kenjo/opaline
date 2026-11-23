// Subsets Material Symbols Rounded (variable: FILL, GRAD, opsz, wght) to the icons in
// app/src/design-system/icons/codepoints.ts, keeping every variation axis. The full font is
// 5.4 MB; the subset is what Opaline ships (docs/DESIGN.md §7).
// Usage (in app/): pnpm icons
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import subsetFont from "subset-font";

const app = resolve(import.meta.dirname, "..");
const source = readFileSync(resolve(app, "src/design-system/icons/codepoints.ts"), "utf8");
const codepoints = [...source.matchAll(/0x([0-9a-f]{4,5})/gi)].map((m) => parseInt(m[1], 16));
const text = String.fromCodePoint(...codepoints);
const font = readFileSync(
  resolve(app, "node_modules/material-symbols/material-symbols-rounded.woff2"),
);
const subset = await subsetFont(font, text, {
  targetFormat: "woff2",
  preserveNameIds: [0, 1, 2, 3, 13, 14],
});
const out = resolve(app, "src/design-system/icons/material-symbols-rounded-subset.woff2");
writeFileSync(out, subset);
console.log(`${codepoints.length} icons: ${font.length} → ${subset.length} bytes → ${out}`);
