// Quick Controls widget (brief §8.2, ADR 0016, PLAN-2 7.1):
// GNOME 50 Quick Settings toggles, volume & display brightness sliders, and validated launchers
// with optimistic UI + rollback on error.
import { useRef, useState } from "react";
import { Icon, type IconName } from "../design-system/icons";
import { useHost } from "./host";
import { toJson } from "./json";
import styles from "./p7Widgets.module.css";
import type { RenderCtx, WidgetDef } from "./types";

interface ControlsState {
  wifi?: boolean | null;
  bluetooth?: boolean | null;
  airplane?: boolean | null;
  dnd?: boolean | null;
  nightLight?: boolean | null;
  darkStyle?: boolean | null;
  keepAwake?: boolean | null;
  outputVolume?: number | null;
  outputMuted?: boolean | null;
  backlights?: { connector: string; percent: number }[];
}

interface ToggleDef {
  id: string;
  key: keyof ControlsState;
  label: string;
  icon: IconName;
}

const TOGGLES: readonly ToggleDef[] = [
  { id: "wifi", key: "wifi", label: "Wi-Fi", icon: "wifi" },
  { id: "bluetooth", key: "bluetooth", label: "Bluetooth", icon: "settings" },
  { id: "dnd", key: "dnd", label: "DND", icon: "notifications" },
  { id: "night-light", key: "nightLight", label: "Night Light", icon: "dark_mode" },
  { id: "dark-style", key: "darkStyle", label: "Dark", icon: "contrast" },
  { id: "keep-awake", key: "keepAwake", label: "Awake", icon: "bolt" },
  { id: "airplane", key: "airplane", label: "Airplane", icon: "air" },
];

function QuickControlsBody({ ctx }: { ctx: RenderCtx }) {
  const host = useHost();
  const raw = toJson(ctx.get("controls.state"));
  const state = (
    typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}
  ) as ControlsState;

  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const [sliderDraft, setSliderDraft] = useState<Record<string, number>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const lastSliderSent = useRef(0);

  const layout = ctx.content.opt<string>("layout");
  const singleControl = ctx.content.opt<string>("singleControl");

  const availableToggles = TOGGLES.filter((t) => typeof state[t.key] === "boolean");
  const togglesToShow =
    availableToggles.length > 0 ? availableToggles : TOGGLES.slice(0, ctx.size === "S" ? 4 : 6);

  const isOn = (t: ToggleDef) =>
    t.id in optimistic ? Boolean(optimistic[t.id]) : Boolean(state[t.key]);

  const handleToggle = (t: ToggleDef) => {
    const next = !isOn(t);
    setOptimistic((p) => ({ ...p, [t.id]: next }));
    setErrorMsg(null);
    void host
      .command({ cmd: "control-toggle", control: t.id, enabled: next })
      .then((res) => {
        if (res.result === "err") {
          setOptimistic((p) => {
            const copy = { ...p };
            Reflect.deleteProperty(copy, t.id);
            return copy;
          });
          setErrorMsg(res.reason);
        }
        void host.command({ cmd: "release-focus" });
      })
      .catch(() => {
        setOptimistic((p) => {
          const copy = { ...p };
          Reflect.deleteProperty(copy, t.id);
          return copy;
        });
      });
  };

  const handleSlider = (control: string, percent: number, target?: string) => {
    setSliderDraft((p) => ({ ...p, [control]: percent }));
    const now = Date.now();
    if (now - lastSliderSent.current < 150) return;
    lastSliderSent.current = now;
    void host.command({
      cmd: "control-set-slider",
      control,
      percent,
      ...(target ? { target } : {}),
    });
  };

  if (ctx.size === "1x1" || layout === "single") {
    const picked = TOGGLES.find((t) => t.id === singleControl) ?? TOGGLES[0];
    if (!picked) return null;
    const on = isOn(picked);
    return (
      <div className={styles.wrap} style={{ justifyContent: "center", alignItems: "center" }}>
        <button
          type="button"
          data-interactive="true"
          aria-pressed={on}
          aria-label={`Toggle ${picked.label}`}
          className={`${styles.ctrlPill} ${on ? styles.ctrlPillOn : ""}`}
          style={{
            width: "100%",
            height: "100%",
            justifyContent: "center",
            flexDirection: "column",
          }}
          onClick={() => {
            handleToggle(picked);
          }}
        >
          <Icon name={picked.icon} size={24} fill={on ? 1 : 0} />
          <span>{picked.label}</span>
        </button>
      </div>
    );
  }

  const vol = sliderDraft["output-volume"] ?? state.outputVolume ?? 60;
  const firstBacklight = state.backlights?.[0];
  const bright = sliderDraft.brightness ?? firstBacklight?.percent ?? 75;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>
          <Icon name="tune" size={16} /> {ctx.content.title || "Quick Controls"}
        </span>
        {errorMsg ? <span className={styles.sub}>{errorMsg}</span> : null}
      </div>

      {layout !== "sliders" ? (
        <div className={styles.pillGrid}>
          {togglesToShow
            .slice(0, ctx.size === "2x1" ? 2 : ctx.size === "S" ? 4 : ctx.size === "M" ? 3 : 6)
            .map((t) => {
              const on = isOn(t);
              return (
                <button
                  key={t.id}
                  type="button"
                  data-interactive="true"
                  aria-pressed={on}
                  className={`${styles.ctrlPill} ${on ? styles.ctrlPillOn : ""}`}
                  onClick={() => {
                    handleToggle(t);
                  }}
                >
                  <Icon name={t.icon} size={15} fill={on ? 1 : 0} />
                  <span>{t.label}</span>
                </button>
              );
            })}
        </div>
      ) : null}

      {ctx.size !== "2x1" && ctx.size !== "S" ? (
        <div className={styles.sliders}>
          <label className={styles.sliderRow}>
            <Icon name="volume_up" size={16} fill={state.outputMuted ? 0 : 1} />
            <input
              type="range"
              data-interactive="true"
              aria-label="Output volume"
              min={0}
              max={100}
              value={Math.round(vol)}
              className={styles.range}
              onChange={(e) => {
                handleSlider("output-volume", Number(e.target.value));
              }}
            />
            <span className={styles.sub}>{Math.round(vol)}%</span>
          </label>
          <label className={styles.sliderRow}>
            <Icon name="light_mode" size={16} />
            <input
              type="range"
              data-interactive="true"
              aria-label="Display brightness"
              min={5}
              max={100}
              value={Math.round(bright)}
              className={styles.range}
              onChange={(e) => {
                handleSlider("brightness", Number(e.target.value), firstBacklight?.connector);
              }}
            />
            <span className={styles.sub}>{Math.round(bright)}%</span>
          </label>
        </div>
      ) : null}
    </div>
  );
}

export const controlsWidget: WidgetDef = {
  kind: "controls",
  name: "Quick Controls",
  icon: "tune",
  category: "system",
  sizes: ["1x1", "2x1", "S", "M", "L"],
  defaultSize: "M",
  topics: ["controls.state"],
  fields: [],
  defaultFields: [],
  options: [
    {
      kind: "enum",
      key: "layout",
      label: "Layout",
      default: "grid",
      options: [
        { value: "grid", label: "Toggles & sliders" },
        { value: "single", label: "Single toggle" },
        { value: "sliders", label: "Sliders only" },
      ],
    },
    {
      kind: "enum",
      key: "singleControl",
      label: "Single toggle control",
      default: "wifi",
      options: TOGGLES.map((t) => ({ value: t.id, label: t.label })),
    },
  ],
  status: () => ({ kind: "ready" }),
  render: (ctx) => <QuickControlsBody ctx={ctx} />,
};
