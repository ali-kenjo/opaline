// The widgets and stacks of one monitor, placed on the grid, with their Edit mode badges and
// resize handles (split out of LayerApp.tsx).
import { useGlassSync } from "../design-system/glass";
import { Icon } from "../design-system/icons";
import { spanPx } from "../design-system/tokens/tokens";
import type { StoredSettings } from "../widgets/host";
import { widgetByKind } from "../widgets/registry";
import { WidgetFrame } from "../widgets/WidgetFrame";
import type { DragState, ResizeEdge, ResizeState } from "./editTypes";
import { type GridMetrics, type LayoutItem, cellToPx, sizeClassForSpan } from "./grid";
import { allowedSizesOf } from "./layoutRules";
import { SpringSlot } from "./SpringSlot";
import { StackWidget } from "./StackWidget";
import styles from "./LayerApp.module.css";

interface GridItemsProps {
  items: readonly LayoutItem[];
  g: GridMetrics;
  edit: boolean;
  selectedId: string | null;
  drag: DragState | null;
  resize: ResizeState | null;
  autoDimmed: boolean;
  widgets: StoredSettings["widgets"];
  onHover: (hovered: boolean) => void;
  onPointerDownItem: (item: LayoutItem, e: React.PointerEvent<HTMLDivElement>) => void;
  onClickItem: (item: LayoutItem, e: React.MouseEvent<HTMLDivElement>) => void;
  onContextItem: (item: LayoutItem, e: React.MouseEvent<HTMLDivElement>) => void;
  onStartResize: (
    item: LayoutItem,
    edge: ResizeEdge,
    e: React.PointerEvent<HTMLButtonElement>,
  ) => void;
  onRemoveItem: (item: LayoutItem) => void;
  onOpenSettings: (widgetId: string) => void;
  onEditStack: (stackId: string) => void;
  onStackActive: (stackId: string, idx: number) => void;
  contentDir: "ltr" | "rtl";
}

export function GridItems({
  items,
  g,
  edit,
  selectedId,
  drag,
  resize,
  autoDimmed,
  widgets,
  onHover,
  onPointerDownItem,
  onClickItem,
  onContextItem,
  onStartResize,
  onRemoveItem,
  onOpenSettings,
  onEditStack,
  onStackActive,
  contentDir,
}: GridItemsProps) {
  const syncGlass = useGlassSync();

  return (
    <>
      {items.map((item) => {
        const isDragging = drag?.item.id === item.id;
        const isResizing = resize?.item.id === item.id;
        const rect = isDragging
          ? {
              x: drag.pointerX - drag.grabX,
              y: drag.pointerY - drag.grabY,
              width: spanPx(item.w),
              height: spanPx(item.h),
            }
          : cellToPx(g, item.x, item.y, item.w, item.h);
        const size = sizeClassForSpan(item.w, item.h);
        const isSelected = edit && selectedId === item.id;
        const isStackTarget = drag?.stackTarget?.id === item.id;
        const canResize = allowedSizesOf(item, widgets).length > 1;

        const body =
          item.type === "stack" ? (
            <StackWidget
              item={item}
              size={size}
              autoDimmed={autoDimmed}
              lifted={isDragging}
              editMode={edit}
              onActiveChange={(idx) => {
                onStackActive(item.id, idx);
              }}
              onOpenSettings={onOpenSettings}
            />
          ) : (
            (() => {
              const def = widgetByKind(item.kind);
              return def ? (
                <WidgetFrame
                  id={item.id}
                  def={def}
                  size={size}
                  autoDimmed={autoDimmed}
                  lifted={isDragging}
                  onOpenSettings={() => {
                    onOpenSettings(item.id);
                  }}
                />
              ) : null;
            })()
          );

        if (!body) return null;

        return (
          <SpringSlot
            key={item.id}
            x={rect.x}
            y={rect.y}
            dragging={isDragging || isResizing}
            onTick={syncGlass}
            dataItemId={item.id}
            dir={contentDir}
            tabIndex={edit ? 0 : undefined}
            ariaLabel={
              item.type === "stack" ? `Stack of ${String(item.children.length)} widgets` : item.kind
            }
            className={`${styles.widget} ${edit ? styles.widgetEdit : ""} ${isDragging ? styles.widgetDragging : ""} ${isSelected ? styles.widgetSelected : ""} ${isStackTarget ? styles.stackHighlight : ""}`}
            onPointerEnter={() => {
              onHover(true);
            }}
            onPointerLeave={() => {
              onHover(false);
            }}
            onPointerDown={(e) => {
              onPointerDownItem(item, e);
            }}
            onClick={(e) => {
              onClickItem(item, e);
            }}
            onContextMenu={(e) => {
              onContextItem(item, e);
            }}
          >
            {body}
            {edit && !isDragging ? (
              <>
                <button
                  type="button"
                  className={styles.removeBadge}
                  aria-label="Remove widget"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveItem(item);
                  }}
                >
                  <Icon name="remove" size={16} />
                </button>
                <button
                  type="button"
                  className={styles.settingsBadge}
                  aria-label="Customize widget"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (item.type === "stack") onEditStack(item.id);
                    else onOpenSettings(item.id);
                  }}
                >
                  <Icon name="tune" size={15} />
                </button>
              </>
            ) : null}
            {edit && item.type === "stack" && !isDragging ? (
              <button
                type="button"
                className={styles.stackBadge}
                aria-label="Edit stack"
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onEditStack(item.id);
                }}
              >
                <Icon name="stacks" size={14} />
                {item.children.length}
              </button>
            ) : null}
            {isSelected && canResize && !isDragging ? (
              <>
                <button
                  type="button"
                  className={`${styles.handle} ${styles.handleN}`}
                  aria-label="Resize top"
                  onPointerDown={(e) => {
                    onStartResize(item, "n", e);
                  }}
                />
                <button
                  type="button"
                  className={`${styles.handle} ${styles.handleS}`}
                  aria-label="Resize bottom"
                  onPointerDown={(e) => {
                    onStartResize(item, "s", e);
                  }}
                />
                <button
                  type="button"
                  className={`${styles.handle} ${styles.handleW}`}
                  aria-label="Resize left"
                  onPointerDown={(e) => {
                    onStartResize(item, "w", e);
                  }}
                />
                <button
                  type="button"
                  className={`${styles.handle} ${styles.handleE}`}
                  aria-label="Resize right"
                  onPointerDown={(e) => {
                    onStartResize(item, "e", e);
                  }}
                />
              </>
            ) : null}
          </SpringSlot>
        );
      })}
    </>
  );
}
