// The floating Edit mode toolbar (PLAN-2 5.3–5.4): Add widget, Presets, Theme, Look,
// Grid/Free mode toggle, Tidy up, Settings, Undo/Redo, Done, plus a contextual multi-select
// bar for Align, Distribute, Duplicate, Lock/Unlock, and Group/Ungroup.
import { Button, Toolbar } from "../design-system/components";
import { type Locale, t } from "../i18n";
import type { AlignKind, DistributeAxis } from "./free";
import type { LayoutMode } from "./grid";
import styles from "./LayerApp.module.css";

export interface EditToolbarProps {
  locale: Locale;
  dir: "ltr" | "rtl";
  mode: LayoutMode;
  selectedCount: number;
  allSelectedLocked: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onAdd: () => void;
  onTogglePresets: () => void;
  onToggleTheme: () => void;
  onToggleLook: () => void;
  onToggleMode: () => void;
  onTidyUp: () => void;
  onAlign: (kind: AlignKind) => void;
  onDistribute: (axis: DistributeAxis) => void;
  onDuplicate: () => void;
  onToggleLock: () => void;
  onGroupToggle: () => void;
  onSettings: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDone: () => void;
}

export function EditToolbar({
  locale,
  dir,
  mode,
  selectedCount,
  allSelectedLocked,
  canGroup,
  canUngroup,
  canUndo,
  canRedo,
  onAdd,
  onTogglePresets,
  onToggleTheme,
  onToggleLook,
  onToggleMode,
  onTidyUp,
  onAlign,
  onDistribute,
  onDuplicate,
  onToggleLock,
  onGroupToggle,
  onSettings,
  onUndo,
  onRedo,
  onDone,
}: EditToolbarProps) {
  return (
    <div className={styles.toolbarWrap} dir={dir}>
      {selectedCount >= 2 ? (
        <div className={styles.multiBar} role="group" aria-label="Selection actions">
          <span className={styles.multiCount}>{selectedCount} selected</span>
          <Button
            variant="text"
            onClick={() => {
              onAlign("left");
            }}
          >
            Align left
          </Button>
          <Button
            variant="text"
            onClick={() => {
              onAlign("center-x");
            }}
          >
            Center H
          </Button>
          <Button
            variant="text"
            onClick={() => {
              onAlign("top");
            }}
          >
            Align top
          </Button>
          {selectedCount >= 3 ? (
            <>
              <Button
                variant="text"
                onClick={() => {
                  onDistribute("horizontal");
                }}
              >
                Distribute H
              </Button>
              <Button
                variant="text"
                onClick={() => {
                  onDistribute("vertical");
                }}
              >
                Distribute V
              </Button>
            </>
          ) : null}
          <Button variant="text" icon="content_copy" onClick={onDuplicate}>
            Duplicate
          </Button>
          <Button variant="text" icon="lock" onClick={onToggleLock}>
            {allSelectedLocked ? "Unlock" : "Lock"}
          </Button>
          {canGroup || canUngroup ? (
            <Button variant="text" icon="layers" onClick={onGroupToggle}>
              {canUngroup ? "Ungroup" : "Group"}
            </Button>
          ) : null}
        </div>
      ) : null}

      <Toolbar label={t(locale, "action.editWidgets")}>
        <Button variant="tonal" icon="add" onClick={onAdd}>
          {t(locale, "action.addWidget")}
        </Button>
        <Button variant="text" icon="grid_view" onClick={onTogglePresets}>
          {t(locale, "action.presets")}
        </Button>
        <Button variant="text" icon="palette" onClick={onToggleTheme}>
          Theme
        </Button>
        <Button variant="text" icon="tune" onClick={onToggleLook}>
          {t(locale, "action.look")}
        </Button>
        <Button
          variant={mode === "free" ? "tonal" : "text"}
          icon={mode === "free" ? "open_in_full" : "grid_view"}
          onClick={onToggleMode}
        >
          {mode === "free" ? "Free" : "Grid"}
        </Button>
        <Button variant="text" icon="widgets" onClick={onTidyUp}>
          Tidy up
        </Button>
        <Button variant="text" icon="settings" onClick={onSettings}>
          {t(locale, "action.settings")}
        </Button>
        <Button
          variant="text"
          icon="undo"
          label={t(locale, "action.undo")}
          disabled={!canUndo}
          onClick={onUndo}
        />
        <Button
          variant="text"
          icon="redo"
          label={t(locale, "action.redo")}
          disabled={!canRedo}
          onClick={onRedo}
        />
        <Button variant="filled" icon="check" onClick={onDone}>
          {t(locale, "action.done")}
        </Button>
      </Toolbar>
    </div>
  );
}
