// Settings → Looks section (PLAN-2 5.6, brief §6.4): browse all ten built-in looks, switch
// theme live, or apply a look together with its curated starter layout.
import { Button } from "../design-system/components";
import { Icon } from "../design-system/icons";
import { computeGrid, matchMonitorKey } from "../layer/grid";
import {
  BUILTIN_LOOK_IDS,
  type BuiltinLookId,
  LOOK_STARTER_LAYOUTS,
  buildStarterLayout,
} from "../layer/presets";
import { type ShellState, patchSettings, saveLayouts, triggerAction } from "../shell/api";
import styles from "./Settings.module.css";

interface LooksSectionProps {
  state: ShellState;
  selectedMonitor: string;
  refresh: () => Promise<void>;
  notify: (msg: string) => void;
}

export function LooksSection({ state, selectedMonitor, refresh, notify }: LooksSectionProps) {
  const activeTheme = state.settings.theme ?? "opaline";

  const applyThemeOnly = async (id: BuiltinLookId) => {
    try {
      await patchSettings({ theme: id });
      await refresh();
      notify(`Switched look to ${LOOK_STARTER_LAYOUTS[id].name}`);
    } catch (e) {
      notify(`Could not switch look: ${String(e)}`);
    }
  };

  const applyLookAndLayout = async (id: BuiltinLookId) => {
    const starter = LOOK_STARTER_LAYOUTS[id];
    const targetMon =
      state.monitors.find((m) => m.key === selectedMonitor) ??
      state.monitors.find((m) => m.primary) ??
      state.monitors[0];
    try {
      if (targetMon) {
        const area = targetMon.work_area;
        const g = computeGrid(
          area ? area[2] : targetMon.width,
          area ? area[3] : targetMon.height,
          state.settings.layout.marginPx,
        );
        const built = buildStarterLayout(starter, g.cols, g.rows);
        const key =
          matchMonitorKey(targetMon, Object.keys(state.layouts.monitors)) ?? targetMon.key;
        await patchSettings({
          theme: id,
          widgets: { ...state.settings.widgets, ...built.widgets },
        });
        await saveLayouts({
          ...state.layouts,
          monitors: { ...state.layouts.monitors, [key]: { items: built.items } },
        });
      } else {
        await patchSettings({ theme: id });
      }
      await refresh();
      notify(`Applied ${starter.name} look and starter layout`);
    } catch (e) {
      notify(`Could not apply look: ${String(e)}`);
    }
  };

  return (
    <div id="looks-themes" className={styles.card}>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <h2 className={styles.cardTitle}>Ten built-in looks</h2>
          <p className={styles.cardDesc}>
            Switch themes live across your desktop, or apply a look together with its curated
            starter layout. Fine-tune individual widgets anytime in Edit mode with the live
            Inspector.
          </p>
        </div>
        <Button
          variant="tonal"
          icon="edit"
          onClick={() => {
            void triggerAction("edit");
          }}
        >
          Open Inspector in Edit mode
        </Button>
      </div>

      <div className={styles.grid3}>
        {BUILTIN_LOOK_IDS.map((id) => {
          const look = LOOK_STARTER_LAYOUTS[id];
          const isActive = activeTheme === id;
          return (
            <div key={id} className={styles.presetCard}>
              <div>
                <div className={styles.rowLabel}>
                  {look.name}{" "}
                  {isActive ? (
                    <span className={`${styles.statusBadge} ${styles.statusOk}`}>
                      <Icon name="check" size={14} /> Active
                    </span>
                  ) : null}
                </div>
                <div className={styles.rowHint}>{look.tagline}</div>
              </div>
              <div className={styles.inlineRow}>
                <Button
                  variant={isActive ? "filled" : "tonal"}
                  onClick={() => {
                    void applyThemeOnly(id);
                  }}
                >
                  {isActive ? "Active" : "Use look"}
                </Button>
                <Button
                  variant="text"
                  onClick={() => {
                    void applyLookAndLayout(id);
                  }}
                >
                  + Starter layout
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
