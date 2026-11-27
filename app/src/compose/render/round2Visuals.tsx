// Built-in canvas visuals for Phase 4 Round 2 (Storage, Network, Battery & Power, Fans —
// PLAN-2 4.5–4.8, brief §8.1):
// - `drive-list`: several drives as bars or rings with health badges, temperatures, sorting &
//   include/exclude mount filters.
// - `net-wave`: dual-wave hero whose speed and amplitude scale with download/upload throughput.
// - `wifi-shape`: Wi-Fi signal strength arcs + band badge.
// - `battery-pill`: liquid-filled pill with rising bubbles while charging (0 frames when idle/still).
// - `peripheral-list`: wireless peripheral batteries with device-type icons.
// - `fan-spinner`: fan blade glyph rotating in proportion to RPM (static under reduced motion/still).
// - `fan-gauges`: per-fan semicircular RPM gauges.
import { useEffect, useRef } from "react";
import { Icon, type IconName } from "../../design-system/icons";
import { reducedMotion, scheduler } from "../../design-system/motion/scheduler";
import type { Value } from "../../expr";
import type { VisualProps } from "./clockVisuals";
import { cssColor } from "./context";
import styles from "./visuals.module.css";

const num = (v: Value | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: Value | undefined): string => (typeof v === "string" ? v : "");
const isMap = (v: Value | undefined): v is Record<string, Value> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function fmtBytes(b: number, binary: boolean): string {
  const base = binary ? 1024 : 1000;
  const units = binary ? ["B", "KiB", "MiB", "GiB", "TiB"] : ["B", "kB", "MB", "GB", "TB"];
  let v = Math.abs(b);
  let i = 0;
  while (v >= base && i < units.length - 1) {
    v /= base;
    i++;
  }
  return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i] ?? "B"}`;
}

function fmtRate(bps: number, bytesMode: boolean): string {
  if (bytesMode) return `${fmtBytes(bps, false)}/s`;
  const units = ["bit/s", "kbit/s", "Mbit/s", "Gbit/s"];
  let v = Math.max(0, bps) * 8;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i] ?? "bit/s"}`;
}

function splitCsv(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

interface DriveRow {
  drive: string;
  mount: string;
  model: string;
  percent: number;
  availB: number | null;
  totalB: number | null;
  tempC: number | null;
  health: string | null;
}

/** 4.5 Storage: multi-drive bars or rings with health badges, temps, sorting & mount filters. */
export function DriveListVisual({ params, label }: VisualProps) {
  const drivesRaw = Array.isArray(params.drives) ? params.drives : [];
  const tempsMap = isMap(params.temps) ? params.temps : {};
  const healthMap = isMap(params.health) ? params.health : {};
  const mode = str(params.mode) || "bars";
  const sortBy = str(params.sortBy) || "default";
  const binary = params.binary === true;
  const tempF = params.tempUnit === "f";
  const max = num(params.max) ?? 4;
  const include = splitCsv(str(params.include));
  const exclude = splitCsv(str(params.exclude));

  const rows: DriveRow[] = [];
  for (const d of drivesRaw) {
    if (!isMap(d)) continue;
    const drive = str(d.name) || "?";
    const model = str(d.model) || drive;
    const parts = Array.isArray(d.partitions) ? d.partitions : [];
    const tObj = tempsMap[drive];
    const hObj = healthMap[drive];
    const tempC = (isMap(tObj) ? num(tObj.tempC) : null) ?? (isMap(hObj) ? num(hObj.tempC) : null);
    const health = isMap(hObj) ? str(hObj.status) || null : null;
    for (const p of parts) {
      if (!isMap(p)) continue;
      const mount = str(p.mount);
      if (!mount) continue;
      if (include.length > 0 && !include.includes(mount)) continue;
      if (exclude.includes(mount)) continue;
      rows.push({
        drive,
        mount,
        model,
        percent: num(p.percent) ?? 0,
        availB: num(p.availB),
        totalB: num(p.totalB),
        tempC,
        health,
      });
    }
  }

  if (sortBy === "percent") rows.sort((a, b) => b.percent - a.percent);
  else if (sortBy === "free") rows.sort((a, b) => (b.availB ?? 0) - (a.availB ?? 0));
  else if (sortBy === "name") rows.sort((a, b) => a.mount.localeCompare(b.mount));

  const shown = rows.slice(0, max);
  if (shown.length === 0) return null;

  if (mode === "rings") {
    const r = 20;
    const circ = 2 * Math.PI * r;
    return (
      <div className={styles.driveRingsWrap} role="list" aria-label={label ?? "Drives"}>
        {shown.map((d) => {
          const pct = Math.max(0, Math.min(100, d.percent));
          const dash = (pct / 100) * circ;
          return (
            <div key={`${d.drive}-${d.mount}`} className={styles.driveRingItem} role="listitem">
              <div className={styles.driveRingBox}>
                <svg viewBox="0 0 50 50" className={styles.driveRingSvg} aria-hidden>
                  <circle cx="25" cy="25" r={r} className={styles.dayTrack} strokeWidth="5" />
                  <circle
                    cx="25"
                    cy="25"
                    r={r}
                    className={styles.dayValue}
                    strokeWidth="5"
                    strokeDasharray={`${dash.toFixed(1)} ${circ.toFixed(1)}`}
                    transform="rotate(-90 25 25)"
                  />
                </svg>
                <span className={styles.driveRingPct}>{Math.round(pct)}%</span>
              </div>
              <span className={styles.driveRingMount}>{d.mount}</span>
              {d.availB !== null ? (
                <span className={styles.driveRingSub}>{fmtBytes(d.availB, binary)} free</span>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={styles.driveListWrap} role="list" aria-label={label ?? "Drives"}>
      {shown.map((d) => {
        const pct = Math.max(0, Math.min(100, d.percent));
        const tempTxt =
          d.tempC !== null
            ? `${String(Math.round(tempF ? (d.tempC * 9) / 5 + 32 : d.tempC))}${tempF ? "°F" : "°"}`
            : null;
        const badHealth = d.health && d.health !== "good";
        return (
          <div key={`${d.drive}-${d.mount}`} className={styles.driveRow} role="listitem">
            <div className={styles.driveRowHead}>
              <span className={styles.driveMount}>{d.mount}</span>
              <span className={styles.driveMeta}>
                {d.availB !== null ? `${fmtBytes(d.availB, binary)} free` : `${Math.round(pct)}%`}
                {tempTxt ? ` · ${tempTxt}` : ""}
              </span>
              {d.health ? (
                <span className={badHealth ? styles.healthWarn : styles.healthOk}>
                  {d.health === "good" ? "OK" : d.health}
                </span>
              ) : null}
            </div>
            <div className={styles.engineTrack}>
              <div
                className={styles.engineFill}
                style={{
                  width: `${pct.toFixed(1)}%`,
                  background: pct >= 90 ? "rgb(var(--md-error))" : undefined,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Builds a smooth dual-wave curve in a 200 × 80 viewBox. */
export function netWavePath(amp: number, phase: number, baseline: number): string {
  const steps = 28;
  let d = `M 0 80 L 0 ${(baseline + Math.sin(phase) * amp).toFixed(2)}`;
  for (let i = 1; i <= steps; i++) {
    const x = (i / steps) * 200;
    const t = (i / steps) * Math.PI * 3 + phase;
    const y = baseline + Math.sin(t) * amp + Math.sin(t * 0.5) * (amp * 0.4);
    d += ` L ${x.toFixed(1)} ${y.toFixed(2)}`;
  }
  d += " L 200 80 Z";
  return d;
}

/** 4.6 Network: dual-wave hero whose speed follows download & upload throughput. */
export function NetWaveVisual({ params, label, animate = false }: VisualProps) {
  const rx = Math.max(0, num(params.rxBps) ?? 0);
  const tx = Math.max(0, num(params.txBps) ?? 0);
  const lineBps = Math.max(125_000, (num(params.lineMbps) ?? 100) * 125_000);
  const bytesMode = params.rateUnit === "bytes";
  const rxRatio = Math.min(1, rx / lineBps);
  const txRatio = Math.min(1, tx / lineBps);
  const rxAmp = 3 + rxRatio * 14;
  const txAmp = 2 + txRatio * 11;
  const rxPathRef = useRef<SVGPathElement>(null);
  const txPathRef = useRef<SVGPathElement>(null);

  const moving = animate && !reducedMotion() && rx + tx > 1024;
  useEffect(() => {
    if (!moving) return;
    let pRx = 0;
    let pTx = 1.2;
    const sRx = 1.2 + rxRatio * 5.0;
    const sTx = 1.0 + txRatio * 4.5;
    const animator = {
      ambient: true,
      step(dt: number) {
        pRx += dt * sRx;
        pTx -= dt * sTx;
        rxPathRef.current?.setAttribute("d", netWavePath(rxAmp, pRx, 52 - rxRatio * 14));
        txPathRef.current?.setAttribute("d", netWavePath(txAmp, pTx, 62 - txRatio * 10));
        return true;
      },
    };
    scheduler.add(animator);
    return () => {
      scheduler.remove(animator);
    };
  }, [moving, rxAmp, txAmp, rxRatio, txRatio]);

  return (
    <div className={styles.netWaveWrap} role="img" aria-label={label ?? "Network throughput"}>
      <svg viewBox="0 0 200 80" preserveAspectRatio="none" className={styles.liquidSvg} aria-hidden>
        <path
          ref={txPathRef}
          d={netWavePath(txAmp, 1.2, 62 - txRatio * 10)}
          fill="rgb(var(--md-tertiary))"
          fillOpacity={0.28}
        />
        <path
          ref={rxPathRef}
          d={netWavePath(rxAmp, 0, 52 - rxRatio * 14)}
          fill="rgb(var(--md-primary))"
          fillOpacity={0.38}
        />
      </svg>
      <div className={styles.netWaveOverlay}>
        <div className={styles.netRateLine}>
          <span className={styles.netArrowDown}>↓</span>
          <span className={styles.netRateVal}>{fmtRate(rx, bytesMode)}</span>
        </div>
        <div className={styles.netRateLineSub}>
          <span className={styles.netArrowUp}>↑</span>
          <span>{fmtRate(tx, bytesMode)}</span>
        </div>
      </div>
    </div>
  );
}

/** 4.6 Network: Wi-Fi signal strength arcs + band badge. */
export function WifiShapeVisual({ params, label }: VisualProps) {
  const signal = num(params.signal);
  const band = str(params.band);
  const ssid = str(params.ssid);
  const showSsid = params.showSsid !== false;
  if (signal === null) return null;
  const bars = signal >= 75 ? 4 : signal >= 50 ? 3 : signal >= 25 ? 2 : signal > 0 ? 1 : 0;

  return (
    <div
      className={styles.wifiWrap}
      role="img"
      aria-label={label ?? `Wi-Fi ${Math.round(signal)}%`}
    >
      <svg viewBox="0 0 48 40" className={styles.wifiSvg} aria-hidden>
        {[
          { r: 22, idx: 4 },
          { r: 16, idx: 3 },
          { r: 10, idx: 2 },
        ].map(({ r, idx }) => (
          <path
            key={idx}
            d={`M ${(24 - r * 0.72).toFixed(1)} ${(32 - r * 0.7).toFixed(1)} A ${r} ${r} 0 0 1 ${(24 + r * 0.72).toFixed(1)} ${(32 - r * 0.7).toFixed(1)}`}
            fill="none"
            strokeWidth="3.2"
            strokeLinecap="round"
            className={bars >= idx ? styles.wifiArcOn : styles.wifiArcOff}
          />
        ))}
        <circle
          cx="24"
          cy="33"
          r="3"
          className={bars >= 1 ? styles.wifiDotOn : styles.wifiDotOff}
        />
      </svg>
      <div className={styles.wifiInfo}>
        {showSsid && ssid ? <span className={styles.wifiSsid}>{ssid}</span> : null}
        <span className={styles.faceMeta}>
          {Math.round(signal)}%{band ? ` · ${band}` : ""}
        </span>
      </div>
    </div>
  );
}

/** 4.7 Battery & Power: liquid-filled pill with bubbles while charging. */
export function BatteryPillVisual({ params, label, animate = false }: VisualProps) {
  const pct = Math.max(0, Math.min(100, num(params.percent) ?? 0));
  const state = str(params.state);
  const sub = str(params.sub);
  const charging = state === "charging";
  const color =
    cssColor(params.color ?? null) ??
    (pct <= 15 && !charging
      ? "rgb(var(--md-error))"
      : charging
        ? "rgb(var(--md-tertiary))"
        : "rgb(var(--md-primary))");
  const b1 = useRef<SVGCircleElement>(null);
  const b2 = useRef<SVGCircleElement>(null);
  const b3 = useRef<SVGCircleElement>(null);

  const shouldBubble = charging && animate && !reducedMotion();
  useEffect(() => {
    if (!shouldBubble) return;
    let t = 0;
    const animator = {
      ambient: true,
      step(dt: number) {
        t += dt;
        const move = (el: SVGCircleElement | null, speed: number, offset: number) => {
          if (!el) return;
          const prog = (t * speed + offset) % 1;
          const x = 10 + prog * Math.max(10, pct * 1.65);
          el.setAttribute("cx", x.toFixed(1));
          el.setAttribute("opacity", (Math.sin(prog * Math.PI) * 0.55).toFixed(2));
        };
        move(b1.current, 0.45, 0);
        move(b2.current, 0.35, 0.38);
        move(b3.current, 0.52, 0.72);
        return true;
      },
    };
    scheduler.add(animator);
    return () => {
      scheduler.remove(animator);
    };
  }, [shouldBubble, pct]);

  return (
    <div
      className={styles.batPillOuter}
      role="meter"
      aria-label={label ?? `Battery ${Math.round(pct)}%`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <div className={styles.batPillBody}>
        <svg
          viewBox="0 0 180 64"
          preserveAspectRatio="none"
          className={styles.liquidSvg}
          aria-hidden
        >
          <rect x="0" y="0" width={pct * 1.8} height="64" fill={color} fillOpacity={0.38} />
          {charging ? (
            <>
              <circle ref={b1} cx={pct * 0.5} cy="22" r="3" fill={color} opacity="0.45" />
              <circle ref={b2} cx={pct * 0.9} cy="40" r="2.2" fill={color} opacity="0.38" />
              <circle ref={b3} cx={pct * 1.2} cy="30" r="2.6" fill={color} opacity="0.42" />
            </>
          ) : null}
        </svg>
        <div className={styles.batPillContent}>
          <div className={styles.batPillMain}>
            {charging ? <Icon name="bolt" size={18} fill={1} /> : null}
            <span className={styles.batPillPct}>{Math.round(pct)}%</span>
          </div>
          {sub ? <span className={styles.batPillSub}>{sub}</span> : null}
        </div>
      </div>
      <div className={styles.batPillCap} aria-hidden />
    </div>
  );
}

function peripheralIcon(kind: string): IconName {
  switch (kind) {
    case "mouse":
    case "keyboard":
    case "gaming-input":
      return "usb";
    case "headphones":
    case "headset":
    case "speakers":
    case "other-audio":
      return "volume_up";
    case "phone":
    case "tablet":
    case "wearable":
      return "battery_full";
    default:
      return "device_hub";
  }
}

/** 4.7 Battery & Power: peripheral devices with device-type icons and battery bars. */
export function PeripheralListVisual({ params, label }: VisualProps) {
  const list = Array.isArray(params.devices) ? params.devices : [];
  const max = num(params.max) ?? 4;
  const rows = list
    .filter(isMap)
    .map((d) => ({
      kind: str(d.kind) || "unknown",
      name: str(d.model) || str(d.kind) || "Device",
      percent: num(d.percent),
    }))
    .slice(0, max);
  if (rows.length === 0) return null;

  return (
    <div className={styles.appListWrap} role="list" aria-label={label ?? "Connected devices"}>
      {rows.map((d, i) => (
        <div key={`${d.name}-${String(i)}`} className={styles.appRow} role="listitem">
          <Icon name={peripheralIcon(d.kind)} size={16} />
          <span className={styles.appName}>{d.name}</span>
          <span className={styles.appStat}>
            {d.percent !== null ? `${Math.round(d.percent)}%` : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 4.8 Fans: spinning fan blade glyph scaled by RPM (static under reduced motion/still/0 RPM). */
export function FanSpinnerVisual({ params, label, animate = false }: VisualProps) {
  const rpm = Math.max(0, num(params.rpm) ?? 0);
  const maxRpm = Math.max(1000, num(params.maxRpm) ?? 6000);
  const name = str(params.name);
  const ratio = Math.min(1, rpm / maxRpm);
  const rotorRef = useRef<SVGGElement>(null);

  const shouldSpin = animate && !reducedMotion() && rpm > 0;
  useEffect(() => {
    if (!shouldSpin) return;
    let angle = 0;
    // 1.0 to 4.5 revolutions/sec proportional to RPM ratio.
    const degPerSec = 180 + ratio * 900;
    const animator = {
      ambient: true,
      step(dt: number) {
        angle = (angle + dt * degPerSec) % 360;
        rotorRef.current?.setAttribute("transform", `rotate(${angle.toFixed(1)} 50 50)`);
        return true;
      },
    };
    scheduler.add(animator);
    return () => {
      scheduler.remove(animator);
    };
  }, [shouldSpin, ratio]);

  return (
    <div
      className={styles.fanSpinWrap}
      role="img"
      aria-label={label ?? `Fan ${Math.round(rpm)} rpm`}
    >
      <svg viewBox="0 0 100 100" className={styles.fanSvg} aria-hidden>
        <circle cx="50" cy="50" r="45" className={styles.face} />
        <g ref={rotorRef}>
          {[0, 72, 144, 216, 288].map((deg) => (
            <path
              key={deg}
              d="M 50 50 C 56 32, 66 16, 52 10 C 42 8, 38 24, 46 44 Z"
              transform={`rotate(${String(deg)} 50 50)`}
              className={styles.fanBlade}
            />
          ))}
          <circle cx="50" cy="50" r="9" className={styles.fanHub} />
        </g>
      </svg>
      <div className={styles.fanMeta}>
        <span className={styles.fanRpm}>{rpm === 0 ? "Quiet" : `${Math.round(rpm)} rpm`}</span>
        {name ? <span className={styles.faceMeta}>{name}</span> : null}
      </div>
    </div>
  );
}

/** 4.8 Fans: per-fan semicircular RPM gauges. */
export function FanGaugesVisual({ params, label }: VisualProps) {
  const list = Array.isArray(params.fans) ? params.fans : [];
  const defaultMax = Math.max(1000, num(params.maxRpm) ?? 6000);
  const items = list
    .filter(isMap)
    .map((f, idx) => {
      const rpm = num(f.rpm) ?? 0;
      const max = num(f.maxRpm) ?? defaultMax;
      return {
        name: str(f.name) || `Fan ${String(idx + 1)}`,
        rpm,
        ratio: Math.max(0, Math.min(1, rpm / Math.max(1, max))),
      };
    })
    .slice(0, 6);
  if (items.length === 0) return null;

  const r = 20;
  const semi = Math.PI * r;
  return (
    <div className={styles.fanGaugesWrap} role="list" aria-label={label ?? "Fan gauges"}>
      {items.map((f, idx) => (
        <div key={`${f.name}-${String(idx)}`} className={styles.fanGaugeItem} role="listitem">
          <svg viewBox="0 0 50 30" className={styles.fanGaugeSvg} aria-hidden>
            <path d="M 5 26 A 20 20 0 0 1 45 26" className={styles.dayTrack} strokeWidth="4.5" />
            <path
              d="M 5 26 A 20 20 0 0 1 45 26"
              className={styles.dayValue}
              strokeWidth="4.5"
              strokeDasharray={`${(f.ratio * semi).toFixed(1)} ${semi.toFixed(1)}`}
            />
          </svg>
          <span className={styles.fanGaugeVal}>{f.rpm === 0 ? "Off" : `${Math.round(f.rpm)}`}</span>
          <span className={styles.fanGaugeName}>{f.name}</span>
        </div>
      ))}
    </div>
  );
}
