// The stack editor sheet wired to the layout: reorder, remove, unstack, Smart Rotate
// (split out of LayerApp.tsx).
import type { StoredSettings } from "../widgets/host";
import { type GridMetrics, type LayoutItem, type StackLayoutItem, findNearestFree } from "./grid";
import { StackEditor } from "./StackWidget";

export interface LayerStackEditorProps {
  stack: StackLayoutItem;
  items: LayoutItem[];
  widgets: StoredSettings["widgets"];
  g: GridMetrics;
  onCommit: (items: LayoutItem[]) => void;
  onRemoveItem: (item: LayoutItem) => void;
  onClose: () => void;
  onOpenWidgetSettings: (widgetId: string) => void;
}

export function LayerStackEditor({
  stack,
  items,
  widgets,
  g,
  onCommit,
  onRemoveItem,
  onClose,
  onOpenWidgetSettings,
}: LayerStackEditorProps) {
  return (
    <StackEditor
      stack={stack}
      open
      onClose={() => {
        onClose();
      }}
      onReorder={(children) => {
        onCommit(
          items.map((it) => (it.type === "stack" && it.id === stack.id ? { ...it, children } : it)),
        );
      }}
      onRemoveChild={(childId) => {
        const remaining = stack.children.filter((c) => c !== childId);
        if (remaining.length === 0) {
          onRemoveItem(stack);
          onClose();
        } else if (remaining.length === 1 && remaining[0]) {
          const lone = remaining[0];
          const kind = widgets[lone]?.kind ?? "cpu";
          onCommit(
            items.map((it) =>
              it.type === "stack" && it.id === stack.id
                ? { id: lone, type: "widget", kind, x: it.x, y: it.y, w: it.w, h: it.h }
                : it,
            ),
          );
          onClose();
        } else {
          onCommit(
            items.map((it) =>
              it.type === "stack" && it.id === stack.id
                ? { ...it, children: remaining, activeIndex: 0 }
                : it,
            ),
          );
        }
      }}
      onUnstackChild={(childId) => {
        const remaining = stack.children.filter((c) => c !== childId);
        const kind = widgets[childId]?.kind ?? "cpu";
        const slot = findNearestFree(items, g.cols, g.rows, stack.w, stack.h, stack.x, stack.y);
        if (!slot) return;
        const extracted: LayoutItem = {
          id: childId,
          type: "widget",
          kind,
          x: slot.x,
          y: slot.y,
          w: stack.w,
          h: stack.h,
        };
        const updated = items
          .map((it): LayoutItem | null => {
            if (it.type !== "stack" || it.id !== stack.id) return it;
            if (remaining.length === 0) return null;
            if (remaining.length === 1 && remaining[0]) {
              const lone = remaining[0];
              return {
                id: lone,
                type: "widget",
                kind: widgets[lone]?.kind ?? "cpu",
                x: it.x,
                y: it.y,
                w: it.w,
                h: it.h,
              };
            }
            return { ...it, children: remaining, activeIndex: 0 };
          })
          .filter((i): i is LayoutItem => i !== null)
          .concat(extracted);
        onCommit(updated);
        if (remaining.length <= 1) onClose();
      }}
      onToggleSmartRotate={(enabled) => {
        onCommit(
          items.map((it) =>
            it.type === "stack" && it.id === stack.id ? { ...it, smartRotate: enabled } : it,
          ),
        );
      }}
      onUpdateSmartRules={(smartRules) => {
        onCommit(
          items.map((it) => {
            if (it.type !== "stack" || it.id !== stack.id) return it;
            if (smartRules.length === 0) {
              const copy = { ...it };
              delete copy.smartRules;
              return copy;
            }
            return { ...it, smartRules };
          }),
        );
      }}
      onOpenWidgetSettings={(childId) => {
        onClose();
        onOpenWidgetSettings(childId);
      }}
    />
  );
}
