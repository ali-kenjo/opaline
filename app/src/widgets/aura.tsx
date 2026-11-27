// Aura widget (brief §8.4, PLAN-2 7.4):
// Decorative data-driven ambient gradient reacting to time of day, weather condition, and
// wallpaper seed color — redraws strictly when inputs change (0 idle frames).
import { useHost } from "./host";
import { toJson } from "./json";
import styles from "./p7Widgets.module.css";
import type { RenderCtx, WidgetDef } from "./types";

function auraGradient(
  hour: number,
  condition: string,
  accentHex: string,
): { bg: string; label: string } {
  const cond = condition.toLowerCase();
  if (cond.includes("rain") || cond.includes("storm")) {
    return {
      bg: `radial-gradient(circle at 22% 25%, #3b82f6, #1e293b 62%, ${accentHex}55)`,
      label: "Rainy Aura",
    };
  }
  if (hour >= 5 && hour < 9) {
    return {
      bg: `radial-gradient(circle at 20% 20%, #f59e0b, #ec4899 55%, #1e1b4b)`,
      label: "Dawn Aura",
    };
  }
  if (hour >= 9 && hour < 17) {
    return {
      bg: `radial-gradient(circle at 25% 20%, #38bdf8, ${accentHex} 60%, #0f172a)`,
      label: "Daylight Aura",
    };
  }
  if (hour >= 17 && hour < 21) {
    return {
      bg: `radial-gradient(circle at 75% 25%, #fb7185, #8b5cf6 58%, #1e1b4b)`,
      label: "Dusk Aura",
    };
  }
  return {
    bg: `radial-gradient(circle at 30% 30%, #312e81, ${accentHex}88 60%, #090d1a)`,
    label: "Night Aura",
  };
}

function AuraBody({ ctx }: { ctx: RenderCtx }) {
  const host = useHost();
  const now = host.now ? host.now() : new Date();
  const weather = toJson(ctx.get("weather.current"));
  const condition =
    typeof weather === "object" &&
    weather !== null &&
    !Array.isArray(weather) &&
    typeof weather.condition === "string"
      ? weather.condition
      : "";
  const seedHex = `#${(host.colors.wallpaper & 0xffffff).toString(16).padStart(6, "0")}`;
  const { bg, label } = auraGradient(now.getHours(), condition, seedHex);
  const showLabel = ctx.content.opt<boolean>("showLabel");

  return (
    <div className={styles.auraFill} style={{ background: bg }}>
      {showLabel ? (
        <span
          style={{
            fontSize: "0.78rem",
            fontWeight: 600,
            color: "#f8fafc",
            textShadow: "0 1px 4px rgba(0,0,0,0.45)",
          }}
        >
          {condition ? `${label} · ${condition}` : label}
        </span>
      ) : null}
    </div>
  );
}

export const auraWidget: WidgetDef = {
  kind: "aura",
  name: "Aura",
  icon: "palette",
  category: "info",
  sizes: ["1x1", "2x1", "S", "M", "L"],
  defaultSize: "S",
  topics: ["weather.current"],
  fields: [],
  defaultFields: [],
  options: [
    {
      kind: "bool",
      key: "showLabel",
      label: "Show mood label",
      default: true,
    },
  ],
  status: () => ({ kind: "ready" }),
  render: (ctx) => <AuraBody ctx={ctx} />,
};
