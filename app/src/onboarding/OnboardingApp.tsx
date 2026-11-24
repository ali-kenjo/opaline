// 6-step first-run Onboarding flow (brief §2.8, PLAN 6.1):
// Welcome → Pick a starter layout (over real wallpaper) → Desktop integration → Privacy →
// Optional CPU power & autostart → Finish.
import { useEffect, useState } from "react";
import { Button, LoadingIndicator, Snackbar, Switch } from "../design-system/components";
import { Icon } from "../design-system/icons";
import { computeGrid, matchMonitorKey } from "../layer/grid";
import { PRESETS, type PresetSpec, buildPreset } from "../layer/presets";
import {
  type GeocodePlace,
  type ShellState,
  type WeatherLocation,
  closeWindow,
  geocodePlaces,
  getShellState,
  patchSettings,
  saveLayouts,
  setAutostart,
  setHelperEnabled,
  triggerAction,
} from "../shell/api";
import { useShellTheme } from "../shell/useShellTheme";
import { widgetByKind } from "../widgets/registry";
import styles from "./Onboarding.module.css";

const TOTAL_STEPS = 6;

export function OnboardingApp() {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<ShellState | null>(null);
  const [presetId, setPresetId] = useState("essentials");
  const [desktopIntegration, setDesktopIntegration] = useState(true);
  const [weatherAuto, setWeatherAuto] = useState(false);
  const [weatherLocation, setWeatherLocation] = useState<WeatherLocation | null>(null);
  const [cityQuery, setCityQuery] = useState("");
  const [places, setPlaces] = useState<GeocodePlace[]>([]);
  const [publicIp, setPublicIp] = useState(false);
  const [updateChecks, setUpdateChecks] = useState(true);
  const [privilegedSensors, setPrivilegedSensors] = useState(false);
  const [startOnLogin, setStartOnLogin] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const { wallpaperUrl } = useShellTheme(state);

  useEffect(() => {
    getShellState()
      .then((s) => {
        setState(s);
        setDesktopIntegration(s.desktop.helperInstalled ? true : s.desktop.helperEnabled);
        setWeatherAuto(s.settings.weather.automatic);
        setWeatherLocation(s.settings.weather.location);
        setPublicIp(s.settings.network.publicIp);
        setUpdateChecks(s.settings.privacy.updateChecks);
        setPrivilegedSensors(s.settings.privacy.privilegedSensors);
        setStartOnLogin(s.autostart || !s.settings.onboardingDone);
      })
      .catch((e: unknown) => {
        setToast(`Could not load Opaline state: ${String(e)}`);
      });
  }, []);

  const preset: PresetSpec = PRESETS.find((p) => p.id === presetId) ?? {
    id: "essentials",
    name: "Essentials",
    description: "Clock, CPU, memory, network and weather",
    entries: [
      { kind: "clock", size: "M" },
      { kind: "cpu", size: "S" },
      { kind: "memory", size: "S" },
      { kind: "network", size: "S" },
      { kind: "weather", size: "M" },
    ],
  };

  const handleFinish = async (openEdit: boolean) => {
    if (!state) return;
    setSaving(true);
    try {
      const primary = state.monitors.find((m) => m.primary) ?? state.monitors[0];
      const nextWidgets = { ...state.settings.widgets };
      let nextLayouts = state.layouts;

      if (primary) {
        const area = primary.work_area;
        const g = computeGrid(
          area ? area[2] : primary.width,
          area ? area[3] : primary.height,
          state.settings.layout.marginPx,
        );
        const built = buildPreset(preset, g.cols, g.rows);
        Object.assign(nextWidgets, built.widgets);
        const key = matchMonitorKey(primary, Object.keys(state.layouts.monitors)) ?? primary.key;
        nextLayouts = {
          ...state.layouts,
          monitors: { ...state.layouts.monitors, [key]: { items: built.items } },
        };
      }

      await patchSettings({
        onboardingDone: true,
        widgets: nextWidgets,
        weather: {
          location: weatherLocation,
          automatic: weatherAuto,
        },
        network: {
          publicIp,
        },
        privacy: {
          updateChecks,
          privilegedSensors,
        },
      });
      await saveLayouts(nextLayouts);
      await setAutostart(startOnLogin);
      if (state.desktop.helperInstalled) {
        await setHelperEnabled(desktopIntegration);
      }
      setDone(true);
      if (openEdit) {
        await triggerAction("edit");
      }
      await closeWindow();
    } catch (e) {
      setToast(`Setup error: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const wallpaperBg = wallpaperUrl ? { backgroundImage: `url("${wallpaperUrl}")` } : undefined;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <Icon name="widgets" size={22} fill={1} />
          <span>Opaline</span>
        </div>
        <div
          className={styles.steps}
          aria-label={`Step ${String(step + 1)} of ${String(TOTAL_STEPS)}`}
        >
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <span
              key={i}
              className={`${styles.dot} ${i === step ? styles.dotActive : i < step ? styles.dotDone : ""}`}
            />
          ))}
        </div>
      </header>

      <main className={styles.body}>
        {step === 0 ? (
          <div className={styles.hero} style={wallpaperBg}>
            <div className={styles.heroScrim} />
            <div className={styles.heroContent}>
              <LoadingIndicator size={56} label="Opaline expressive emblem" />
              <h1 className={styles.title}>Glass widgets for your Ubuntu desktop</h1>
              <p className={styles.subtitle}>
                Live system, weather, calendar, and media widgets right on your wallpaper — above
                your desktop icons, below your apps, and light on battery.
              </p>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <>
            <div>
              <h1 className={styles.stepTitle}>Pick a starter layout</h1>
              <p className={styles.stepDesc}>
                Previewed over your desktop wallpaper. You can add, move, resize, or stack widgets
                anytime in Edit mode.
              </p>
            </div>

            <div className={styles.wallpaperPreview} style={wallpaperBg}>
              <div className={styles.previewGrid}>
                {preset.entries.map((entry, idx) => {
                  const def = widgetByKind(entry.kind);
                  const colSpan = entry.size === "S" ? 1 : 2;
                  const rowSpan = entry.size === "L" ? 2 : 1;
                  return (
                    <div
                      key={`${entry.kind}-${String(idx)}`}
                      className={styles.previewCard}
                      style={{
                        gridColumn: `span ${String(colSpan)}`,
                        gridRow: `span ${String(rowSpan)}`,
                      }}
                    >
                      <span className={styles.previewName}>
                        <Icon name={def?.icon ?? "widgets"} size={15} />
                        {def?.name ?? entry.kind}
                      </span>
                      <span className={styles.previewSize}>{entry.size}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={styles.presetRow}>
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`${styles.presetBtn} ${presetId === p.id ? styles.presetBtnActive : ""}`}
                  onClick={() => {
                    setPresetId(p.id);
                  }}
                >
                  <span className={styles.presetLabel}>{p.name}</span>
                  <span className={styles.presetHint}>{p.description}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div>
              <h1 className={styles.stepTitle}>Desktop integration</h1>
              <p className={styles.stepDesc}>
                Lets Opaline place widgets behind your windows. Takes effect the next time you log
                in.
              </p>
            </div>

            <div className={styles.card}>
              <div className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowLabel}>Enable GNOME desktop integration</span>
                  <span className={styles.rowHint}>
                    {state?.desktop.backend === "native"
                      ? "Already active — running in Native Wayland mode."
                      : "Widgets already work right away in Instant mode until your next login."}
                  </span>
                </div>
                <Switch
                  checked={desktopIntegration}
                  disabled={!state?.desktop.helperInstalled}
                  label="Enable desktop integration"
                  onChange={setDesktopIntegration}
                />
              </div>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <div>
              <h1 className={styles.stepTitle}>Privacy &amp; network features</h1>
              <p className={styles.stepDesc}>
                Opaline collects zero telemetry. Choose which optional network lookups you want.
              </p>
            </div>

            <div className={styles.card}>
              <div className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowLabel}>
                    Weather location: {weatherLocation?.name ?? "Not set"}
                  </span>
                  <span className={styles.rowHint}>Open-Meteo forecast without an API key.</span>
                </div>
                <Switch
                  checked={weatherAuto}
                  label="Automatic location"
                  onChange={setWeatherAuto}
                />
              </div>

              {!weatherAuto ? (
                <>
                  <div className={styles.inlineRow}>
                    <input
                      className={styles.input}
                      placeholder="Search city (e.g. Berlin, London, Cairo)…"
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
                            setToast(`Search failed: ${String(e)}`);
                          });
                      }}
                    >
                      Search
                    </Button>
                  </div>
                  {places.slice(0, 4).map((p) => (
                    <button
                      key={`${p.name}-${String(p.latitude)}`}
                      type="button"
                      className={styles.placeBtn}
                      onClick={() => {
                        setWeatherLocation({
                          name: p.name,
                          latitude: p.latitude,
                          longitude: p.longitude,
                          country: p.country ?? null,
                        });
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
                </>
              ) : null}

              <div className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowLabel}>Public IP lookup</span>
                  <span className={styles.rowHint}>
                    Off by default; only used by the Network widget.
                  </span>
                </div>
                <Switch checked={publicIp} label="Public IP lookup" onChange={setPublicIp} />
              </div>

              <div className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowLabel}>Daily update checks</span>
                  <span className={styles.rowHint}>
                    Checks GitHub Releases once per day. You can turn this off anytime.
                  </span>
                </div>
                <Switch
                  checked={updateChecks}
                  label="Daily update checks"
                  onChange={setUpdateChecks}
                />
              </div>
            </div>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <div>
              <h1 className={styles.stepTitle}>Optional sensors &amp; startup</h1>
              <p className={styles.stepDesc}>
                Choose whether to enable root-only power sensors and automatic login startup.
              </p>
            </div>

            <div className={styles.card}>
              <div className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowLabel}>Show CPU power and full SSD health</span>
                  <span className={styles.rowHint}>
                    Uses Opaline&apos;s read-only polkit helper to read Intel/AMD RAPL energy
                    counters (active local session only).
                  </span>
                </div>
                <Switch
                  checked={privilegedSensors}
                  label="Show CPU power and full SSD health"
                  onChange={setPrivilegedSensors}
                />
              </div>

              <div className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowLabel}>Start Opaline automatically on login</span>
                  <span className={styles.rowHint}>
                    Recommended so your widgets appear right on your desktop after signing in.
                  </span>
                </div>
                <Switch checked={startOnLogin} label="Start on login" onChange={setStartOnLogin} />
              </div>
            </div>
          </>
        ) : null}

        {step === 5 ? (
          <div className={styles.hero} style={wallpaperBg}>
            <div className={styles.heroScrim} />
            <div className={styles.heroContent}>
              <Icon name="check" size={44} />
              <h1 className={styles.title}>You&apos;re all set</h1>
              <p className={styles.subtitle}>
                Your <strong>{preset.name}</strong> layout is ready. Press <code>Super+Alt+W</code>{" "}
                to Peek anytime, or <code>Super+Alt+E</code> (or long-press any widget) to arrange
                your desktop.
              </p>
              <div className={styles.inlineRow}>
                <Button
                  variant="filled"
                  icon="check"
                  disabled={saving || done}
                  onClick={() => {
                    void handleFinish(false);
                  }}
                >
                  {saving ? "Placing widgets…" : "Finish"}
                </Button>
                <Button
                  variant="tonal"
                  icon="edit"
                  disabled={saving || done}
                  onClick={() => {
                    void handleFinish(true);
                  }}
                >
                  Finish &amp; edit layout
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </main>

      <footer className={styles.footer}>
        {step > 0 ? (
          <Button
            variant="text"
            onClick={() => {
              setStep((s) => Math.max(0, s - 1));
            }}
          >
            Back
          </Button>
        ) : (
          <Button
            variant="text"
            onClick={() => {
              void handleFinish(false);
            }}
          >
            Skip setup
          </Button>
        )}

        {step < TOTAL_STEPS - 1 ? (
          <Button
            variant="filled"
            onClick={() => {
              setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1));
            }}
          >
            {step === 0 ? "Get started" : "Next"}
          </Button>
        ) : null}
      </footer>

      {toast ? (
        <div style={{ position: "fixed", bottom: 18, right: 24, zIndex: 40 }}>
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
