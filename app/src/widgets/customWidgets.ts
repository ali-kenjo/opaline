// Dynamic registry of user-created & forked custom widgets (PLAN-2 6.7).
// Populated from core's `widgets.custom` topic (`~/.config/opaline/widgets/*.json`) and updated
// live whenever the Widget Builder saves or deletes a custom widget.
import { create } from "zustand";
import type { Composition, SizeClass } from "../compose/model.gen";
import type { IconName } from "../design-system/icons";
import { ICONS } from "../design-system/icons/codepoints";
import type { Value } from "../layer/protocol";
import { toJson } from "./json";
import type { WidgetDef } from "./types";

export const CUSTOM_WIDGETS_TOPIC = "widgets.custom";
export const SOURCES_CATALOG_TOPIC = "sources.catalog";

export interface CustomWidgetPackage {
  version: number;
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  author?: string;
  forkedFrom?: string;
  accessibleName?: string;
  sizes: SizeClass[];
  defaultSize: SizeClass;
  topics: string[];
  composition: Composition;
}

interface CustomWidgetStore {
  packages: CustomWidgetPackage[];
  defs: Record<string, WidgetDef>;
  setPackages: (pkgs: CustomWidgetPackage[]) => void;
  upsertPackage: (pkg: CustomWidgetPackage) => void;
  removePackage: (id: string) => void;
}

function customKind(id: string): string {
  return id.startsWith("custom.") ? id : `custom.${id}`;
}

function safeIcon(name: string): IconName {
  return name in ICONS ? (name as IconName) : "widgets";
}

export function packageToWidgetDef(pkg: CustomWidgetPackage): WidgetDef {
  const icon = safeIcon(pkg.icon);
  const kind = customKind(pkg.id);

  return {
    kind,
    name: pkg.name,
    icon,
    category: "info",
    sizes: pkg.sizes.length > 0 ? pkg.sizes : ["M"],
    defaultSize: pkg.sizes.includes(pkg.defaultSize) ? pkg.defaultSize : (pkg.sizes[0] ?? "M"),
    topics: pkg.topics,
    fields: [],
    defaultFields: [],
    status: () => ({ kind: "ready" }),
    composition: pkg.composition,
    render: () => null,
  };
}

export const useCustomWidgets = create<CustomWidgetStore>((set) => ({
  packages: [],
  defs: {},
  setPackages: (packages) => {
    const defs: Record<string, WidgetDef> = {};
    for (const pkg of packages) {
      defs[customKind(pkg.id)] = packageToWidgetDef(pkg);
    }
    set({ packages, defs });
  },
  upsertPackage: (pkg) => {
    set((state) => {
      const next = [...state.packages.filter((p) => p.id !== pkg.id), pkg].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      const defs = { ...state.defs, [customKind(pkg.id)]: packageToWidgetDef(pkg) };
      return { packages: next, defs };
    });
  },
  removePackage: (id) => {
    set((state) => {
      const next = state.packages.filter((p) => p.id !== id);
      const defs = { ...state.defs };
      Reflect.deleteProperty(defs, customKind(id));
      return { packages: next, defs };
    });
  },
}));

export function syncCustomWidgetsFromTopic(val: Value | undefined): void {
  if (!val) return;
  const raw = toJson(val);
  if (!Array.isArray(raw)) return;
  const pkgs: CustomWidgetPackage[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    if (
      typeof obj.id === "string" &&
      typeof obj.name === "string" &&
      typeof obj.composition === "object" &&
      obj.composition !== null
    ) {
      pkgs.push(item as unknown as CustomWidgetPackage);
    }
  }
  useCustomWidgets.getState().setPackages(pkgs);
}

export function customWidgetByKind(kind: string): WidgetDef | undefined {
  return useCustomWidgets.getState().defs[kind];
}

export function customPackageByKind(kind: string): CustomWidgetPackage | undefined {
  const id = kind.startsWith("custom.") ? kind.slice(7) : kind;
  return useCustomWidgets.getState().packages.find((p) => p.id === id);
}

/** Forks any first-party or custom widget into an editable CustomWidgetPackage ("Customize layout…"). */
export function forkWidgetToPackage(
  def: WidgetDef,
  existingIds: readonly string[],
): CustomWidgetPackage {
  const base = def.kind.replace(/^custom\./, "").replace(/[^a-z0-9-]+/g, "-") || "widget";
  let id = `${base}-custom`;
  let n = 2;
  while (existingIds.includes(id)) {
    id = `${base}-custom-${String(n)}`;
    n += 1;
  }

  const existingCustom = customPackageByKind(def.kind);
  const defTopics = def.topics ?? [];
  const comp: Composition = existingCustom
    ? structuredClone(existingCustom.composition)
    : def.composition
      ? structuredClone(def.composition)
      : {
          version: 1,
          bindings: {},
          layouts: [
            {
              sizes: [...def.sizes],
              root: {
                id: "root",
                type: "column",
                gap: 2,
                padding: 3,
                children: [
                  { id: "title", type: "text", role: "title", text: def.name },
                  {
                    id: "value",
                    type: "text",
                    role: "hero",
                    text: defTopics[0] ? `{${defTopics[0]}}` : "—",
                  },
                ],
              },
            },
          ],
        };

  return {
    version: 1,
    id,
    name: `${def.name} (Custom)`,
    description: `Customized layout forked from ${def.name}`,
    category: "custom",
    icon: def.icon,
    forkedFrom: def.kind,
    sizes: [...def.sizes],
    defaultSize: def.defaultSize,
    topics: [...defTopics],
    composition: comp,
  };
}
