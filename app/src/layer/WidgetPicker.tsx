// Widget picker bottom sheet (brief §2.3, PLAN 5.7): search, categories, live previews rendered
// with real data at each supported size, hardware availability reasons, click-to-place and
// drag-to-place onto the grid.
import { useMemo, useState } from "react";
import { Button, Sheet } from "../design-system/components";
import { Icon } from "../design-system/icons";
import { type SizeClass, sizes, spanPx } from "../design-system/tokens/tokens";
import { resolveContent } from "../widgets/content";
import { useHost } from "../widgets/host";
import { WIDGETS } from "../widgets/registry";
import type { WidgetDef } from "../widgets/types";
import { WidgetFrame } from "../widgets/WidgetFrame";
import { useLayer } from "./store";
import styles from "./WidgetPicker.module.css";

type PickerCategory = "all" | "system" | "media" | "time" | "info" | "developer";

const CATEGORIES: readonly { id: PickerCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "system", label: "System" },
  { id: "media", label: "Media" },
  { id: "time", label: "Time" },
  { id: "info", label: "Info" },
  { id: "developer", label: "Developer" },
];

function categoryOf(def: WidgetDef): PickerCategory {
  if (def.kind === "docker" || def.kind === "processes") return "developer";
  if (def.category === "network") return "system";
  return def.category;
}

export interface WidgetPickerProps {
  open: boolean;
  onClose: () => void;
  onAdd: (kind: string, size: SizeClass) => void;
  onDragStart: (kind: string, size: SizeClass, clientX: number, clientY: number) => void;
}

export function WidgetPicker({ open, onClose, onAdd, onDragStart }: WidgetPickerProps) {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<PickerCategory>("all");
  const [pickedSizes, setPickedSizes] = useState<Record<string, SizeClass>>({});
  const values = useLayer((s) => s.values);
  const host = useHost();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return WIDGETS.filter((def) => {
      if (cat !== "all" && categoryOf(def) !== cat) return false;
      if (!q) return true;
      return def.name.toLowerCase().includes(q) || def.kind.toLowerCase().includes(q);
    });
  }, [query, cat]);

  const sizeFor = (def: WidgetDef): SizeClass => pickedSizes[def.kind] ?? def.defaultSize;

  return (
    <Sheet open={open} onClose={onClose} label="Add widget">
      <div className={styles.picker}>
        <div className={styles.top}>
          <div className={styles.searchWrap}>
            <Icon name="search" size={18} />
            <input
              type="search"
              role="searchbox"
              className={styles.search}
              placeholder="Search widgets"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
            />
          </div>
          <Button variant="text" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className={styles.cats} role="tablist" aria-label="Widget categories">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={cat === c.id}
              className={`${styles.cat} ${cat === c.id ? styles.catActive : ""}`}
              onClick={() => {
                setCat(c.id);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        {open ? (
          <div className={styles.grid}>
            {filtered.map((def) => {
              const size = sizeFor(def);
              const content = resolveContent(
                def,
                host.settings.widgets[`preview-${def.kind}`]?.content,
              );
              const status = def.status({ get: (t) => values[t], content });
              const unavailable =
                status.kind === "unavailable" || status.kind === "needs-permission"
                  ? status.reason
                  : null;
              const { w, h } = sizes[size];
              const pxW = spanPx(w);
              const pxH = spanPx(h);
              const scale = Math.min(1, 240 / pxW, 148 / pxH);

              return (
                <div key={def.kind} className={styles.card}>
                  <div className={styles.cardTop}>
                    <div className={styles.cardTitle}>
                      <Icon name={def.icon} size={18} />
                      <span>{def.name}</span>
                    </div>
                    <Button
                      variant="tonal"
                      icon="add"
                      onClick={() => {
                        onAdd(def.kind, size);
                      }}
                    >
                      Add
                    </Button>
                  </div>

                  <div
                    className={styles.previewBox}
                    role="button"
                    tabIndex={0}
                    aria-label={`Add ${def.name} (${size})`}
                    onClick={() => {
                      onAdd(def.kind, size);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onAdd(def.kind, size);
                      }
                    }}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      const startX = e.clientX;
                      const startY = e.clientY;
                      const move = (ev: PointerEvent) => {
                        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 12) {
                          cleanup();
                          onDragStart(def.kind, size, ev.clientX, ev.clientY);
                        }
                      };
                      const cleanup = () => {
                        window.removeEventListener("pointermove", move);
                        window.removeEventListener("pointerup", cleanup);
                        window.removeEventListener("pointercancel", cleanup);
                      };
                      window.addEventListener("pointermove", move);
                      window.addEventListener("pointerup", cleanup);
                      window.addEventListener("pointercancel", cleanup);
                    }}
                  >
                    <div
                      className={styles.previewScaled}
                      style={{
                        width: pxW * scale,
                        height: pxH * scale,
                      }}
                    >
                      <div
                        style={{
                          transform: `scale(${String(scale)})`,
                          transformOrigin: "top left",
                          pointerEvents: "none",
                        }}
                      >
                        <WidgetFrame id={`preview-${def.kind}`} def={def} size={size} />
                      </div>
                    </div>
                  </div>

                  {unavailable ? <div className={styles.reason}>{unavailable}</div> : null}

                  <div className={styles.sizeRow}>
                    {def.sizes.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`${styles.sizePill} ${s === size ? styles.sizeActive : ""}`}
                        onClick={() => {
                          setPickedSizes((prev) => ({ ...prev, [def.kind]: s }));
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
