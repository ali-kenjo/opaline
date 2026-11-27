// Photo Frame widget (brief §8.4, PLAN-2 7.4):
// Displays core-downscaled cached thumbnails from `photos.list` (never full-resolution files),
// with EXIF date, "On this day" badge, fit/fill, shuffle/next controls, and 0 idle frames.
import { useState } from "react";
import { Icon } from "../design-system/icons";
import { toJson } from "./json";
import styles from "./p7Widgets.module.css";
import type { RenderCtx, WidgetDef } from "./types";

interface PhotoEntry {
  id: string;
  name: string;
  thumbUrl: string;
  date: string;
  onThisDay: boolean;
}

interface PhotosPayload {
  folder?: string;
  items?: PhotoEntry[];
}

function PhotoFrameBody({ ctx }: { ctx: RenderCtx }) {
  const raw = toJson(ctx.get("photos.list"));
  const data = (
    typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}
  ) as PhotosPayload;
  const items = data.items ?? [];
  const fit = ctx.content.opt<string>("fit");
  const showCaption = ctx.content.opt<boolean>("showCaption");

  const [idx, setIdx] = useState(0);
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});

  if (items.length === 0) {
    return (
      <div className={styles.wrap} style={{ justifyContent: "center", alignItems: "center" }}>
        <Icon name="album" size={28} />
        <span className={styles.sub}>Add photos to ~/Pictures to display thumbnails here</span>
      </div>
    );
  }

  const current = items[idx % items.length] ?? items[0];
  if (!current) return null;
  const isFav = Boolean(favorites[current.id]);

  return (
    <div className={styles.photoBox}>
      <img
        src={current.thumbUrl}
        alt={current.name}
        className={styles.photoImg}
        style={{ objectFit: fit === "contain" ? "contain" : "cover" }}
      />
      {showCaption ? (
        <div className={styles.photoCaption}>
          <span className={styles.itemText}>
            {current.onThisDay ? "On this day · " : ""}
            {current.name}
            {current.date ? ` (${current.date})` : ""}
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              data-interactive="true"
              aria-label={isFav ? "Unfavorite photo" : "Favorite photo"}
              className={styles.iconBtn}
              style={{ padding: "2px 5px" }}
              onClick={() => {
                setFavorites((f) => ({ ...f, [current.id]: !f[current.id] }));
              }}
            >
              <Icon name="star" size={13} fill={isFav ? 1 : 0} />
            </button>
            {items.length > 1 ? (
              <button
                type="button"
                data-interactive="true"
                aria-label="Next photo"
                className={styles.iconBtn}
                style={{ padding: "2px 5px" }}
                onClick={() => {
                  setIdx((i) => (i + 1) % items.length);
                }}
              >
                <Icon name="keyboard_arrow_right" size={14} />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const photoFrameWidget: WidgetDef = {
  kind: "photo-frame",
  name: "Photo Frame",
  icon: "album",
  category: "media",
  sizes: ["S", "2x3", "M", "L", "6x4"],
  defaultSize: "M",
  topics: ["photos.list"],
  fields: [],
  defaultFields: [],
  options: [
    {
      kind: "enum",
      key: "fit",
      label: "Image fit",
      default: "cover",
      options: [
        { value: "cover", label: "Fill frame" },
        { value: "contain", label: "Fit inside" },
      ],
    },
    {
      kind: "bool",
      key: "showCaption",
      label: "Show EXIF caption & controls",
      default: true,
    },
  ],
  status: () => ({ kind: "ready" }),
  render: (ctx) => <PhotoFrameBody ctx={ctx} />,
};
