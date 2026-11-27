// The widgets and stacks of one monitor, placed on the grid or in Free mode, with their Edit
// mode badges, multi-select outlines, lock indicator, z-order, and resize handles.
import { useGlassSync } from "../design-system/glass";
import { Icon } from "../design-system/icons";
import { grid as gridTokens } from "../design-system/tokens/tokens";
import type { StoredSettings } from "../widgets/host";
import { widgetByKind } from "../widgets/registry";
import { WidgetFrame } from "../widgets/WidgetFrame";
import type { DragState, ResizeEdge, ResizeState } from "./editTypes";
import { itemRectPx, sizeClassForPx } from "./free";
import { type GridMetrics, type LayoutItem, type LayoutMode, sizeClassForSpan } from "./grid";
import { allowedSizesOf } from "./layoutRules";
import { SpringSlot } from "./SpringSlot";
import { StackWidget } from "./StackWidget";
import styles from "./LayerApp.module.css";

interface GridItemsProps {
  items: readonly LayoutItem[];
  mode: LayoutMode;
  g: GridMetrics;
  workW: number;
  workH: number;
  edit: boolean;
  selectedIds: ReadonlySet<string>;
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
  mode,
  g,
  workW,
  workH,
  edit,
  selectedIds,
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
      {items.map((item, idx) => {
        const isDragging = drag?.movingIds.includes(item.id) ?? false;
        const isPrimaryDrag = drag?.item.id === item.id;
        const isResizing = resize?.item.id === item.id;
        const baseRect = itemRectPx(item, mode, g, workW, workH);
        const rect = isPrimaryDrag
          ? {
              x: drag.pointerX - drag.grabX,
              y: drag.pointerY - drag.grabY,
              width: baseRect.width,
              height: baseRect.height,
            }
          : isDragging && drag
            ? {
                x: baseRect.x + (drag.pointerX - drag.startX),
                y: baseRect.y + (drag.pointerY - drag.startY),
                width: baseRect.width,
                height: baseRect.height,
              }
            : isResizing && resize.mode === "free" && resize.freeRect
              ? resize.freeRect
              : baseRect;

        const size =
          mode === "free"
            ? sizeClassForPx(rect.width, rect.height, g.cell)
            : sizeClassForSpan(item.w, item.h);
        const customSize = mode === "free" || g.cell !== gridTokens.cell;
        const isSelected = edit && selectedIds.has(item.id);
        const showHandles = isSelected && selectedIds.size === 1 && !item.locked;
        const isStackTarget = drag?.stackTarget?.id === item.id;
        const canResize = mode === "free" || allowedSizesOf(item, widgets).length > 1;
        const zIndex = mode === "free" ? (item.z ?? idx + 1) : undefined;

        const body =
          item.type === "stack" ? (
            <StackWidget
              item={item}
              size={size}
              widthPx={customSize ? rect.width : undefined}
              heightPx={customSize ? rect.height : undefined}
              autoDimmed={autoDimmed}
              lifted={isDragging}
              editMode={edit}
              onActiveChange={(activeIdx) => {
                onStackActive(item.id, activeIdx);
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
                  widthPx={customSize ? rect.width : undefined}
                  heightPx={customSize ? rect.height : undefined}
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
            zIndex={zIndex}
            onTick={syncGlass}
            dataItemId={item.id}
            dir={contentDir}
            tabIndex={edit ? 0 : undefined}
            ariaLabel={
              item.type === "stack" ? `Stack of ${String(item.children.length)} widgets` : item.kind
            }
            className={`${styles.widget} ${edit ? styles.widgetEdit : ""} ${item.locked && edit ? styles.widgetLocked : ""} ${isDragging ? styles.widgetDragging : ""} ${isSelected ? styles.widgetSelected : ""} ${isStackTarget ? styles.stackHighlight : ""}`}
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
                {!item.locked ? (
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
                ) : (
                  <span className={styles.lockBadge} title="Locked" aria-label="Locked widget">
                    <Icon name="lock" size={14} />
                  </span>
                )}
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
            {showHandles && canResize && !isDragging ? (
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
