// Sun & Moon widget (brief §8.4, PLAN-2 7.4):
// Pure offline solar & lunar astronomy: sun path arc with live position, golden/blue hour,
// sunrise & sunset times, and moon phase + illumination %.
import { Icon } from "../design-system/icons";
import { useHost } from "./host";
import styles from "./p7Widgets.module.css";
import type { RenderCtx, WidgetDef } from "./types";

export interface SunMoonInfo {
  sunriseMin: number;
  sunsetMin: number;
  dayProgress: number;
  moonPhaseName: string;
  moonIllumPct: number;
  goldenHourEvening: string;
}

function fmtMin(totalMin: number): string {
  const wrapped = ((Math.round(totalMin) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Offline solar/lunar approximation using day-of-year declination & synodic lunar period. */
export function computeSunMoon(now: Date, latDeg = 52.5): SunMoonInfo {
  const startOfYear = new Date(now.getFullYear(), 0, 0).getTime();
  const dayOfYear = Math.floor((now.getTime() - startOfYear) / 86_400_000);

  // Solar declination & half-day length approximation.
  const declRad = ((23.44 * Math.PI) / 180) * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81));
  const latRad = (Math.max(-65, Math.min(65, latDeg)) * Math.PI) / 180;
  const cosH = Math.max(-0.98, Math.min(0.98, -Math.tan(latRad) * Math.tan(declRad)));
  const halfDayMin = ((Math.acos(cosH) * 180) / Math.PI) * 4;
  const solarNoonMin = 12 * 60 + 20;
  const sunriseMin = solarNoonMin - halfDayMin;
  const sunsetMin = solarNoonMin + halfDayMin;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const dayProgress = Math.max(
    0,
    Math.min(1, (nowMin - sunriseMin) / Math.max(1, sunsetMin - sunriseMin)),
  );

  // Synodic month (29.53058867 days) anchored to known New Moon 2000-01-06 18:14 UTC.
  const knownNewMoonMs = Date.UTC(2000, 0, 6, 18, 14, 0);
  const synodicDays = 29.53058867;
  const ageDays =
    ((((now.getTime() - knownNewMoonMs) / 86_400_000) % synodicDays) + synodicDays) % synodicDays;
  const frac = ageDays / synodicDays;
  const moonIllumPct = Math.round(((1 - Math.cos(2 * Math.PI * frac)) / 2) * 100);
  const moonPhaseName =
    frac < 0.06 || frac >= 0.94
      ? "New Moon"
      : frac < 0.22
        ? "Waxing Crescent"
        : frac < 0.28
          ? "First Quarter"
          : frac < 0.44
            ? "Waxing Gibbous"
            : frac < 0.56
              ? "Full Moon"
              : frac < 0.72
                ? "Waning Gibbous"
                : frac < 0.78
                  ? "Last Quarter"
                  : "Waning Crescent";

  return {
    sunriseMin,
    sunsetMin,
    dayProgress,
    moonPhaseName,
    moonIllumPct,
    goldenHourEvening: `${fmtMin(sunsetMin - 45)}–${fmtMin(sunsetMin)}`,
  };
}

function SunMoonBody({ ctx }: { ctx: RenderCtx }) {
  const host = useHost();
  const now = host.now ? host.now() : new Date();
  const lat = Number(ctx.content.opt<string>("latitude")) || 52.5;
  const info = computeSunMoon(now, lat);

  // Position dot along quadratic bezier sun arc.
  const t = info.dayProgress;
  const x = 16 + t * 188;
  const y = 64 - Math.sin(t * Math.PI) * 44;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>
          <Icon name="light_mode" size={16} /> Sun &amp; Moon
        </span>
        <span className={styles.badge}>
          {info.moonPhaseName} · {info.moonIllumPct}%
        </span>
      </div>

      <svg
        viewBox="0 0 220 76"
        style={{ width: "100%", height: 68, overflow: "visible" }}
        aria-hidden="true"
      >
        <line
          x1="12"
          y1="64"
          x2="208"
          y2="64"
          stroke="currentColor"
          strokeOpacity="0.24"
          strokeDasharray="3 3"
        />
        <path
          d="M 16 64 Q 110 -18 204 64"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="2.5"
        />
        <circle cx={x} cy={y} r="6.5" fill="rgb(var(--md-primary, 255 204 102))" />
      </svg>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.74rem" }}>
        <span>Rise {fmtMin(info.sunriseMin)}</span>
        <span className={styles.sub}>Golden {info.goldenHourEvening}</span>
        <span>Set {fmtMin(info.sunsetMin)}</span>
      </div>
    </div>
  );
}

export const sunMoonWidget: WidgetDef = {
  kind: "sun-moon",
  name: "Sun & Moon",
  icon: "light_mode",
  category: "info",
  sizes: ["2x1", "S", "M"],
  defaultSize: "M",
  topics: [],
  fields: [],
  defaultFields: [],
  options: [
    {
      kind: "text",
      key: "latitude",
      label: "Latitude (°)",
      default: "52.5",
      maxLength: 16,
    },
  ],
  status: () => ({ kind: "ready" }),
  render: (ctx) => <SunMoonBody ctx={ctx} />,
};
