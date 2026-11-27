// Built-in canvas visuals for Phase 4 Round 3 (Processes 4.9 & Now Playing 4.10, brief §8.1):
// - `process-table`: real cached app icons (fallback letter badge, never `⠿`), CPU / RAM /
//   Disk I/O columns, optional GPU load pill, Apps/Processes toggle, inline search filter,
//   and 2-step confirmed End task.
// - `now-playing`: Card (blurred glass art backdrop + breathing Material shape mask), Vinyl
//   (spinning grooved disc), and Cassette (dual-reel retro shell) looks, synced `.lrc` lyrics,
//   seekable wavy progress bar, shuffle/repeat/volume controls, and inline player switcher.
import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { WavyProgress } from "../../design-system/components/WavyProgress";
import { Icon } from "../../design-system/icons";
import { type Animator, reducedMotion, scheduler } from "../../design-system/motion";
import { type MaterialShapeName, materialShape } from "../../design-system/shapes";
import type { Value } from "../../expr";
import type { Command, CommandResult } from "../../layer/protocol";
import { HostContext } from "../../widgets/host";
import type { VisualProps } from "./clockVisuals";
import { useView } from "./context";
import styles from "./round3Visuals.module.css";

const num = (v: Value | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: Value | undefined): string => (typeof v === "string" ? v : "");
const bool = (v: Value | undefined): boolean | null => (typeof v === "boolean" ? v : null);
const isMap = (v: Value | undefined): v is Record<string, Value> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function fmtBytes(b: number, binary: boolean): string {
  const base = binary ? 1024 : 1000;
  const units = binary ? ["B", "KiB", "MiB", "GiB", "TiB"] : ["B", "kB", "MB", "GB", "TB"];
  let v = Math.max(0, b);
  let i = 0;
  while (v >= base && i < units.length - 1) {
    v /= base;
    i++;
  }
  return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i] ?? "B"}`;
}

function fmtIoRate(bps: number, binary: boolean): string {
  if (bps < 1024) return "—";
  return `${fmtBytes(bps, binary)}/s`;
}

function fmtClock(us: number): string {
  const s = Math.max(0, Math.floor(us / 1e6));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${String(h)}:${String(m).padStart(2, "0")}:${sec}` : `${String(m)}:${sec}`;
}

export interface LyricItem {
  ms: number;
  text: string;
}

/** Returns the active synced lyric line at `positionMs`, or null before the first timestamp. */
export function activeLyricLine(lyrics: readonly LyricItem[], positionMs: number): string | null {
  let active: string | null = null;
  for (const line of lyrics) {
    if (line.ms <= positionMs) active = line.text;
    else break;
  }
  return active;
}

/* ── 4.9 Processes table visual ─────────────────────────────────────────────── */

interface ProcRow {
  key: string;
  name: string;
  iconUrl: string | null;
  cpu: number;
  memB: number;
  ioBps: number;
  count: number | null;
  pid: number | null;
  start: number | null;
  own: boolean;
  system: boolean;
}

type SortKey = "cpu" | "memory" | "io";

function parseProcRows(raw: Value | undefined, isApps: boolean): ProcRow[] {
  if (!Array.isArray(raw)) return [];
  const out: ProcRow[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!isMap(item)) continue;
    const name = str(item.name) || "?";
    const iconUrl = str(item.iconUrl) || null;
    const pid = isApps ? null : num(item.pid);
    const key = isApps ? str(item.id) || `${name}-${String(i)}` : String(pid ?? i);
    out.push({
      key,
      name,
      iconUrl,
      cpu: num(item.cpu) ?? 0,
      memB: num(item.memB) ?? 0,
      ioBps: num(item.ioBps) ?? 0,
      count: isApps ? num(item.processes) : null,
      pid,
      start: isApps ? null : num(item.start),
      own: bool(item.own) ?? false,
      system: bool(item.system) ?? str(item.app) === "system",
    });
  }
  return out;
}

function AppIcon({ name, iconUrl }: { name: string; iconUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  if (iconUrl && !failed) {
    return (
      <img
        className={styles.procIconImg}
        src={iconUrl}
        alt=""
        onError={() => {
          setFailed(true);
        }}
      />
    );
  }
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span className={styles.procBadge} aria-hidden="true">
      {initial}
    </span>
  );
}

export function ProcessTableVisual({ params, label }: VisualProps) {
  const { services } = useView();
  const host = useContext(HostContext);
  const initialGroup = str(params.group) === "processes" ? "processes" : "apps";
  const initialSort =
    str(params.sort) === "memory" ? "memory" : str(params.sort) === "io" ? "io" : "cpu";

  const [groupOverride, setGroupOverride] = useState<"apps" | "processes" | null>(null);
  const [sortOverride, setSortOverride] = useState<SortKey | null>(null);
  const [query, setQuery] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const group = groupOverride ?? initialGroup;
  const sort = sortOverride ?? initialSort;
  const isApps = group === "apps";
  const showSystem = params.showSystem === true;
  const allowEnd = params.endTask !== false && !isApps;
  const binary = params.binary === true;
  const decimals = num(params.decimals) ?? 0;
  const maxRows = Math.max(1, Math.round(num(params.maxRows) ?? 8));
  const compact = params.compact === true;
  const showSearch = params.showSearch !== false && !compact;
  const showIo = params.showIo !== false && !compact;
  const showCount = params.showCount === true;
  const showBar = params.showBar !== false;
  const gpuLoad = num(params.gpuLoad);

  const sendCommand = (cmd: Command): Promise<CommandResult> => {
    if (services) return services.command(cmd);
    if (host) return host.command(cmd);
    return Promise.resolve({ result: "ok" });
  };

  const rows = useMemo(() => {
    const raw = isApps ? params.apps : params.procs;
    const q = query.trim().toLowerCase();
    return parseProcRows(raw, isApps)
      .filter((r) => (showSystem || !r.system) && (!q || r.name.toLowerCase().includes(q)))
      .sort((a, b) => {
        if (sort === "memory") return b.memB - a.memB;
        if (sort === "io") return b.ioBps - a.ioBps || b.cpu - a.cpu;
        return b.cpu - a.cpu || b.memB - a.memB;
      })
      .slice(0, maxRows);
  }, [isApps, params.apps, params.procs, query, showSystem, sort, maxRows]);

  const maxVal = Math.max(
    1,
    ...rows.map((r) => (sort === "memory" ? r.memB : sort === "io" ? r.ioBps : r.cpu)),
  );

  return (
    <div className={styles.procWrap} data-testid="process-table" aria-label={label ?? "Processes"}>
      {!compact ? (
        <div className={styles.procToolbar}>
          {showSearch ? (
            <label className={styles.procSearchBox}>
              <Icon name="search" size={14} />
              <input
                type="search"
                className={styles.procSearchInput}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                }}
                placeholder="Filter…"
                aria-label="Filter processes"
              />
            </label>
          ) : null}
          {gpuLoad !== null ? (
            <span className={styles.procGpuPill} title="GPU load">
              GPU {Math.round(gpuLoad)}%
            </span>
          ) : null}
          <div className={styles.procSeg} role="group" aria-label="Grouping">
            <button
              type="button"
              className={`${styles.procSegBtn} ${isApps ? styles.procSegActive : ""}`}
              onClick={() => {
                setGroupOverride("apps");
                services?.releaseFocus();
              }}
            >
              Apps
            </button>
            <button
              type="button"
              className={`${styles.procSegBtn} ${!isApps ? styles.procSegActive : ""}`}
              onClick={() => {
                setGroupOverride("processes");
                services?.releaseFocus();
              }}
            >
              Procs
            </button>
          </div>
        </div>
      ) : null}

      {!compact ? (
        <div className={styles.procHeader}>
          <span>{isApps ? "App" : "Process"}</span>
          <div className={styles.procCols}>
            <button
              type="button"
              className={`${styles.procColHead} ${sort === "cpu" ? styles.procColActive : ""}`}
              onClick={() => {
                setSortOverride("cpu");
              }}
            >
              CPU
            </button>
            <button
              type="button"
              className={`${styles.procColHead} ${sort === "memory" ? styles.procColActive : ""}`}
              onClick={() => {
                setSortOverride("memory");
              }}
            >
              RAM
            </button>
            {showIo ? (
              <button
                type="button"
                className={`${styles.procColHead} ${sort === "io" ? styles.procColActive : ""}`}
                onClick={() => {
                  setSortOverride("io");
                }}
              >
                I/O
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className={styles.procEmpty}>
          {query.trim() ? "No matching processes" : "Nothing to show"}
        </div>
      ) : (
        <ul className={styles.procList}>
          {rows.map((r) => {
            const metricVal = sort === "memory" ? r.memB : sort === "io" ? r.ioBps : r.cpu;
            const pct = Math.min(100, Math.max(2, (metricVal / maxVal) * 100));
            return (
              <li key={r.key} className={styles.procRow}>
                <AppIcon name={r.name} iconUrl={r.iconUrl} />
                <div className={styles.procNameCell}>
                  <div className={styles.procNameLine}>
                    <span className={styles.procName}>{r.name}</span>
                    {showCount && r.count !== null ? (
                      <span className={styles.procCount}>×{Math.round(r.count)}</span>
                    ) : null}
                  </div>
                  {showBar ? (
                    <span className={styles.procBar}>
                      <span className={styles.procBarFill} style={{ width: `${String(pct)}%` }} />
                    </span>
                  ) : null}
                </div>
                <div className={styles.procMetrics}>
                  <span className={styles.procMetricCell}>{r.cpu.toFixed(decimals)}%</span>
                  <span className={`${styles.procMetricCell} ${styles.procMetricMuted}`}>
                    {fmtBytes(r.memB, binary)}
                  </span>
                  {showIo ? (
                    <span className={`${styles.procMetricCell} ${styles.procMetricMuted}`}>
                      {fmtIoRate(r.ioBps, binary)}
                    </span>
                  ) : null}
                  {allowEnd && r.own && r.pid !== null && r.start !== null ? (
                    <button
                      type="button"
                      className={`${styles.procEndBtn} ${asking === r.key ? styles.procEndAsking : ""}`}
                      aria-label={asking === r.key ? `Confirm: end ${r.name}` : `End ${r.name}`}
                      onBlur={() => {
                        if (asking === r.key) setAsking(null);
                      }}
                      onClick={() => {
                        if (asking !== r.key) {
                          setAsking(r.key);
                          return;
                        }
                        setAsking(null);
                        void sendCommand({
                          cmd: "end-task",
                          pid: r.pid ?? 0,
                          start: r.start ?? 0,
                          force: false,
                        })
                          .then((res) => {
                            setStatusMsg(res.result === "err" ? res.reason : null);
                            services?.releaseFocus();
                          })
                          .catch(() => {
                            setStatusMsg("failed");
                          });
                      }}
                    >
                      {asking === r.key ? "End?" : <Icon name="close" size={14} />}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {statusMsg ? (
        <div className={styles.procMetricMuted} role="status">
          {statusMsg}
        </div>
      ) : null}
    </div>
  );
}

/* ── 4.10 Now Playing 2.0 visual ────────────────────────────────────────────── */

const SHAPE_MAP: Readonly<Record<string, MaterialShapeName>> = {
  cookie: "cookie7Sided",
  clover: "clover4Leaf",
  pill: "pill",
  softBurst: "softBurst",
  circle: "circle",
  rounded: "square",
};

function ShuffleGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="16 3 21 3 21 8" />
      <line x1="4" y1="20" x2="21" y2="3" />
      <polyline points="21 16 21 21 16 21" />
      <line x1="15" y1="15" x2="21" y2="21" />
      <line x1="4" y1="4" x2="9" y2="9" />
    </svg>
  );
}

function RepeatGlyph({ one }: { one: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      {one ? (
        <text
          x="12"
          y="15"
          textAnchor="middle"
          fontSize="8"
          fill="currentColor"
          stroke="none"
          fontWeight="700"
        >
          1
        </text>
      ) : null}
    </svg>
  );
}

function ReelSvg({
  className,
  refEl,
}: {
  className?: string | undefined;
  refEl: React.RefObject<SVGSVGElement | null>;
}) {
  return (
    <svg ref={refEl} className={className} viewBox="0 0 32 32" aria-hidden="true">
      <circle
        cx="16"
        cy="16"
        r="13"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.65"
      />
      <circle cx="16" cy="16" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
      <line
        x1="16"
        y1="3"
        x2="16"
        y2="11"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="27.2"
        y1="22.5"
        x2="20.3"
        y2="18.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="4.8"
        y1="22.5"
        x2="11.7"
        y2="18.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface ParsedPlayer {
  bus: string;
  identity: string;
  status: string;
  title: string;
  artists: string;
  album: string;
  art: string | null;
  lengthUs: number | null;
  positionUs: number;
  positionAtMs: number;
  rate: number;
  canPlay: boolean;
  canPause: boolean;
  canNext: boolean;
  canPrevious: boolean;
  canSeek: boolean;
  canControl: boolean;
  shuffle: boolean | null;
  loopStatus: "None" | "Track" | "Playlist" | null;
  volume: number | null;
  lyrics: LyricItem[];
}

function parsePlayer(raw: Value | undefined): ParsedPlayer | null {
  if (!isMap(raw)) return null;
  const bus = str(raw.bus);
  if (!bus && !str(raw.title)) return null;
  const artistsList = Array.isArray(raw.artists)
    ? raw.artists.filter((a): a is string => typeof a === "string").join(", ")
    : "";
  const loopRaw = str(raw.loopStatus);
  const loopStatus =
    loopRaw === "None" || loopRaw === "Track" || loopRaw === "Playlist" ? loopRaw : null;
  const lyrics: LyricItem[] = [];
  if (Array.isArray(raw.lyrics)) {
    for (const item of raw.lyrics) {
      if (!isMap(item)) continue;
      const ms = num(item.ms);
      const t = str(item.text);
      if (ms !== null && t) lyrics.push({ ms, text: t });
    }
  }
  return {
    bus,
    identity: str(raw.identity) || "Player",
    status: str(raw.status) || "Stopped",
    title: str(raw.title) || "Unknown title",
    artists: artistsList,
    album: str(raw.album),
    art: str(raw.art) || null,
    lengthUs: num(raw.lengthUs),
    positionUs: num(raw.positionUs) ?? 0,
    positionAtMs: num(raw.positionAtMs) ?? 0,
    rate: num(raw.rate) ?? 1,
    canPlay: bool(raw.canPlay) ?? false,
    canPause: bool(raw.canPause) ?? false,
    canNext: bool(raw.canNext) ?? false,
    canPrevious: bool(raw.canPrevious) ?? false,
    canSeek: bool(raw.canSeek) ?? false,
    canControl: bool(raw.canControl) ?? true,
    shuffle: bool(raw.shuffle),
    loopStatus,
    volume: num(raw.volume),
    lyrics,
  };
}

export function NowPlayingVisual({ params, animate, label }: VisualProps) {
  const { services } = useView();
  const host = useContext(HostContext);
  const clipId = useId();
  const [selectedBus, setSelectedBus] = useState<string | null>(null);
  const [tickNow, setTickNow] = useState<number>(() => Date.now());
  const artRef = useRef<HTMLDivElement>(null);
  const vinylRef = useRef<HTMLDivElement>(null);
  const reelLRef = useRef<SVGSVGElement>(null);
  const reelRRef = useRef<SVGSVGElement>(null);

  const allPlayers = useMemo(() => {
    if (!Array.isArray(params.players)) return [];
    return params.players
      .map((item) => parsePlayer(item))
      .filter((x): x is ParsedPlayer => x !== null);
  }, [params.players]);

  const defaultPlayer = useMemo(() => parsePlayer(params.player), [params.player]);
  const activePlayer =
    (selectedBus ? allPlayers.find((p) => p.bus === selectedBus) : null) ?? defaultPlayer;

  const look = str(params.look) || "card";
  const artShape = str(params.artShape) || "cookie";
  const artBackdrop = params.artBackdrop !== false;
  const showLyrics = params.showLyrics !== false;
  const showExtraControls = params.showExtraControls !== false;
  const showArt = params.showArt !== false;
  const showTitle = params.showTitle !== false;
  const showArtist = params.showArtist !== false;
  const showAlbum = params.showAlbum === true;
  const showApp = params.showApp === true;
  const showProgress = params.showProgress !== false;
  const showControls = params.showControls !== false;
  const size = str(params.size) || "M";
  const isLarge = size === "L";
  const isTiny = size === "2x1";
  const isCompact = size === "S" || isTiny;

  const playing = activePlayer?.status === "Playing";
  const motionOn = animate && playing && !reducedMotion();

  // Extrapolate playback position only while actively playing & animated (0 timers when still/paused).
  useEffect(() => {
    if (!motionOn) return;
    const id = setInterval(() => {
      setTickNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [motionOn]);

  // Breathing Material shape mask on bass (card look) — 0 frames when paused or still.
  useEffect(() => {
    if (!motionOn || look !== "card" || !host) return;
    const artNode = artRef.current;
    let targetScale = 1;
    let scale = 1;
    const anim: Animator = {
      ambient: true,
      step() {
        scale += (targetScale - scale) * 0.25;
        if (artNode) {
          artNode.style.transform = `scale(${scale.toFixed(4)})`;
        }
        if (Math.abs(targetScale - scale) < 0.001) {
          scale = targetScale;
          return false;
        }
        return true;
      },
    };
    const off = host.onSpectrum((levels) => {
      const bass = ((levels[0] ?? 0) + (levels[1] ?? 0) + (levels[2] ?? 0)) / (3 * 255);
      targetScale = 1 + bass * 0.06;
      scheduler.add(anim);
    });
    return () => {
      off();
      scheduler.remove(anim);
      if (artNode) artNode.style.transform = "";
    };
  }, [motionOn, look, host]);

  // Spinning vinyl disc or cassette reels via scheduler — 0 frames when paused or still.
  useEffect(() => {
    if (!motionOn || (look !== "vinyl" && look !== "cassette")) return;
    let angle = 0;
    const degPerSec = look === "vinyl" ? 42 : 72;
    const anim: Animator = {
      ambient: true,
      step(dt) {
        angle = (angle + degPerSec * dt) % 360;
        if (look === "vinyl" && vinylRef.current) {
          vinylRef.current.style.transform = `rotate(${angle.toFixed(1)}deg)`;
        }
        if (look === "cassette") {
          const t = `rotate(${angle.toFixed(1)}deg)`;
          if (reelLRef.current) reelLRef.current.style.transform = t;
          if (reelRRef.current) reelRRef.current.style.transform = t;
        }
        return true;
      },
    };
    scheduler.add(anim);
    return () => {
      scheduler.remove(anim);
    };
  }, [motionOn, look]);

  const shapePath = useMemo(() => {
    const key = SHAPE_MAP[artShape] ?? "cookie7Sided";
    return materialShape(key).toSvgPath();
  }, [artShape]);

  const send = (cmd: Command) => {
    const p = services
      ? services.command(cmd)
      : host
        ? host.command(cmd)
        : Promise.resolve({ result: "ok" as const });
    void p.finally(() => {
      services?.releaseFocus();
    });
  };

  if (!activePlayer) {
    return (
      <div className={styles.npIdle} data-testid="now-playing" aria-label={label ?? "Now Playing"}>
        <Icon name="music_note" size={28} />
        <span>Nothing playing</span>
      </div>
    );
  }

  const positionUs =
    motionOn && activePlayer.positionAtMs > 0
      ? activePlayer.positionUs +
        Math.max(0, tickNow - activePlayer.positionAtMs) * 1000 * activePlayer.rate
      : activePlayer.positionUs;
  const ratio =
    activePlayer.lengthUs && activePlayer.lengthUs > 0
      ? Math.min(1, Math.max(0, positionUs / activePlayer.lengthUs))
      : 0;
  const lyric = showLyrics ? activeLyricLine(activePlayer.lyrics, positionUs / 1000) : null;
  const art = activePlayer.art ?? defaultPlayer?.art ?? null;

  const nextLoop = (): "None" | "Track" | "Playlist" => {
    if (activePlayer.loopStatus === "None" || activePlayer.loopStatus === null) return "Playlist";
    if (activePlayer.loopStatus === "Playlist") return "Track";
    return "None";
  };

  const renderProgress = () =>
    showProgress && activePlayer.lengthUs && !isTiny ? (
      <div className={styles.npProgressRow}>
        <span>{fmtClock(positionUs)}</span>
        <button
          type="button"
          className={styles.npSeekBtn}
          disabled={!activePlayer.canSeek}
          aria-label={`Position ${fmtClock(positionUs)} of ${fmtClock(activePlayer.lengthUs)}`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
            send({
              cmd: "media-seek",
              player: activePlayer.bus,
              position_us: Math.round(frac * (activePlayer.lengthUs ?? 0)),
            });
          }}
        >
          <WavyProgress
            value={ratio}
            width={220}
            amplitude={playing ? 2.6 : 0.4}
            label={`Playback progress ${String(Math.round(ratio * 100))}%`}
          />
        </button>
        <span>{fmtClock(activePlayer.lengthUs)}</span>
      </div>
    ) : null;

  const renderControls = () =>
    showControls && activePlayer.canControl ? (
      <div className={styles.npControlsRow}>
        <div className={styles.npTransport}>
          {showExtraControls && !isCompact && activePlayer.shuffle !== null ? (
            <button
              type="button"
              className={`${styles.npIconBtn} ${activePlayer.shuffle ? styles.npIconBtnActive : ""}`}
              aria-label={activePlayer.shuffle ? "Shuffle on" : "Shuffle off"}
              aria-pressed={activePlayer.shuffle}
              onClick={() => {
                send({
                  cmd: "media-shuffle",
                  player: activePlayer.bus,
                  shuffle: !activePlayer.shuffle,
                });
              }}
            >
              <ShuffleGlyph />
            </button>
          ) : null}
          <button
            type="button"
            className={styles.npIconBtn}
            aria-label="Previous"
            disabled={!activePlayer.canPrevious}
            onClick={() => {
              send({ cmd: "media", player: activePlayer.bus, action: "previous" });
            }}
          >
            <Icon name="skip_previous" size={20} />
          </button>
          <button
            type="button"
            className={styles.npPlayBtn}
            aria-label={playing ? "Pause" : "Play"}
            disabled={!(playing ? activePlayer.canPause : activePlayer.canPlay)}
            onClick={() => {
              send({ cmd: "media", player: activePlayer.bus, action: "play-pause" });
            }}
          >
            <Icon name={playing ? "pause" : "play_arrow"} size={22} fill={1} />
          </button>
          <button
            type="button"
            className={styles.npIconBtn}
            aria-label="Next"
            disabled={!activePlayer.canNext}
            onClick={() => {
              send({ cmd: "media", player: activePlayer.bus, action: "next" });
            }}
          >
            <Icon name="skip_next" size={20} />
          </button>
          {showExtraControls && !isCompact && activePlayer.loopStatus !== null ? (
            <button
              type="button"
              className={`${styles.npIconBtn} ${activePlayer.loopStatus !== "None" ? styles.npIconBtnActive : ""}`}
              aria-label={`Repeat: ${activePlayer.loopStatus}`}
              onClick={() => {
                send({
                  cmd: "media-loop",
                  player: activePlayer.bus,
                  status: nextLoop(),
                });
              }}
            >
              <RepeatGlyph one={activePlayer.loopStatus === "Track"} />
            </button>
          ) : null}
        </div>
        {showExtraControls && !isCompact && activePlayer.volume !== null ? (
          <label className={styles.npVolume} aria-label="Player volume">
            <Icon name="volume_up" size={15} />
            <input
              type="range"
              className={styles.npVolumeSlider}
              min={0}
              max={100}
              value={Math.round(Math.min(1, Math.max(0, activePlayer.volume)) * 100)}
              onChange={(e) => {
                send({
                  cmd: "media-volume",
                  player: activePlayer.bus,
                  volume: Number(e.target.value) / 100,
                });
              }}
            />
          </label>
        ) : null}
      </div>
    ) : null;

  return (
    <div
      className={styles.npRoot}
      data-testid="now-playing"
      data-look={look}
      aria-label={label ?? "Now Playing"}
    >
      {artBackdrop && art ? (
        <div
          className={styles.npBackdrop}
          style={{ backgroundImage: `url(${art})` }}
          aria-hidden="true"
        />
      ) : null}

      {allPlayers.length > 1 && !isTiny ? (
        <div className={styles.npPlayers} role="tablist" aria-label="Active players">
          {allPlayers.map((pl) => {
            const isSel = pl.bus === activePlayer.bus;
            return (
              <button
                key={pl.bus}
                type="button"
                role="tab"
                aria-selected={isSel}
                className={`${styles.npPlayerPill} ${isSel ? styles.npPlayerActive : ""}`}
                onClick={() => {
                  setSelectedBus(pl.bus);
                  services?.releaseFocus();
                }}
              >
                {pl.identity}
              </button>
            );
          })}
        </div>
      ) : null}

      {look === "cassette" ? (
        <div className={styles.npCassette}>
          <div className={styles.npCassetteLabel}>
            {art ? (
              <img className={styles.npCassetteThumb} src={art} alt="" />
            ) : (
              <Icon name="album" size={20} />
            )}
            <div className={styles.npBody}>
              {showTitle ? <div className={styles.npTitle}>{activePlayer.title}</div> : null}
              {showArtist && activePlayer.artists ? (
                <div className={styles.npSub}>{activePlayer.artists}</div>
              ) : null}
            </div>
          </div>
          <div className={styles.npCassetteWindow}>
            <ReelSvg className={styles.npReel} refEl={reelLRef} />
            <span className={styles.npTapeBridge} aria-hidden="true" />
            <ReelSvg className={styles.npReel} refEl={reelRRef} />
          </div>
          {lyric ? <div className={styles.npLyric}>{lyric}</div> : null}
          {renderProgress()}
          {renderControls()}
        </div>
      ) : (
        <div className={`${styles.npMain} ${isLarge ? styles.npMainStacked : ""}`}>
          {showArt && !isTiny ? (
            <div
              ref={artRef}
              className={`${styles.npArtWrap} ${isLarge ? styles.npArtLarge : isCompact ? styles.npArtCompact : ""}`}
            >
              {look === "vinyl" ? (
                <div ref={vinylRef} className={styles.npVinylDisc}>
                  <div className={styles.npVinylSheen} aria-hidden="true" />
                  {art ? (
                    <img className={styles.npVinylLabel} src={art} alt="" />
                  ) : (
                    <div className={styles.npVinylLabel} />
                  )}
                  <span className={styles.npVinylSpindle} aria-hidden="true" />
                </div>
              ) : art ? (
                <svg className={styles.npArtSvg} viewBox="0 0 1 1" aria-hidden="true">
                  <defs>
                    <clipPath id={clipId} clipPathUnits="objectBoundingBox">
                      <path d={shapePath} />
                    </clipPath>
                  </defs>
                  <image
                    href={art}
                    x="0"
                    y="0"
                    width="1"
                    height="1"
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#${clipId})`}
                  />
                </svg>
              ) : (
                <div className={styles.npArtFallback}>
                  <Icon name="album" size={30} />
                </div>
              )}
            </div>
          ) : null}

          <div className={styles.npBody}>
            {showTitle ? <div className={styles.npTitle}>{activePlayer.title}</div> : null}
            {showArtist && activePlayer.artists ? (
              <div className={styles.npSub}>{activePlayer.artists}</div>
            ) : null}
            {showAlbum && activePlayer.album ? (
              <div className={styles.npSub}>{activePlayer.album}</div>
            ) : null}
            {showApp ? <div className={styles.npSub}>{activePlayer.identity}</div> : null}
            {lyric ? <div className={styles.npLyric}>{lyric}</div> : null}
            {renderProgress()}
            {renderControls()}
          </div>
        </div>
      )}
    </div>
  );
}
