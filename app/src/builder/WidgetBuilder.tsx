// Code-split Visual Widget Builder (PLAN-2 6.7, brief §4.1–4.5):
// Block tree, live CompositionView canvas, block palette, properties & binding editor with
// live evaluated values and inline errors, per-size layouts, accessible names, and fork-from-
// first-party support ("Customize layout…").
import { useEffect, useMemo, useState } from "react";
import type { Align, Justify, Layout, Node, Role, SizeClass } from "../compose/model.gen";
import { formatDate } from "../compose/dates";
import { CompositionView, type Services } from "../compose/render/View";
import { Runtime } from "../compose/runtime";
import { EMPTY_ENV } from "../compose/widget";
import { makeRamp, type RampName } from "../design-system/color/ramps";
import { Button } from "../design-system/components";
import { Icon, type IconName } from "../design-system/icons";
import { ICONS } from "../design-system/icons/codepoints";
import { sizes, spanPx } from "../design-system/tokens/tokens";
import type { Host, Value as ExprValue } from "../expr";
import { isRtl, resolveLocale } from "../i18n";
import { type CustomWidgetPackage, useCustomWidgets } from "../widgets/customWidgets";
import { useHost } from "../widgets/host";
import { fromJson, toJson } from "../widgets/json";
import {
  BUILDER_SIZES,
  PALETTE_ITEMS,
  type PaletteBlockType,
  ROLES,
  collectNodeIds,
  collectTopicsFromComposition,
  createBlockNode,
  createStarterPackage,
  deleteNodeById,
  evaluateBindingPreview,
  findNodeById,
  generateAccessibleName,
  insertChildInto,
  isContainerNode,
  makePreviewHost,
  moveNodeInParent,
  updateNodeById,
} from "./builderModel";
import styles from "./WidgetBuilder.module.css";

export interface WidgetBuilderProps {
  open: boolean;
  initial?: CustomWidgetPackage | null;
  onClose: () => void;
  onSaved?: (pkg: CustomWidgetPackage, addToDesktop: boolean) => void;
}

interface FlatTreeEntry {
  node: Node;
  depth: number;
}

function flattenTree(node: Node, depth = 0, out: FlatTreeEntry[] = []): FlatTreeEntry[] {
  out.push({ node, depth });
  if (isContainerNode(node)) {
    for (const c of node.children) flattenTree(c, depth + 1, out);
  } else if (node.type === "list") {
    flattenTree(node.item, depth + 1, out);
  }
  return out;
}

function ExprInput({
  label,
  value,
  mode,
  env,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  mode: "expression" | "template";
  env: Host;
  placeholder?: string;
  onChange: (next: string) => void;
}) {
  const preview = useMemo(
    () => (value.trim() ? evaluateBindingPreview(value, mode, env) : null),
    [value, mode, env],
  );
  return (
    <label className={styles.fieldLabel}>
      {label}
      <input
        type="text"
        className={`${styles.input} ${styles.monoInput}`}
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
      {preview ? (
        preview.ok ? (
          <span className={styles.evalOk} role="status">
            = {preview.formatted}
          </span>
        ) : (
          <span className={styles.evalErr} role="alert">
            Error at {preview.at}: {preview.error}
          </span>
        )
      ) : null}
    </label>
  );
}

const currentTimeMs = () => Date.now();

export function WidgetBuilder({ open, initial, onClose, onSaved }: WidgetBuilderProps) {
  const host = useHost();
  const [pkg, setPkg] = useState<CustomWidgetPackage>(() =>
    initial ? structuredClone(initial) : createStarterPackage(),
  );
  const [layoutIdx, setLayoutIdx] = useState(0);
  const [selectedId, setSelectedId] = useState(() => pkg.composition.layouts[0]?.root.id ?? "root");
  const [previewSize, setPreviewSize] = useState<SizeClass>(pkg.defaultSize);
  const [newBindName, setNewBindName] = useState("");
  const [newBindExpr, setNewBindExpr] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // Live topic values from the host store (stable reference).
  const allWireValues = host.useValues((all) => all);
  const liveTopics = useMemo(() => {
    const out: Record<string, ExprValue> = {};
    for (const [k, v] of Object.entries(allWireValues)) {
      if (k.startsWith("sources.") || k.startsWith("widgets.") || k.startsWith("themes.")) continue;
      out[k] = toJson(v);
    }
    return out;
  }, [allWireValues]);

  const availableTopicNames = useMemo(() => {
    const keys = Object.keys(liveTopics).filter(
      (k) =>
        k.startsWith("source.") ||
        k.startsWith("var.") ||
        k.startsWith("cpu.") ||
        k.startsWith("memory."),
    );
    return [...new Set(["cpu.load", "memory.percent", ...keys])].sort().slice(0, 12);
  }, [liveTopics]);

  const rampColor = useMemo(
    () => (t: number, name: string) =>
      name === "thermal" || name === "load" || name === "health"
        ? `#${(makeRamp(name, host.colors.wallpaper, host.colors.systemDark).at(t) & 0xffffff)
            .toString(16)
            .padStart(6, "0")}`
        : null,
    [host.colors.wallpaper, host.colors.systemDark],
  );

  const exprEnv = useMemo<Host>(() => {
    const base = makePreviewHost(liveTopics);
    return {
      ...base,
      date: (ms: number, skeleton: string, zone: string | undefined) =>
        formatDate(ms, skeleton, zone),
      ramp: rampColor,
    };
  }, [liveTopics, rampColor]);

  const activeLayout: Layout | undefined =
    pkg.composition.layouts[layoutIdx] ?? pkg.composition.layouts[0];
  const rootNode = activeLayout?.root;
  const flatTree = useMemo(() => (rootNode ? flattenTree(rootNode) : []), [rootNode]);
  const selectedNode = useMemo(
    () => (rootNode ? (findNodeById(rootNode, selectedId) ?? rootNode) : null),
    [rootNode, selectedId],
  );

  // Compile live CompositionView runtime whenever composition changes.
  const { runtime, compileError } = useMemo(() => {
    try {
      const rt = new Runtime(pkg.composition, EMPTY_ENV);
      return { runtime: rt, compileError: null };
    } catch (e) {
      return { runtime: null, compileError: String(e) };
    }
  }, [pkg.composition]);

  const services = useMemo<Services>(
    () => ({
      command: () => Promise.resolve({ result: "ok" as const }),
      history: () => Promise.resolve([]),
      ramp: (name: RampName) => makeRamp(name, host.colors.wallpaper, host.colors.systemDark),
      releaseFocus: () => undefined,
    }),
    [host.colors.wallpaper, host.colors.systemDark],
  );

  if (runtime) {
    runtime.setEnv({
      topics: allWireValues,
      options: { title: pkg.name },
      locale: "en",
      now: currentTimeMs,
      date: (ms: number, skeleton: string, zone: string | undefined) =>
        formatDate(ms, skeleton, zone),
      ramp: rampColor,
    });
  }

  if (!open || !activeLayout || !rootNode || !selectedNode) return null;

  const updateActiveRoot = (nextRoot: Node) => {
    setPkg((prev) => {
      const layouts = prev.composition.layouts.map((l, i) =>
        i === layoutIdx ? { ...l, root: nextRoot } : l,
      );
      return { ...prev, composition: { ...prev.composition, layouts } };
    });
  };

  const updateSelected = (updater: (n: Node) => Node) => {
    updateActiveRoot(updateNodeById(rootNode, selectedNode.id, updater));
  };

  const handleAddBlock = (blockType: PaletteBlockType) => {
    const ids = collectNodeIds(rootNode);
    const created = createBlockNode(blockType, ids);
    const parentId = isContainerNode(selectedNode) ? selectedNode.id : rootNode.id;
    updateActiveRoot(insertChildInto(rootNode, parentId, created));
    setSelectedId(created.id);
  };

  const handleSave = async (addToDesktop: boolean) => {
    const cleanId = pkg.id
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[^a-z0-9]+/, "");
    if (!cleanId) {
      setStatus("Widget ID must start with a lowercase letter or digit");
      return;
    }
    const topics = collectTopicsFromComposition(pkg.composition);
    const trimmedA11y = pkg.accessibleName?.trim();
    const finalPkg: CustomWidgetPackage = {
      ...pkg,
      id: cleanId,
      name: pkg.name.trim() || "Custom Widget",
      topics,
      accessibleName:
        trimmedA11y && trimmedA11y.length > 0 ? trimmedA11y : generateAccessibleName(pkg),
    };
    setSaving(true);
    setStatus(null);
    try {
      const res = await host.command({
        cmd: "save-custom-widget",
        widget: fromJson(finalPkg as unknown as Parameters<typeof fromJson>[0]),
      });
      if (res.result === "err") {
        setStatus(`Could not save: ${res.reason}`);
      } else {
        useCustomWidgets.getState().upsertPackage(finalPkg);
        setPkg(finalPkg);
        setStatus(`Saved "${finalPkg.name}"`);
        onSaved?.(finalPkg, addToDesktop);
      }
    } catch (e) {
      setStatus(`Could not save: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleAddLayout = () => {
    const used = new Set(pkg.composition.layouts.flatMap((l) => l.sizes ?? []));
    const unusedSize = pkg.sizes.find((s) => !used.has(s)) ?? "S";
    const clone: Layout = {
      sizes: [unusedSize],
      root: structuredClone(rootNode),
    };
    setPkg((prev) => ({
      ...prev,
      composition: {
        ...prev.composition,
        layouts: [...prev.composition.layouts, clone],
      },
    }));
    setLayoutIdx(pkg.composition.layouts.length);
    setPreviewSize(unusedSize);
  };

  const toggleSupportedSize = (sz: SizeClass) => {
    setPkg((prev) => {
      const has = prev.sizes.includes(sz);
      if (has && prev.sizes.length <= 1) return prev;
      const nextSizes = has ? prev.sizes.filter((s) => s !== sz) : [...prev.sizes, sz];
      const nextDefault = nextSizes.includes(prev.defaultSize)
        ? prev.defaultSize
        : (nextSizes[0] ?? "M");
      return { ...prev, sizes: nextSizes, defaultSize: nextDefault };
    });
  };

  const previewDims = sizes[previewSize];
  const cardW = spanPx(previewDims.w);
  const cardH = spanPx(previewDims.h);
  const bindings = pkg.composition.bindings ?? {};

  const dialogDir = isRtl(resolveLocale(host.settings.language)) ? "rtl" : "ltr";

  return (
    <div className={styles.backdrop} role="dialog" dir={dialogDir} aria-label="Widget Builder">
      <div className={styles.studio}>
        <header className={styles.header}>
          <div className={styles.headerTitle}>
            <Icon name="widgets" size={20} />
            <span>Widget Builder</span>
            <input
              type="text"
              aria-label="Widget name"
              className={styles.nameInput}
              value={pkg.name}
              onChange={(e) => {
                setPkg((p) => ({ ...p, name: e.target.value }));
              }}
            />
            <input
              type="text"
              aria-label="Widget ID"
              className={`${styles.input} ${styles.monoInput}`}
              style={{ width: 150 }}
              value={pkg.id}
              onChange={(e) => {
                setPkg((p) => ({ ...p, id: e.target.value }));
              }}
            />
          </div>
          {status ? (
            <span className={styles.statusNote} role="status">
              {status}
            </span>
          ) : null}
          <Button
            variant="outlined"
            icon="check"
            disabled={saving}
            onClick={() => {
              void handleSave(false);
            }}
          >
            Save
          </Button>
          <Button
            variant="filled"
            icon="add"
            disabled={saving}
            onClick={() => {
              void handleSave(true);
            }}
          >
            Save &amp; place
          </Button>
          <Button variant="text" icon="close" aria-label="Close builder" onClick={onClose}>
            Close
          </Button>
        </header>

        <div className={styles.body}>
          {/* Left pane: Per-size layouts, Block tree, Block palette */}
          <aside className={styles.pane} aria-label="Block tree and palette">
            <div>
              <h3 className={styles.sectionTitle}>Per-size layouts</h3>
              <div className={styles.sizeBar}>
                {pkg.composition.layouts.map((l, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`${styles.sizePill} ${idx === layoutIdx ? styles.sizePillActive : ""}`}
                    onClick={() => {
                      setLayoutIdx(idx);
                      setSelectedId(l.root.id);
                      if (l.sizes?.[0]) setPreviewSize(l.sizes[0]);
                    }}
                  >
                    {l.sizes && l.sizes.length > 0
                      ? l.sizes.join("/")
                      : `Layout ${String(idx + 1)}`}
                  </button>
                ))}
                <button type="button" className={styles.sizePill} onClick={handleAddLayout}>
                  + Layout
                </button>
              </div>
            </div>

            <div>
              <h3 className={styles.sectionTitle}>Block tree</h3>
              <ul className={styles.treeList} role="tree" aria-label="Composition tree">
                {flatTree.map(({ node, depth }) => (
                  <li key={node.id} role="treeitem" aria-selected={node.id === selectedNode.id}>
                    <button
                      type="button"
                      className={`${styles.treeRow} ${node.id === selectedNode.id ? styles.treeRowActive : ""}`}
                      style={{ paddingLeft: 8 + depth * 14 }}
                      onClick={() => {
                        setSelectedId(node.id);
                      }}
                    >
                      <span>{node.id}</span>
                      <span className={styles.treeType}>{node.type}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className={styles.treeActions}>
                <Button
                  variant="text"
                  icon="keyboard_arrow_up"
                  aria-label="Move block up"
                  disabled={selectedNode.id === rootNode.id}
                  onClick={() => {
                    updateActiveRoot(moveNodeInParent(rootNode, selectedNode.id, -1));
                  }}
                >
                  Up
                </Button>
                <Button
                  variant="text"
                  icon="keyboard_arrow_down"
                  aria-label="Move block down"
                  disabled={selectedNode.id === rootNode.id}
                  onClick={() => {
                    updateActiveRoot(moveNodeInParent(rootNode, selectedNode.id, 1));
                  }}
                >
                  Down
                </Button>
                <Button
                  variant="text"
                  icon="delete"
                  aria-label="Delete block"
                  disabled={selectedNode.id === rootNode.id}
                  onClick={() => {
                    const nextRoot = deleteNodeById(rootNode, selectedNode.id);
                    updateActiveRoot(nextRoot);
                    setSelectedId(nextRoot.id);
                  }}
                >
                  Remove
                </Button>
              </div>
            </div>

            <div>
              <h3 className={styles.sectionTitle}>Add block</h3>
              <div className={styles.paletteGrid}>
                {PALETTE_ITEMS.map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    className={styles.paletteBtn}
                    onClick={() => {
                      handleAddBlock(item.type);
                    }}
                  >
                    <Icon
                      name={item.icon in ICONS ? (item.icon as IconName) : "widgets"}
                      size={15}
                    />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          {/* Center pane: Live canvas, Supported sizes, Named bindings */}
          <main className={styles.centerPane} aria-label="Live canvas">
            <div className={styles.sizeBar}>
              <span className={styles.sectionTitle} style={{ margin: "0 6px 0 0" }}>
                Preview size:
              </span>
              {pkg.sizes.map((sz) => (
                <button
                  key={sz}
                  type="button"
                  className={`${styles.sizePill} ${previewSize === sz ? styles.sizePillActive : ""}`}
                  onClick={() => {
                    setPreviewSize(sz);
                  }}
                >
                  {sz}
                </button>
              ))}
            </div>

            <div className={styles.canvasStage}>
              <div
                className={styles.previewCard}
                style={{ width: cardW, height: cardH }}
                aria-label={generateAccessibleName(pkg)}
              >
                {runtime ? (
                  <CompositionView
                    runtime={runtime}
                    size={previewSize}
                    animate={false}
                    services={services}
                  />
                ) : (
                  <div className={styles.evalErr} style={{ margin: 12 }}>
                    {compileError}
                  </div>
                )}
              </div>
            </div>

            <div className={styles.fieldGroup}>
              <h3 className={styles.sectionTitle}>Supported sizes &amp; accessibility</h3>
              <div className={styles.sizeBar}>
                {BUILDER_SIZES.map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    aria-pressed={pkg.sizes.includes(sz)}
                    className={`${styles.sizePill} ${pkg.sizes.includes(sz) ? styles.sizePillActive : ""}`}
                    onClick={() => {
                      toggleSupportedSize(sz);
                    }}
                  >
                    {sz}
                  </button>
                ))}
              </div>
              <label className={styles.fieldLabel}>
                Accessible name (auto-generated when empty: &ldquo;{generateAccessibleName(pkg)}
                &rdquo;)
                <input
                  type="text"
                  aria-label="Accessible name"
                  className={styles.input}
                  placeholder={generateAccessibleName(pkg)}
                  value={pkg.accessibleName ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPkg((p) => {
                      if (!val) {
                        const copy = { ...p };
                        delete copy.accessibleName;
                        return copy;
                      }
                      return { ...p, accessibleName: val };
                    });
                  }}
                />
              </label>
            </div>

            <div className={styles.fieldGroup}>
              <h3 className={styles.sectionTitle}>Shared bindings (bind.&lt;name&gt;)</h3>
              {Object.entries(bindings).map(([bName, bExpr]) => (
                <div key={bName} className={styles.bindingRow}>
                  <input
                    type="text"
                    readOnly
                    className={`${styles.input} ${styles.monoInput}`}
                    value={bName}
                  />
                  <ExprInput
                    label={`Binding ${bName}`}
                    value={bExpr}
                    mode="expression"
                    env={exprEnv}
                    onChange={(next) => {
                      setPkg((prev) => ({
                        ...prev,
                        composition: {
                          ...prev.composition,
                          bindings: { ...(prev.composition.bindings ?? {}), [bName]: next },
                        },
                      }));
                    }}
                  />
                  <Button
                    variant="text"
                    icon="delete"
                    aria-label={`Remove binding ${bName}`}
                    onClick={() => {
                      setPkg((prev) => {
                        const nextB = { ...(prev.composition.bindings ?? {}) };
                        Reflect.deleteProperty(nextB, bName);
                        return { ...prev, composition: { ...prev.composition, bindings: nextB } };
                      });
                    }}
                  >
                    Del
                  </Button>
                </div>
              ))}
              <div className={styles.bindingRow}>
                <input
                  type="text"
                  aria-label="New binding name"
                  placeholder="name"
                  className={`${styles.input} ${styles.monoInput}`}
                  value={newBindName}
                  onChange={(e) => {
                    setNewBindName(e.target.value);
                  }}
                />
                <input
                  type="text"
                  aria-label="New binding expression"
                  placeholder="e.g. source.my_api.count ?? 0"
                  className={`${styles.input} ${styles.monoInput}`}
                  value={newBindExpr}
                  onChange={(e) => {
                    setNewBindExpr(e.target.value);
                  }}
                />
                <Button
                  variant="tonal"
                  icon="add"
                  onClick={() => {
                    const clean = newBindName.trim();
                    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(clean) || !newBindExpr.trim()) return;
                    setPkg((prev) => ({
                      ...prev,
                      composition: {
                        ...prev.composition,
                        bindings: {
                          ...(prev.composition.bindings ?? {}),
                          [clean]: newBindExpr.trim(),
                        },
                      },
                    }));
                    setNewBindName("");
                    setNewBindExpr("");
                  }}
                >
                  Add
                </Button>
              </div>
            </div>
          </main>

          {/* Right pane: Selected block properties & live binding editor */}
          <aside className={styles.pane} aria-label="Block properties">
            <h3 className={styles.sectionTitle}>
              Block: {selectedNode.id} ({selectedNode.type})
            </h3>

            <label className={styles.fieldLabel}>
              Role
              <select
                aria-label="Block role"
                className={styles.select}
                value={selectedNode.role ?? ""}
                onChange={(e) => {
                  const v = e.target.value as Role | "";
                  updateSelected((n) => {
                    if (!v) {
                      const copy = { ...n };
                      delete copy.role;
                      return copy;
                    }
                    return { ...n, role: v };
                  });
                }}
              >
                <option value="">(None)</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>

            {selectedNode.type === "text" ? (
              <ExprInput
                label="Text template"
                value={selectedNode.text}
                mode="template"
                env={exprEnv}
                placeholder="{cpu.load | round}%"
                onChange={(next) => {
                  updateSelected((n) => (n.type === "text" ? { ...n, text: next } : n));
                }}
              />
            ) : null}

            {selectedNode.type === "number" ? (
              <>
                <ExprInput
                  label="Value expression"
                  value={selectedNode.value}
                  mode="expression"
                  env={exprEnv}
                  onChange={(next) => {
                    updateSelected((n) => (n.type === "number" ? { ...n, value: next } : n));
                  }}
                />
                <ExprInput
                  label="Unit template"
                  value={selectedNode.unit ?? ""}
                  mode="template"
                  env={exprEnv}
                  placeholder="%"
                  onChange={(next) => {
                    updateSelected((n) => {
                      if (n.type !== "number") return n;
                      if (!next) {
                        const copy = { ...n };
                        delete copy.unit;
                        return copy;
                      }
                      return { ...n, unit: next };
                    });
                  }}
                />
              </>
            ) : null}

            {selectedNode.type === "icon" ? (
              <ExprInput
                label="Icon name template"
                value={selectedNode.icon}
                mode="template"
                env={exprEnv}
                placeholder="star"
                onChange={(next) => {
                  updateSelected((n) => (n.type === "icon" ? { ...n, icon: next } : n));
                }}
              />
            ) : null}

            {selectedNode.type === "shape" ? (
              <ExprInput
                label="Shape name template"
                value={selectedNode.shape}
                mode="template"
                env={exprEnv}
                placeholder="pill"
                onChange={(next) => {
                  updateSelected((n) => (n.type === "shape" ? { ...n, shape: next } : n));
                }}
              />
            ) : null}

            {selectedNode.type === "ring" ||
            selectedNode.type === "bar" ||
            selectedNode.type === "progress" ? (
              <ExprInput
                label="Progress value (0..1)"
                value={selectedNode.value}
                mode="expression"
                env={exprEnv}
                onChange={(next) => {
                  updateSelected((n) =>
                    n.type === "ring" || n.type === "bar" || n.type === "progress"
                      ? { ...n, value: next }
                      : n,
                  );
                }}
              />
            ) : null}

            {selectedNode.type === "chart" ? (
              <ExprInput
                label="Values expression"
                value={selectedNode.values ?? ""}
                mode="expression"
                env={exprEnv}
                onChange={(next) => {
                  updateSelected((n) => (n.type === "chart" ? { ...n, values: next } : n));
                }}
              />
            ) : null}

            {selectedNode.type === "list" ? (
              <ExprInput
                label="Items expression"
                value={selectedNode.items}
                mode="expression"
                env={exprEnv}
                onChange={(next) => {
                  updateSelected((n) => (n.type === "list" ? { ...n, items: next } : n));
                }}
              />
            ) : null}

            {isContainerNode(selectedNode) ? (
              <>
                <label className={styles.fieldLabel}>
                  Gap (0–8)
                  <input
                    type="number"
                    min={0}
                    max={8}
                    className={styles.input}
                    value={selectedNode.gap ?? 0}
                    onChange={(e) => {
                      const v = Math.max(0, Math.min(8, Math.round(Number(e.target.value))));
                      updateSelected((n) => (isContainerNode(n) ? { ...n, gap: v } : n));
                    }}
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Padding (0–8)
                  <input
                    type="number"
                    min={0}
                    max={8}
                    className={styles.input}
                    value={selectedNode.padding ?? 0}
                    onChange={(e) => {
                      const v = Math.max(0, Math.min(8, Math.round(Number(e.target.value))));
                      updateSelected((n) => (isContainerNode(n) ? { ...n, padding: v } : n));
                    }}
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Align
                  <select
                    className={styles.select}
                    value={selectedNode.align ?? "stretch"}
                    onChange={(e) => {
                      const v = e.target.value as Align;
                      updateSelected((n) => (isContainerNode(n) ? { ...n, align: v } : n));
                    }}
                  >
                    <option value="start">Start</option>
                    <option value="center">Center</option>
                    <option value="end">End</option>
                    <option value="stretch">Stretch</option>
                    <option value="baseline">Baseline</option>
                  </select>
                </label>
                <label className={styles.fieldLabel}>
                  Justify
                  <select
                    className={styles.select}
                    value={selectedNode.justify ?? "start"}
                    onChange={(e) => {
                      const v = e.target.value as Justify;
                      updateSelected((n) => (isContainerNode(n) ? { ...n, justify: v } : n));
                    }}
                  >
                    <option value="start">Start</option>
                    <option value="center">Center</option>
                    <option value="end">End</option>
                    <option value="between">Space between</option>
                    <option value="around">Space around</option>
                    <option value="evenly">Space evenly</option>
                  </select>
                </label>
                {selectedNode.type === "grid" ? (
                  <label className={styles.fieldLabel}>
                    Columns (1–12)
                    <input
                      type="number"
                      min={1}
                      max={12}
                      className={styles.input}
                      value={selectedNode.columns}
                      onChange={(e) => {
                        const v = Math.max(1, Math.min(12, Math.round(Number(e.target.value))));
                        updateSelected((n) => (n.type === "grid" ? { ...n, columns: v } : n));
                      }}
                    />
                  </label>
                ) : null}
              </>
            ) : null}

            <ExprInput
              label="Visible when (expression)"
              value={selectedNode.visible ?? ""}
              mode="expression"
              env={exprEnv}
              placeholder="true"
              onChange={(next) => {
                updateSelected((n) => {
                  if (!next.trim()) {
                    const copy = { ...n };
                    delete copy.visible;
                    return copy;
                  }
                  return { ...n, visible: next };
                });
              }}
            />

            <ExprInput
              label="Block accessible label"
              value={selectedNode.label ?? ""}
              mode="template"
              env={exprEnv}
              placeholder="Optional screen-reader label"
              onChange={(next) => {
                updateSelected((n) => {
                  if (!next.trim()) {
                    const copy = { ...n };
                    delete copy.label;
                    return copy;
                  }
                  return { ...n, label: next };
                });
              }}
            />

            <div>
              <h3 className={styles.sectionTitle}>Available topics &amp; sources</h3>
              <div className={styles.topicChips}>
                {availableTopicNames.map((topic) => (
                  <button
                    key={topic}
                    type="button"
                    className={styles.topicChip}
                    title={`Bind ${topic}`}
                    onClick={() => {
                      if (selectedNode.type === "text") {
                        updateSelected((n) =>
                          n.type === "text" ? { ...n, text: `{${topic}}` } : n,
                        );
                      } else if (selectedNode.type === "number") {
                        updateSelected((n) =>
                          n.type === "number" ? { ...n, value: `${topic} ?? 0` } : n,
                        );
                      }
                    }}
                  >
                    {topic}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

export default WidgetBuilder;
