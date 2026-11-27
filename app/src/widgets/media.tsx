// Now Playing widget: the active player (MPRIS) with art, title, artist, album, a progress bar
// you can click to seek, and controls.
import { useEffect, useState } from "react";
import { Icon } from "../design-system/icons";
import type { Value } from "../layer/protocol";
import { map, num, text } from "./format";
import { useHost } from "./host";
import { mediaComposition } from "./media.composition";
import type { CardStatus, Choice, ReadCtx, RenderCtx, WidgetDef } from "./types";
import styles from "./media.module.css";

const PLAYER = "media.player";
const PLAYERS = "media.players";

function players(v: Value | undefined): Record<string, Value>[] {
  return v?.kind === "list" ? v.v.flatMap((p) => (p.kind === "map" ? [p.v] : [])) : [];
}

/** The chosen player (by app name), else core's choice (the one playing). */
function player(c: ReadCtx): Record<string, Value> | null {
  const want = c.content.opt<string>("player");
  if (want !== "auto") {
    const p = players(c.get(PLAYERS)).find((x) => text(x.identity) === want);
    if (p) return p;
  }
  return map(c.get(PLAYER));
}

function clock(us: number): string {
  const s = Math.max(0, Math.floor(us / 1e6));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${String(h)}:${String(m).padStart(2, "0")}:${sec}` : `${String(m)}:${sec}`;
}

function usePosition(p: Record<string, Value> | null): number {
  const playing = text(p?.status) === "Playing";
  const base = num(p?.positionUs) ?? 0;
  const rate = num(p?.rate) ?? 1;
  const [now, setNow] = useState(() => Date.now());
  const at = num(p?.positionAtMs) ?? now;
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [playing]);
  return playing ? base + Math.max(0, now - at) * 1000 * rate : base;
}

function NowPlaying({ ctx }: { ctx: RenderCtx }) {
  const host = useHost();
  const { content, size } = ctx;
  const p = player(ctx);
  const position = usePosition(p);
  const shown = new Set(content.fields);
  if (!p) {
    return (
      <div className={styles.idle}>
        <Icon name="music_note" size={28} />
        <span>Nothing playing</span>
      </div>
    );
  }
  const bus = text(p.bus) ?? "";
  const length = num(p.lengthUs);
  const playing = text(p.status) === "Playing";
  const can = (k: string) => p[k]?.kind === "bool" && (p[k] as { v: boolean }).v;
  const send = (action: "previous" | "next" | "play-pause") => {
    void host.command({ cmd: "media", player: bus, action });
  };
  const artists =
    p.artists?.kind === "list"
      ? p.artists.v.flatMap((a) => (a.kind === "text" ? [a.v] : [])).join(", ")
      : "";
  const art = text(p.art);
  const small = size === "2x1" || size === "1x1";

  return (
    <div className={styles.media} data-size={size}>
      {shown.has("art") && art && !small ? (
        <img
          className={`${styles.art} ${content.opt<string>("artShape") === "circle" ? styles.circle : ""}`}
          src={art}
          alt=""
        />
      ) : null}
      <div className={styles.body}>
        {shown.has("title") ? (
          <div className={styles.title}>{text(p.title) ?? "Unknown title"}</div>
        ) : null}
        {shown.has("artist") && artists ? <div className={styles.artist}>{artists}</div> : null}
        {shown.has("album") && text(p.album) ? (
          <div className={styles.artist}>{text(p.album)}</div>
        ) : null}
        {shown.has("app") ? <div className={styles.artist}>{text(p.identity)}</div> : null}
        {shown.has("progress") && length && !small ? (
          <div className={styles.progress}>
            <span>{clock(position)}</span>
            <button
              type="button"
              className={styles.track}
              aria-label={`Position ${clock(position)} of ${clock(length)}`}
              disabled={!can("canSeek")}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
                void host.command({
                  cmd: "media-seek",
                  player: bus,
                  position_us: Math.round(f * length),
                });
              }}
            >
              <span
                className={styles.fill}
                style={{ width: `${String(Math.min(100, (position / length) * 100))}%` }}
              />
            </button>
            <span>{clock(length)}</span>
          </div>
        ) : null}
        {shown.has("controls") && can("canControl") ? (
          <div className={styles.controls}>
            <button
              type="button"
              className={styles.control}
              aria-label="Previous"
              disabled={!can("canPrevious")}
              onClick={() => {
                send("previous");
              }}
            >
              <Icon name="skip_previous" size={22} />
            </button>
            <button
              type="button"
              className={`${styles.control} ${styles.play}`}
              aria-label={playing ? "Pause" : "Play"}
              disabled={!(playing ? can("canPause") : can("canPlay"))}
              onClick={() => {
                send("play-pause");
              }}
            >
              <Icon name={playing ? "pause" : "play_arrow"} size={24} fill={1} />
            </button>
            <button
              type="button"
              className={styles.control}
              aria-label="Next"
              disabled={!can("canNext")}
              onClick={() => {
                send("next");
              }}
            >
              <Icon name="skip_next" size={22} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const part = (
  id: string,
  label: string,
  icon: "album" | "music_note" | "edit" | "apps" | "timer" | "play_arrow",
) => ({ id, label, icon, topics: [] as string[], hero: false, read: () => ({ text: "" }) });

export const media: WidgetDef = {
  kind: "media",
  name: "Now Playing",
  icon: "music_note",
  category: "media",
  sizes: ["2x1", "4x1", "S", "M", "L"],
  defaultSize: "M",
  topics: [PLAYER, PLAYERS],
  defaultFields: ["art", "title", "artist", "progress", "controls"],
  fields: [
    part("art", "Cover", "album"),
    part("title", "Title", "music_note"),
    part("artist", "Artist", "edit"),
    part("album", "Album", "album"),
    part("app", "Player app", "apps"),
    part("progress", "Progress", "timer"),
    part("controls", "Controls", "play_arrow"),
  ],
  options: [
    {
      kind: "source",
      key: "player",
      label: "Player",
      topic: PLAYERS,
      choices: (v): Choice => [
        { value: "auto", label: "Automatic (the one playing)" },
        ...players(v).flatMap((p) => {
          const id = text(p.identity);
          return id ? [{ value: id, label: id }] : [];
        }),
      ],
      default: "auto",
    },
    {
      kind: "enum",
      key: "look",
      label: "Look",
      options: [
        { value: "card", label: "Glass card" },
        { value: "vinyl", label: "Spinning vinyl" },
        { value: "cassette", label: "Retro cassette" },
      ],
      default: "card",
    },
    {
      kind: "enum",
      key: "artShape",
      label: "Cover shape",
      options: [
        { value: "rounded", label: "Rounded" },
        { value: "circle", label: "Circle" },
        { value: "cookie", label: "Cookie (Material)" },
        { value: "clover", label: "Clover" },
        { value: "pill", label: "Pill" },
        { value: "softBurst", label: "Soft burst" },
      ],
      default: "rounded",
    },
    { kind: "bool", key: "artBackdrop", label: "Blurred album backdrop", default: true },
    { kind: "bool", key: "showLyrics", label: "Synced local lyrics (.lrc)", default: true },
    {
      kind: "bool",
      key: "showExtraControls",
      label: "Shuffle, repeat & volume",
      default: true,
    },
  ],
  status(c): CardStatus {
    return c.get(PLAYER) === undefined && c.get(PLAYERS) === undefined
      ? { kind: "loading" }
      : { kind: "ready" };
  },
  render: (ctx) => <NowPlaying ctx={ctx} />,
  composition: mediaComposition,
  useClassicStat: true,
  compositionTopics(values, content) {
    const shown = new Set(content.fields);
    const want = content.opt<string>("player");
    const list = values[PLAYERS];
    let active: Value | undefined = values[PLAYER];
    if (want !== "auto" && list?.kind === "list") {
      const match = list.v.find((x) => x.kind === "map" && text(x.v.identity) === want);
      if (match) active = match;
    }
    return {
      ...values,
      mediaActive: active,
      mediaMeta: {
        kind: "map",
        v: {
          showArt: { kind: "bool", v: shown.has("art") },
          showTitle: { kind: "bool", v: shown.has("title") },
          showArtist: { kind: "bool", v: shown.has("artist") },
          showAlbum: { kind: "bool", v: shown.has("album") },
          showApp: { kind: "bool", v: shown.has("app") },
          showProgress: { kind: "bool", v: shown.has("progress") },
          showControls: { kind: "bool", v: shown.has("controls") },
        },
      },
    };
  },
};
