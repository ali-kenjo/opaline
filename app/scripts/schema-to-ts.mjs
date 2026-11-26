// Generates TypeScript types from a JSON Schema that schemars wrote from the Rust types (the
// Rust types are the source, PLAN-2 §2.1). Handles the subset schemars emits: $ref/$defs,
// oneOf/anyOf, const, enum, nullable type arrays, arrays, objects with properties or
// additionalProperties, and an object with both properties and oneOf (flattened tagged enums).
//
//   node scripts/schema-to-ts.mjs           write the files
//   node scripts/schema-to-ts.mjs --check   exit 1 when a file is stale
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as prettier from "prettier";

const root = resolve(import.meta.dirname, "../..");

const TARGETS = [
  {
    schema: "spec/composition.schema.json",
    out: "app/src/compose/model.gen.ts",
  },
  {
    schema: "spec/style.schema.json",
    out: "app/src/design-system/style/style.gen.ts",
    keysExport: "STYLE_KEYS",
  },
];

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function doc(text, indent = "") {
  if (!text) return "";
  const lines = text.split("\n");
  if (lines.length === 1) return `${indent}/** ${text} */\n`;
  return `${indent}/**\n${lines.map((l) => `${indent} * ${l}`.trimEnd()).join("\n")}\n${indent} */\n`;
}

function literal(v) {
  return JSON.stringify(v);
}

/** The TS type of a schema; `optional` drops `null` (serde skips `None`). */
function type(s, optional = false) {
  if (s === true || (typeof s === "object" && Object.keys(s).length === 0)) return "unknown";
  if (s.$ref) return s.$ref.replace("#/$defs/", "");
  const variants = s.oneOf ?? s.anyOf;
  if (variants && !s.properties) {
    const parts = variants.map((v) => type(v)).filter((t) => !(optional && t === "null"));
    return union(parts);
  }
  if (s.const !== undefined) return literal(s.const);
  if (s.enum) return union(s.enum.map(literal));
  const types = Array.isArray(s.type) ? s.type : [s.type];
  const parts = types
    .filter((t) => !(optional && t === "null"))
    .map((t) => {
      switch (t) {
        case "integer":
        case "number":
          return "number";
        case "string":
          return "string";
        case "boolean":
          return "boolean";
        case "null":
          return "null";
        case "array":
          if (Array.isArray(s.prefixItems)) {
            return `[${s.prefixItems.map((p) => type(p)).join(", ")}]`;
          }
          return `${wrap(type(s.items ?? true))}[]`;
        case "object":
          return object(s);
        default:
          throw new Error(`unsupported schema type ${String(t)}`);
      }
    });
  return union(parts);
}

const union = (parts) => [...new Set(parts)].join(" | ") || "never";
const wrap = (t) => (t.includes(" ") ? `(${t})` : t);

function object(s) {
  const props = s.properties ?? {};
  const required = new Set(s.required ?? []);
  let body = "";
  for (const [name, p] of Object.entries(props)) {
    const key = IDENT.test(name) ? name : literal(name);
    const opt = !required.has(name);
    body += doc(p.description, "  ");
    body += `  ${key}${opt ? "?" : ""}: ${type(p, opt)};\n`;
  }
  let t;
  if (Object.keys(props).length === 0) {
    const extra = s.additionalProperties;
    t =
      extra === undefined || extra === true
        ? "Record<string, unknown>"
        : `Record<string, ${type(extra)}>`;
  } else {
    t = `{\n${body}}`;
  }
  const variants = s.oneOf ?? s.anyOf;
  if (variants && s.properties) {
    return `${t} & (${variants.map((v) => `\n${doc(v.description)}| ${type(v)}`).join("")})`;
  }
  return t;
}

async function generate(target) {
  const schema = JSON.parse(readFileSync(resolve(root, target.schema), "utf8"));
  let out =
    `// Generated from ${target.schema} by app/scripts/schema-to-ts.mjs; don't edit.\n` +
    `// The Rust types are the source: change them, then run \`pnpm gen:types\`.\n\n`;
  const defs = {
    [schema.title]: { ...schema, $defs: undefined, $schema: undefined, title: undefined },
    ...schema.$defs,
  };
  for (const [name, s] of Object.entries(defs)) {
    out += doc(s.description);
    const t = type(s);
    // A plain object type is an interface (the lint's consistent-type-definitions).
    const plain = t.startsWith("{\n") && t.endsWith("}") && !t.includes("} & (");
    out += plain ? `export interface ${name} ${t}\n\n` : `export type ${name} = ${t};\n\n`;
  }
  if (target.keysExport && schema.properties) {
    const keys = Object.keys(schema.properties).map(literal).join(", ");
    out += `export const ${target.keysExport} = [${keys}] as const;\n\n`;
  }
  const file = resolve(root, target.out);
  const config = (await prettier.resolveConfig(file)) ?? {};
  return { file, text: await prettier.format(out, { ...config, filepath: file }) };
}

const check = process.argv.includes("--check");
let stale = false;
for (const target of TARGETS) {
  const { file, text } = await generate(target);
  let current = "";
  try {
    current = readFileSync(file, "utf8");
  } catch {
    // Missing counts as stale.
  }
  if (current === text) continue;
  if (check) {
    console.error(`${target.out} is stale: run \`pnpm gen:types\``);
    stale = true;
  } else {
    writeFileSync(file, text);
    console.log(`wrote ${target.out}`);
  }
}
process.exit(stale ? 1 : 0);
