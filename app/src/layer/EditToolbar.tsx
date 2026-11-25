// The floating Edit mode toolbar: add, presets, settings, undo, redo, done.
import { Button, Toolbar } from "../design-system/components";
import { type Locale, t } from "../i18n";
import styles from "./LayerApp.module.css";

export interface EditToolbarProps {
  locale: Locale;
  dir: "ltr" | "rtl";
  canUndo: boolean;
  canRedo: boolean;
  onAdd: () => void;
  onTogglePresets: () => void;
  onToggleLook: () => void;
  onSettings: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDone: () => void;
}

export function EditToolbar({
  locale,
  dir,
  canUndo,
  canRedo,
  onAdd,
  onTogglePresets,
  onToggleLook,
  onSettings,
  onUndo,
  onRedo,
  onDone,
}: EditToolbarProps) {
  return (
    <div className={styles.toolbarWrap} dir={dir}>
      <Toolbar label={t(locale, "action.editWidgets")}>
        <Button variant="tonal" icon="add" onClick={onAdd}>
          {t(locale, "action.addWidget")}
        </Button>
        <Button variant="text" icon="grid_view" onClick={onTogglePresets}>
          {t(locale, "action.presets")}
        </Button>
        <Button variant="text" icon="palette" onClick={onToggleLook}>
          {t(locale, "action.look")}
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
