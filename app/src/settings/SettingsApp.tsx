// Opaline Settings window — all 11 sections of brief §2.9 plus tray-parity quick actions.
import { useCallback, useEffect, useState } from "react";
import { Button, Slider, Snackbar, Switch } from "../design-system/components";
import { Icon, type IconName } from "../design-system/icons";
import { type LanguagePref, type MessageKey, t } from "../i18n";
import { computeGrid, matchMonitorKey } from "../layer/grid";
import { PRESETS, type PresetSpec, buildPreset } from "../layer/presets";
import {
  type AppearanceState,
  type Density,
  type GeocodePlace,
  type PerformanceMode,
  type ShellState,
  geocodePlaces,
  getShellState,
  patchSettings,
  saveLayouts,
  setHelperEnabled,
  setNativeShortcuts,
  triggerAction,
} from "../shell/api";
import { useShellTheme } from "../shell/useShellTheme";
import styles from "./Settings.module.css";
import { AboutSection, AlertsSection, BackupSection, DiagnosticsSection } from "./SettingsSections";
import { WidgetCustomizer } from "./WidgetCustomizer";

type SectionId =
  | "appearance"
  | "layout"
  | "widgets"
  | "alerts"
  | "performance"
  | "privacy"
  | "desktop"
  | "shortcuts"
  | "backup"
  | "diagnostics"
  | "about";

const NAV: readonly { id: SectionId; labelKey: MessageKey; icon: IconName }[] = [
  { id: "appearance", labelKey: "settings.nav.appearance", icon: "palette" },
  { id: "layout", labelKey: "settings.nav.layout", icon: "grid_view" },
  { id: "widgets", labelKey: "settings.nav.widgets", icon: "widgets" },
  { id: "alerts", labelKey: "settings.nav.alerts", icon: "notifications" },
  { id: "performance", labelKey: "settings.nav.performance", icon: "speed" },
  { id: "privacy", labelKey: "settings.nav.privacy", icon: "lock" },
  { id: "desktop", labelKey: "settings.nav.desktop", icon: "layers" },
  { id: "shortcuts", labelKey: "settings.nav.shortcuts", icon: "tune" },
  { id: "backup", labelKey: "settings.nav.backup", icon: "content_copy" },
  { id: "diagnostics", labelKey: "settings.nav.diagnostics", icon: "monitoring" },
  { id: "about", labelKey: "settings.nav.about", icon: "info" },
];

const VARIANTS = [
  { id: "tonal-spot", label: "Tonal Spot" },
  { id: "vibrant", label: "Vibrant" },
  { id: "expressive", label: "Expressive" },
  { id: "fidelity", label: "Fidelity" },
  { id: "neutral", label: "Neutral" },
  { id: "monochrome", label: "Monochrome" },
] as const;

export function SettingsApp() {
  const [section, setSection] = useState<SectionId>("appearance");
  const [state, setState] = useState<ShellState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedMonitor, setSelectedMonitor] = useState<string>("");
  const [cityQuery, setCityQuery] = useState("");
  const [places, setPlaces] = useState<GeocodePlace[]>([]);
  const [newSub, setNewSub] = useState("");
  const [peekKey, setPeekKey] = useState("<Super><Alt>w");
  const [editKey, setEditKey] = useState("<Super><Alt>e");

  const { locale } = useShellTheme(state);

  const notify = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  const applyState = useCallback((s: ShellState) => {
    setState(s);
    setPeekKey(s.shortcuts.peek);
    setEditKey(s.shortcuts.edit);
    const primaryKey = (s.monitors.find((m) => m.primary) ?? s.monitors[0])?.key ?? "";
    setSelectedMonitor((cur) => (cur ? cur : primaryKey));
  }, []);

  const refresh = useCallback(async () => {
    const s = await getShellState();
    applyState(s);
  }, [applyState]);

  useEffect(() => {
    let alive = true;
    getShellState()
      .then((s) => {
        if (alive) applyState(s);
      })
      .catch((e: unknown) => {
        if (alive) setToast(`Could not load settings: ${String(e)}`);
      });
    return () => {
      alive = false;
    };
  }, [applyState]);

  const applyPatch = async (patch: Record<string, unknown>, message?: string) => {
    try {
      await patchSettings(patch);
      await refresh();
      if (message) notify(message);
    } catch (e) {
      notify(`Could not save: ${String(e)}`);
    }
  };

  const handleApplyPreset = async (preset: PresetSpec) => {
    if (!state) return;
    const targetMon =
      state.monitors.find((m) => m.key === selectedMonitor) ??
      state.monitors.find((m) => m.primary) ??
      state.monitors[0];
    if (!targetMon) return;
    const area = targetMon.work_area;
    const g = computeGrid(
      area ? area[2] : targetMon.width,
      area ? area[3] : targetMon.height,
      state.settings.layout.marginPx,
    );
    const built = buildPreset(preset, g.cols, g.rows);
    const key = matchMonitorKey(targetMon, Object.keys(state.layouts.monitors)) ?? targetMon.key;
    try {
      await patchSettings({ widgets: { ...state.settings.widgets, ...built.widgets } });
      await saveLayouts({
        ...state.layouts,
        monitors: { ...state.layouts.monitors, [key]: { items: built.items } },
      });
      await refresh();
      notify(`Applied "${preset.name}" to ${targetMon.connector}`);
    } catch (e) {
      notify(`Preset failed: ${String(e)}`);
    }
  };

  const activeNav = NAV.find((n) => n.id === section) ?? NAV[0];

  if (!state) {
    return (
      <div className={styles.shell}>
        <div className={styles.sidebar} />
        <div className={styles.main}>
          <div className={styles.content}>
            <p className={styles.cardDesc}>Loading Opaline settings…</p>
          </div>
        </div>
      </div>
    );
  }

  const { settings, desktop, shortcuts } = state;

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} aria-label="Settings sections">
        <div className={styles.brand}>
          <div className={styles.brandIcon}>
            <Icon name="widgets" size={20} fill={1} />
          </div>
          <div>
            <div className={styles.brandTitle}>{t(locale, "app.name")}</div>
            <div className={styles.brandSub}>
              {desktop.backend === "native"
                ? t(locale, "app.mode.native")
                : t(locale, "app.mode.instant")}
            </div>
          </div>
        </div>

        <nav className={styles.navList}>
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? "page" : undefined}
              className={`${styles.navItem} ${section === item.id ? styles.navActive : ""}`}
              onClick={() => {
                setSection(item.id);
              }}
            >
              <Icon name={item.icon} size={18} fill={section === item.id ? 1 : 0} />
              <span>{t(locale, item.labelKey)}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className={styles.main}>
        <header className={styles.topbar}>
          <h1 className={styles.topTitle}>{activeNav ? t(locale, activeNav.labelKey) : ""}</h1>
          <div className={styles.quickActions}>
            <Button
              variant="tonal"
              icon="visibility"
              onClick={() => {
                void triggerAction("peek");
              }}
            >
              {t(locale, "action.peek")}
            </Button>
            <Button
              variant="tonal"
              icon="edit"
              onClick={() => {
                void triggerAction("edit");
              }}
            >
              {t(locale, "action.editWidgets")}
            </Button>
            <Button
              variant="text"
              icon={state.paused ? "play_arrow" : "pause"}
              onClick={() => {
                triggerAction(state.paused ? "resume" : "pause")
                  .then(() => refresh())
                  .catch(() => undefined);
              }}
            >
              {state.paused ? t(locale, "action.resume") : t(locale, "action.pause")}
            </Button>
            <Button
              variant="text"
              icon="power_settings_new"
              onClick={() => {
                void triggerAction("quit");
              }}
            >
              {t(locale, "action.quit")}
            </Button>
          </div>
        </header>

        <div className={styles.content}>
          {section === "appearance" ? (
            <>
              <div className={styles.card}>
                <h2 className={styles.cardTitle}>{t(locale, "settings.appearance.themeCard")}</h2>
                <div className={styles.row}>
                  <div className={styles.rowText}>
                    <span className={styles.rowLabel}>
                      {t(locale, "settings.appearance.language")}
                    </span>
                    <span className={styles.rowHint}>
                      {t(locale, "settings.appearance.languageHint")}
                    </span>
                  </div>
                  <div className={styles.segmented}>
                    {(
                      [
                        { id: "system", label: t(locale, "settings.appearance.languageSystem") },
                        { id: "en", label: "English" },
                        { id: "de", label: "Deutsch" },
                        { id: "ar", label: "العربية" },
                      ] as readonly { id: LanguagePref; label: string }[]
                    ).map((opt) => {
                      const active = settings.language === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          className={`${styles.segBtn} ${active ? styles.segActive : ""}`}
                          onClick={() => {
                            void applyPatch({ language: opt.id });
                          }}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className={styles.row}>
                  <div className={styles.rowText}>
                    <span className={styles.rowLabel}>Color source</span>
                    <span className={styles.rowHint}>
                      Dynamic Material 3 palette derived from wallpaper, GNOME accent, or custom.
                    </span>
                  </div>
                  <div className={styles.segmented}>
                    {(["wallpaper", "accent", "custom"] as const).map((src) => {
                      const active = (settings.style.colorSource ?? "wallpaper") === src;
                      return (
                        <button
                          key={src}
                          type="button"
                          className={`${styles.segBtn} ${active ? styles.segActive : ""}`}
                          onClick={() => {
                            void applyPatch({ style: { colorSource: src } });
                          }}
                        >
                          {src === "wallpaper"
                            ? "Wallpaper"
                            : src === "accent"
                              ? "GNOME accent"
                              : "Custom"}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {settings.style.colorSource === "custom" ? (
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>Custom seed color</span>
                    <input
                      type="color"
                      value={settings.style.seedColor ?? "#6750a4"}
                      onChange={(e) => {
                        void applyPatch({ style: { seedColor: e.target.value } });
                      }}
                    />
                  </div>
                ) : null}

                <div className={styles.row}>
                  <span className={styles.rowLabel}>Scheme variant</span>
                  <select
                    className={styles.select}
                    value={settings.style.variant ?? "tonal-spot"}
                    onChange={(e) => {
                      void applyPatch({ style: { variant: e.target.value } });
                    }}
                  >
                    {VARIANTS.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.row}>
                  <span className={styles.rowLabel}>Theme</span>
                  <div className={styles.segmented}>
                    {(["auto", "light", "dark"] as const).map((theme) => {
                      const active = (settings.style.theme ?? "auto") === theme;
                      return (
                        <button
                          key={theme}
                          type="button"
                          className={`${styles.segBtn} ${active ? styles.segActive : ""}`}
                          onClick={() => {
                            void applyPatch({ style: { theme } });
                          }}
                        >
                          {theme === "auto" ? "Auto" : theme === "light" ? "Light" : "Dark"}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className={styles.row}>
                  <span className={styles.rowLabel}>Contrast</span>
                  <div className={styles.segmented}>
                    {(
                      [
                        { v: 0, label: "Standard" },
                        { v: 0.5, label: "Medium" },
                        { v: 1, label: "High" },
                      ] as const
                    ).map((opt) => {
                      const active = (settings.style.contrast ?? 0) === opt.v;
                      return (
                        <button
                          key={opt.label}
                          type="button"
                          className={`${styles.segBtn} ${active ? styles.segActive : ""}`}
                          onClick={() => {
                            void applyPatch({ style: { contrast: opt.v } });
                          }}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className={styles.card}>
                <h2 className={styles.cardTitle}>Glass, transparency &amp; surface</h2>
                <div className={styles.row}>
                  <div className={styles.rowText}>
                    <span className={styles.rowLabel}>Background style</span>
                    <span className={styles.rowHint}>
                      Choose frosted glass, transparent frameless floating widgets, solid, or custom
                      color.
                    </span>
                  </div>
                  <select
                    className={styles.select}
                    value={settings.style.surface ?? "glass"}
                    onChange={(e) => {
                      void applyPatch({ style: { surface: e.target.value } });
                    }}
                  >
                    <option value="glass">Glass</option>
                    <option value="tinted">Tinted glass</option>
                    <option value="clear">Transparent (frameless)</option>
                    <option value="opaque">Solid</option>
                    <option value="color">Custom color</option>
                  </select>
                </div>

                {settings.style.surface === "color" ? (
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>Custom background color</span>
                    <input
                      type="color"
                      value={settings.style.surfaceColor ?? "#1e1b2e"}
                      onChange={(e) => {
                        void applyPatch({ style: { surfaceColor: e.target.value } });
                      }}
                    />
                  </div>
                ) : null}

                {settings.style.surface !== "opaque" && settings.style.surface !== "clear" ? (
                  <>
                    <div className={styles.row}>
                      <div className={styles.rowText}>
                        <span className={styles.rowLabel}>
                          Transparency ({Math.round(settings.style.transparency ?? 60)}%)
                        </span>
                        <span className={styles.rowHint}>
                          0% = solid tint · 100% = crystal clear glass
                        </span>
                      </div>
                      <div style={{ width: 220 }}>
                        <Slider
                          value={settings.style.transparency ?? 60}
                          min={0}
                          max={100}
                          label="Transparency"
                          onChange={(v) => {
                            const t = Math.round(v);
                            void applyPatch({
                              style: { transparency: t },
                              appearance: { glass: Math.max(0, Math.min(100, 100 - t)) },
                            });
                          }}
                        />
                      </div>
                    </div>

                    <div className={styles.row}>
                      <div className={styles.rowText}>
                        <span className={styles.rowLabel}>
                          Extra blur ({Math.round(settings.style.blur ?? 0)}%)
                        </span>
                        <span className={styles.rowHint}>
                          Softens the wallpaper behind glass widgets.
                        </span>
                      </div>
                      <div style={{ width: 220 }}>
                        <Slider
                          value={settings.style.blur ?? 0}
                          min={0}
                          max={100}
                          label="Extra blur"
                          onChange={(v) => {
                            void applyPatch({ style: { blur: Math.round(v) } });
                          }}
                        />
                      </div>
                    </div>

                    <div className={styles.row}>
                      <span className={styles.rowLabel}>
                        Edge highlight ({Math.round(settings.style.rim ?? 50)}%)
                      </span>
                      <div style={{ width: 220 }}>
                        <Slider
                          value={settings.style.rim ?? 50}
                          min={0}
                          max={100}
                          label="Edge highlight"
                          onChange={(v) => {
                            void applyPatch({ style: { rim: Math.round(v) } });
                          }}
                        />
                      </div>
                    </div>

                    <div className={styles.row}>
                      <span className={styles.rowLabel}>
                        Shadow ({Math.round(settings.style.shadow ?? 50)}%)
                      </span>
                      <div style={{ width: 220 }}>
                        <Slider
                          value={settings.style.shadow ?? 50}
                          min={0}
                          max={100}
                          label="Shadow"
                          onChange={(v) => {
                            void applyPatch({ style: { shadow: Math.round(v) } });
                          }}
                        />
                      </div>
                    </div>
                  </>
                ) : null}

                <div className={styles.row}>
                  <span className={styles.rowLabel}>
                    Border ({(settings.style.borderWidth ?? 0).toFixed(1)} px)
                  </span>
                  <div style={{ width: 220 }}>
                    <Slider
                      value={settings.style.borderWidth ?? 0}
                      min={0}
                      max={4}
                      step={0.5}
                      label="Border width"
                      onChange={(v) => {
                        void applyPatch({ style: { borderWidth: Math.round(v * 2) / 2 } });
                      }}
                    />
                  </div>
                </div>

                {(settings.style.borderWidth ?? 0) > 0 ? (
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>Border color</span>
                    <input
                      type="color"
                      value={settings.style.borderColor ?? "#ffffff"}
                      onChange={(e) => {
                        void applyPatch({ style: { borderColor: e.target.value } });
                      }}
                    />
                  </div>
                ) : null}

                <div className={styles.row}>
                  <span className={styles.rowLabel}>
                    Text size ({Math.round((settings.style.textScale ?? 1) * 100)}%)
                  </span>
                  <div style={{ width: 220 }}>
                    <Slider
                      value={settings.style.textScale ?? 1}
                      min={0.75}
                      max={1.5}
                      step={0.05}
                      label="Text size"
                      onChange={(v) => {
                        void applyPatch({ style: { textScale: Math.round(v * 20) / 20 } });
                      }}
                    />
                  </div>
                </div>

                <div className={styles.row}>
                  <div className={styles.rowText}>
                    <span className={styles.rowLabel}>Text shadow</span>
                    <span className={styles.rowHint}>
                      Improves legibility on clear or frameless widgets.
                    </span>
                  </div>
                  <Switch
                    checked={settings.style.textShadow ?? false}
                    label="Text shadow"
                    onChange={(v) => {
                      void applyPatch({ style: { textShadow: v } });
                    }}
                  />
                </div>

                <div className={styles.row}>
                  <div className={styles.rowText}>
                    <span className={styles.rowLabel}>Keep text readable (auto-tint)</span>
                    <span className={styles.rowHint}>
                      Turn off to let high transparency stay clear even on bright wallpapers.
                    </span>
                  </div>
                  <Switch
                    checked={settings.style.legibility ?? true}
                    label="Adaptive legibility"
                    onChange={(v) => {
                      void applyPatch({ style: { legibility: v } });
                    }}
                  />
                </div>

                <div className={styles.row}>
                  <div className={styles.rowText}>
                    <span className={styles.rowLabel}>Appearance state</span>
                    <span className={styles.rowHint}>
                      Automatic dims widgets while app windows have focus, brightening on hover,
                      Peek, or desktop focus.
                    </span>
                  </div>
                  <div className={styles.segmented}>
                    {(["automatic", "full", "dimmed"] as readonly AppearanceState[]).map((st) => (
                      <button
                        key={st}
                        type="button"
                        className={`${styles.segBtn} ${settings.appearance.state === st ? styles.segActive : ""}`}
                        onClick={() => {
                          void applyPatch({ appearance: { state: st } });
                        }}
                      >
                        {st === "automatic" ? "Automatic" : st === "full" ? "Full color" : "Dimmed"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.row}>
                  <span className={styles.rowLabel}>Density</span>
                  <div className={styles.segmented}>
                    {(["compact", "comfortable", "spacious"] as readonly Density[]).map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`${styles.segBtn} ${settings.appearance.density === d ? styles.segActive : ""}`}
                        onClick={() => {
                          void applyPatch({
                            appearance: { density: d },
                            style: { density: d },
                          });
                        }}
                      >
                        {d[0]?.toUpperCase()}
                        {d.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {section === "layout" ? (
            <>
              <div className={styles.card}>
                <div className={styles.row}>
                  <div className={styles.rowText}>
                    <h2 className={styles.cardTitle}>Starter presets</h2>
                    <p className={styles.cardDesc}>
                      Apply a curated layout to a display, then fine-tune it in Edit mode.
                    </p>
                  </div>
                  <select
                    className={styles.select}
                    value={selectedMonitor}
                    onChange={(e) => {
                      setSelectedMonitor(e.target.value);
                    }}
                  >
                    {state.monitors.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.connector} ({m.width}×{m.height}
                        {m.primary ? ", Primary" : ""})
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.grid3}>
                  {PRESETS.map((p) => (
                    <div key={p.id} className={styles.presetCard}>
                      <div>
                        <div className={styles.rowLabel}>{p.name}</div>
                        <div className={styles.rowHint}>{p.description}</div>
                      </div>
                      <Button
                        variant="tonal"
                        onClick={() => {
                          void handleApplyPreset(p);
                        }}
                      >
                        Apply preset
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className={styles.card}>
                <h2 className={styles.cardTitle}>Grid &amp; monitors</h2>
                <div className={styles.row}>
                  <div className={styles.rowText}>
                    <span className={styles.rowLabel}>
                      Safe margin ({settings.layout.marginPx} px)
                    </span>
                    <span className={styles.rowHint}>
                      Inset from each monitor&apos;s work area around the widget grid.
                    </span>
                  </div>
                  <div style={{ width: 220 }}>
                    <Slider
                      value={settings.layout.marginPx}
                      min={12}
                      max={64}
                      label="Safe margin"
                      onChange={(v) => {
                        void applyPatch({ layout: { marginPx: Math.round(v) } });
                      }}
                    />
                  </div>
                </div>

                <div className={styles.row}>
                  <div className={styles.rowText}>
                    <span className={styles.rowLabel}>
                      Show disconnected displays&apos; widgets on primary
                    </span>
                    <span className={styles.rowHint}>
                      When off, unplugged monitor layouts wait quietly until reconnected.
                    </span>
                  </div>
                  <Switch
                    checked={state.layouts.showMissingOnPrimary}
                    label="Show missing monitors' widgets on primary"
                    onChange={(checked) => {
                      saveLayouts({ ...state.layouts, showMissingOnPrimary: checked })
                        .then(() => refresh())
                        .catch((e: unknown) => {
                          notify(`Could not update layouts: ${String(e)}`);
                        });
                    }}
                  />
                </div>

                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Display</th>
                      <th>Resolution</th>
                      <th>Scale</th>
                      <th>Placed items</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.monitors.map((m) => {
                      const key = matchMonitorKey(m, Object.keys(state.layouts.monitors)) ?? m.key;
                      const count = state.layouts.monitors[key]?.items.length ?? 0;
                      return (
                        <tr key={m.key}>
                          <td>
                            {m.connector} {m.primary ? "(Primary)" : ""}
                          </td>
                          <td>
                            {m.width}×{m.height}
                          </td>
                          <td>{Math.round(m.scale * 100)}%</td>
                          <td>{count}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {section === "widgets" ? (
            <>
              <WidgetCustomizer state={state} refresh={refresh} notify={notify} />

              <div className={styles.card}>
                <h2 className={styles.cardTitle}>Weather</h2>
                <div className={styles.row}>
                  <div className={styles.rowText}>
                    <span className={styles.rowLabel}>
                      Location: {settings.weather.location?.name ?? "Not set"}
                    </span>
                    <span className={styles.rowHint}>
                      Powered by Open-Meteo (no API key required).
                    </span>
                  </div>
                  <Switch
                    checked={settings.weather.automatic}
                    label="Automatic location"
                    onChange={(v) => {
                      void applyPatch({ weather: { automatic: v } });
                    }}
                  />
                </div>
                <div className={styles.inlineRow}>
                  <input
                    className={styles.input}
                    style={{ flex: 1, minWidth: 200 }}
                    placeholder="Search city (e.g. Berlin, Munich, Cairo)…"
                    value={cityQuery}
                    onChange={(e) => {
                      setCityQuery(e.target.value);
                    }}
                  />
                  <Button
                    variant="tonal"
                    icon="search"
                    onClick={() => {
                      if (!cityQuery.trim()) return;
                      geocodePlaces(cityQuery.trim())
                        .then(setPlaces)
                        .catch((e: unknown) => {
                          notify(`Search failed: ${String(e)}`);
                        });
                    }}
                  >
                    Search
                  </Button>
                </div>
                {places.length > 0 ? (
                  <div className={styles.placeList}>
                    {places.slice(0, 5).map((p) => (
                      <button
                        key={`${p.name}-${String(p.latitude)}`}
                        type="button"
                        className={styles.placeBtn}
                        onClick={() => {
                          void applyPatch(
                            {
                              weather: {
                                location: {
                                  name: p.name,
                                  latitude: p.latitude,
                                  longitude: p.longitude,
                                  country: p.country ?? null,
                                },
                                automatic: false,
                              },
                            },
                            `Weather set to ${p.name}`,
                          );
                          setPlaces([]);
                        }}
                      >
                        <span>
                          {p.name}
                          {p.admin1 ? `, ${p.admin1}` : ""}
                          {p.country ? ` (${p.country})` : ""}
                        </span>
                        <Icon name="check" size={16} />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className={styles.card}>
                <h2 className={styles.cardTitle}>Network &amp; Calendar</h2>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Data-usage billing day (1–31)</span>
                  <input
                    className={styles.input}
                    type="number"
                    min={1}
                    max={31}
                    style={{ width: 88 }}
                    value={settings.network.billingDay}
                    onChange={(e) => {
                      const day = Math.max(1, Math.min(31, Math.round(Number(e.target.value))));
                      if (Number.isFinite(day)) void applyPatch({ network: { billingDay: day } });
                    }}
                  />
                </div>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Latency target IP</span>
                  <input
                    className={styles.input}
                    style={{ width: 160 }}
                    defaultValue={settings.network.latencyTarget}
                    onBlur={(e) => {
                      const ip = e.target.value.trim();
                      if (ip && ip !== settings.network.latencyTarget) {
                        void applyPatch({ network: { latencyTarget: ip } });
                      }
                    }}
                  />
                </div>
                <div className={styles.row}>
                  <div className={styles.rowText}>
                    <span className={styles.rowLabel}>GNOME system calendars (EDS)</span>
                    <span className={styles.rowHint}>
                      Read-only events from GNOME Calendar / Online Accounts.
                    </span>
                  </div>
                  <Switch
                    checked={settings.calendar.system}
                    label="Use system calendars"
                    onChange={(v) => {
                      void applyPatch({ calendar: { system: v } });
                    }}
                  />
                </div>
                <div className={styles.inlineRow}>
                  <input
                    className={styles.input}
                    style={{ flex: 1 }}
                    placeholder="Add https:// or webcal:// ICS subscription URL…"
                    value={newSub}
                    onChange={(e) => {
                      setNewSub(e.target.value);
                    }}
                  />
                  <Button
                    variant="tonal"
                    icon="add"
                    onClick={() => {
                      const u = newSub.trim();
                      if (!u) return;
                      void applyPatch({
                        calendar: { subscriptions: [...settings.calendar.subscriptions, u] },
                      });
                      setNewSub("");
                    }}
                  >
                    Add
                  </Button>
                </div>
                {settings.calendar.subscriptions.map((url) => (
                  <div key={url} className={styles.row}>
                    <code style={{ fontSize: 12 }}>{url}</code>
                    <Button
                      variant="text"
                      icon="delete"
                      onClick={() => {
                        void applyPatch({
                          calendar: {
                            subscriptions: settings.calendar.subscriptions.filter((x) => x !== url),
                          },
                        });
                      }}
                    />
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {section === "alerts" ? (
            <AlertsSection state={state} refresh={refresh} notify={notify} />
          ) : null}

          {section === "performance" ? (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Sampling &amp; power</h2>
              <div className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowLabel}>Performance profile</span>
                  <span className={styles.rowHint}>
                    Eco halves update rates; Balanced adapts automatically; Realtime samples visible
                    widgets at 1 s.
                  </span>
                </div>
                <div className={styles.segmented}>
                  {(["eco", "balanced", "realtime"] as readonly PerformanceMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`${styles.segBtn} ${settings.performance.mode === mode ? styles.segActive : ""}`}
                      onClick={() => {
                        void applyPatch({ performance: { mode } });
                      }}
                    >
                      {mode === "eco" ? "Eco" : mode === "balanced" ? "Balanced" : "Realtime"}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowLabel}>Pause live updates on battery</span>
                  <span className={styles.rowHint}>
                    Keeps only low-rate alert checks while unplugged.
                  </span>
                </div>
                <Switch
                  checked={settings.performance.pauseOnBattery}
                  label="Pause on battery"
                  onChange={(v) => {
                    void applyPatch({ performance: { pauseOnBattery: v } });
                  }}
                />
              </div>
            </div>
          ) : null}

          {section === "privacy" ? (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Privacy &amp; network access</h2>
              <p className={styles.cardDesc}>
                Opaline collects zero telemetry. The only outbound network requests are the features
                you enable below (plus album art when playing streamed media).
              </p>

              <div className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowLabel}>Public IP lookup</span>
                  <span className={styles.rowHint}>
                    Opt-in (off by default). Cached for 10 minutes when shown in Network.
                  </span>
                </div>
                <Switch
                  checked={settings.network.publicIp}
                  label="Public IP lookup"
                  onChange={(v) => {
                    void applyPatch({ network: { publicIp: v } });
                  }}
                />
              </div>

              <div className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowLabel}>Daily update checks</span>
                  <span className={styles.rowHint}>
                    Checks GitHub Releases once a day with a generic user agent.
                  </span>
                </div>
                <Switch
                  checked={settings.privacy.updateChecks}
                  label="Daily update checks"
                  onChange={(v) => {
                    void applyPatch({ privacy: { updateChecks: v } });
                  }}
                />
              </div>

              <div className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowLabel}>Show CPU power and full SSD health</span>
                  <span className={styles.rowHint}>
                    Uses Opaline&apos;s read-only polkit helper for root-only RAPL energy counters.
                  </span>
                </div>
                <Switch
                  checked={settings.privacy.privilegedSensors}
                  label="Privileged sensors"
                  onChange={(v) => {
                    void applyPatch({ privacy: { privilegedSensors: v } });
                  }}
                />
              </div>
            </div>
          ) : null}

          {section === "desktop" ? (
            <div className={styles.card}>
              <div className={styles.row}>
                <div className={styles.rowText}>
                  <h2 className={styles.cardTitle}>GNOME desktop integration</h2>
                  <p className={styles.cardDesc}>
                    {desktop.backend === "native"
                      ? "Native — widgets run as trusted Wayland windows behind your apps."
                      : desktop.helperInstalled && desktop.helperEnabled
                        ? "Instant — Native mode turns on after you log out and back in."
                        : "Instant — widgets work right away through Xwayland without a helper."}
                  </p>
                </div>
                <span
                  className={`${styles.statusBadge} ${desktop.backend === "native" ? styles.statusOk : styles.statusWarn}`}
                >
                  <Icon name={desktop.backend === "native" ? "check" : "info"} size={16} />
                  {desktop.backend === "native" ? "Native" : "Instant"}
                </span>
              </div>

              <div className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowLabel}>Use Native GNOME Shell helper</span>
                  <span className={styles.rowHint}>
                    {desktop.helperInstalled
                      ? `Installed at ${desktop.helperPath ?? "system extensions"}`
                      : "Helper is not installed yet (included in the .deb package)."}
                  </span>
                </div>
                <Switch
                  checked={desktop.helperEnabled}
                  disabled={!desktop.helperInstalled}
                  label="Enable desktop integration helper"
                  onChange={(enabled) => {
                    setHelperEnabled(enabled)
                      .then(async () => {
                        await refresh();
                        notify(
                          enabled
                            ? "Desktop integration enabled"
                            : "Desktop integration disabled (switched to Instant mode)",
                        );
                      })
                      .catch((e: unknown) => {
                        notify(`Could not update helper: ${String(e)}`);
                      });
                  }}
                />
              </div>
            </div>
          ) : null}

          {section === "shortcuts" ? (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Keyboard shortcuts</h2>
              <p className={styles.cardDesc}>
                {shortcuts.editable
                  ? "In Native mode, shortcuts are registered directly with GNOME Shell (GTK accelerator format, e.g. <Super><Alt>w)."
                  : "In Instant mode, shortcuts are managed through the XDG GlobalShortcuts portal. You can customize them in GNOME Settings → Keyboard → Apps."}
              </p>

              <div className={styles.row}>
                <span className={styles.rowLabel}>Peek at widgets</span>
                <input
                  className={styles.input}
                  disabled={!shortcuts.editable}
                  value={peekKey}
                  onChange={(e) => {
                    setPeekKey(e.target.value);
                  }}
                />
              </div>

              <div className={styles.row}>
                <span className={styles.rowLabel}>Edit widgets</span>
                <input
                  className={styles.input}
                  disabled={!shortcuts.editable}
                  value={editKey}
                  onChange={(e) => {
                    setEditKey(e.target.value);
                  }}
                />
              </div>

              {shortcuts.editable ? (
                <div className={styles.inlineRow}>
                  <Button
                    variant="filled"
                    icon="check"
                    onClick={() => {
                      setNativeShortcuts(peekKey, editKey)
                        .then(async () => {
                          await refresh();
                          notify("Shortcuts saved");
                        })
                        .catch((e: unknown) => {
                          notify(`Could not save shortcuts: ${String(e)}`);
                        });
                    }}
                  >
                    Save shortcuts
                  </Button>
                  <Button
                    variant="text"
                    icon="restart_alt"
                    onClick={() => {
                      setPeekKey("<Super><Alt>w");
                      setEditKey("<Super><Alt>e");
                      setNativeShortcuts("<Super><Alt>w", "<Super><Alt>e")
                        .then(() => refresh())
                        .catch(() => undefined);
                    }}
                  >
                    Reset defaults
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {section === "backup" ? (
            <BackupSection state={state} refresh={refresh} notify={notify} />
          ) : null}

          {section === "diagnostics" ? (
            <DiagnosticsSection state={state} refresh={refresh} notify={notify} />
          ) : null}

          {section === "about" ? (
            <AboutSection state={state} refresh={refresh} notify={notify} />
          ) : null}
        </div>
      </main>

      {toast ? (
        <div className={styles.toast}>
          <Snackbar
            message={toast}
            onDismiss={() => {
              setToast(null);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
