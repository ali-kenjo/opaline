// Widget Gallery (PLAN-2 5.5, brief §6.3 — replaces WidgetPicker):
// Large live previews with real data at every size, Android-style swipe/arrows between sizes
// alongside a macOS-style size row, search, 2.0 categories, "Your widgets" / "From themes &
// plugins" sources, hardware availability reasons, click-to-place and drag-to-place.
import { useMemo, useState } from "react";
import { Button, Sheet } from "../design-system/components";
import { Icon } from "../design-system/icons";
import { type SizeClass, sizes, spanPx } from "../design-system/tokens/tokens";
import { resolveContent } from "../widgets/content";
import {
  type CustomWidgetPackage,
  customPackageByKind,
  useCustomWidgets,
} from "../widgets/customWidgets";
import { useHost } from "../widgets/host";
import { WIDGETS } from "../widgets/registry";
import type { WidgetDef } from "../widgets/types";
import { WidgetFrame } from "../widgets/WidgetFrame";
import { useLayer } from "./store";
import styles from "./WidgetGallery.module.css";

type GallerySource = "all" | "yours" | "themes-plugins";
type GalleryCategory =
  | "all"
  | "system"
  | "controls"
  | "time-personal"
  | "media-photos"
  | "weather-ambient"
  | "developer-online"
  | "custom"
  | "community";

const CATEGORIES: readonly { id: GalleryCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "system", label: "System" },
  { id: "controls", label: "Controls" },
  { id: "time-personal", label: "Time & Personal" },
  { id: "media-photos", label: "Media & Photos" },
  { id: "weather-ambient", label: "Weather & Ambient" },
  { id: "developer-online", label: "Developer & Online" },
  { id: "custom", label: "Custom" },
  { id: "community", label: "Community" },
];

function categoryOf(def: WidgetDef): GalleryCategory {
  if (def.kind === "controls") return "controls";
  if (
    def.kind === "docker" ||
    def.kind === "processes" ||
    def.kind === "github" ||
    def.kind === "home-assistant" ||
    def.kind === "mqtt" ||
    def.kind === "feeds" ||
    def.kind === "n8n"
  ) {
    return "developer-online";
  }
  if (
    def.kind === "weather" ||
    def.kind === "sun-moon" ||
    def.kind === "aura" ||
    def.kind === "quote" ||
    def.kind === "decoration"
  ) {
    return "weather-ambient";
  }
  if (
    def.kind === "clock" ||
    def.kind === "calendar" ||
    def.kind === "notes" ||
    def.kind === "todo" ||
    def.kind === "timers" ||
    def.kind === "countdown" ||
    def.kind === "world-clock"
  ) {
    return "time-personal";
  }
  if (def.kind === "media" || def.kind === "visualizer" || def.kind === "photo-frame") {
    return "media-photos";
  }
  return "system";
}

export interface WidgetGalleryProps {
  open: boolean;
  onClose: () => void;
  onAdd: (kind: string, size: SizeClass) => void;
  onDragStart: (kind: string, size: SizeClass, clientX: number, clientY: number) => void;
  onOpenBuilder?: (pkg: CustomWidgetPackage | null) => void;
}

export function WidgetGallery({
  open,
  onClose,
  onAdd,
  onDragStart,
  onOpenBuilder,
}: WidgetGalleryProps) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<GallerySource>("all");
  const [cat, setCat] = useState<GalleryCategory>("all");
  const [pickedSizes, setPickedSizes] = useState<Record<string, SizeClass>>({});
  const values = useLayer((s) => s.values);
  const customDefs = useCustomWidgets((s) => s.defs);
  const host = useHost();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const customList = Object.values(customDefs);
    if (source === "themes-plugins") return [];
    const pool: readonly WidgetDef[] =
      source === "yours" ? customList : cat === "custom" ? customList : [...WIDGETS, ...customList];
    return pool.filter((def) => {
      const defCat: GalleryCategory = def.kind.startsWith("custom.") ? "custom" : categoryOf(def);
      if (source !== "yours" && cat !== "all" && defCat !== cat) return false;
      if (!q) return true;
      return (
        def.name.toLowerCase().includes(q) ||
        def.kind.toLowerCase().includes(q) ||
        defCat.includes(q)
      );
    });
  }, [query, cat, source, customDefs]);

  const sizeFor = (def: WidgetDef): SizeClass => pickedSizes[def.kind] ?? def.defaultSize;

  const stepSize = (def: WidgetDef, delta: number) => {
    const cur = sizeFor(def);
    const idx = Math.max(0, def.sizes.indexOf(cur));
    const next = def.sizes[(idx + delta + def.sizes.length) % def.sizes.length];
    if (next) setPickedSizes((prev) => ({ ...prev, [def.kind]: next }));
  };

  return (
    <Sheet open={open} onClose={onClose} label="Add widget">
      <div className={styles.gallery}>
        <div className={styles.top}>
          <div className={styles.searchWrap}>
            <Icon name="search" size={18} />
            <input
              type="search"
              role="searchbox"
              className={styles.search}
              placeholder="Search Widget Gallery"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
            />
          </div>
          <div className={styles.sourceRow} role="group" aria-label="Widget sources">
            {(
              [
                { id: "all", label: "Built-in" },
                { id: "yours", label: "Your widgets" },
                { id: "themes-plugins", label: "From themes & plugins" },
              ] as const
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                className={`${styles.sourceBtn} ${source === s.id ? styles.sourceActive : ""}`}
                onClick={() => {
                  setSource(s.id);
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          {onOpenBuilder ? (
            <Button
              variant="tonal"
              icon="add"
              onClick={() => {
                onClose();
                onOpenBuilder(null);
              }}
            >
              Widget Builder
            </Button>
          ) : null}
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
                setSource("all");
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        {open ? (
          filtered.length > 0 ? (
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
                const scale = Math.min(1, 260 / pxW, 168 / pxH);

                return (
                  <div key={def.kind} className={styles.card}>
                    <div className={styles.cardTop}>
                      <div className={styles.cardTitle}>
                        <Icon name={def.icon} size={18} />
                        <span>{def.name}</span>
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        {onOpenBuilder && def.kind.startsWith("custom.") ? (
                          <Button
                            variant="text"
                            icon="edit"
                            aria-label={`Edit ${def.name}`}
                            onClick={() => {
                              const pkg = customPackageByKind(def.kind);
                              if (pkg) {
                                onClose();
                                onOpenBuilder(pkg);
                              }
                            }}
                          >
                            Edit
                          </Button>
                        ) : null}
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
                    </div>

                    <div className={styles.stageRow}>
                      {def.sizes.length > 1 ? (
                        <button
                          type="button"
                          className={styles.swipeBtn}
                          aria-label={`Previous size for ${def.name}`}
                          onClick={() => {
                            stepSize(def, -1);
                          }}
                        >
                          <Icon name="keyboard_arrow_left" size={18} />
                        </button>
                      ) : null}

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
                          } else if (e.key === "ArrowLeft") {
                            e.preventDefault();
                            stepSize(def, -1);
                          } else if (e.key === "ArrowRight") {
                            e.preventDefault();
                            stepSize(def, 1);
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
                          style={{ width: pxW * scale, height: pxH * scale }}
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

                      {def.sizes.length > 1 ? (
                        <button
                          type="button"
                          className={styles.swipeBtn}
                          aria-label={`Next size for ${def.name}`}
                          onClick={() => {
                            stepSize(def, 1);
                          }}
                        >
                          <Icon name="keyboard_arrow_right" size={18} />
                        </button>
                      ) : null}
                    </div>

                    {unavailable ? <div className={styles.reason}>{unavailable}</div> : null}

                    <div className={styles.sizeRow} aria-label={`${def.name} sizes`}>
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
          ) : (
            <div className={styles.empty}>
              {source === "yours" ? (
                <>
                  <p>No custom widgets yet. Create one in the Widget Builder.</p>
                  {onOpenBuilder ? (
                    <Button
                      variant="filled"
                      icon="add"
                      onClick={() => {
                        onClose();
                        onOpenBuilder(null);
                      }}
                    >
                      Open Widget Builder
                    </Button>
                  ) : null}
                </>
              ) : source === "themes-plugins" ? (
                "Widgets shipped by installed theme packages and plugins appear here."
              ) : (
                "No widgets match this filter yet."
              )}
            </div>
          )
        ) : null}
      </div>
    </Sheet>
  );
}
