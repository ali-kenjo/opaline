// Quote / Word of the Day widget (brief §8.4, PLAN-2 7.4):
// Bundled public-domain quotes rotating daily, or reads a custom source topic.
import { useState } from "react";
import { Icon } from "../design-system/icons";
import { useHost } from "./host";
import { toJson } from "./json";
import styles from "./p7Widgets.module.css";
import type { RenderCtx, WidgetDef } from "./types";

const QUOTES: readonly { text: string; author: string }[] = [
  { text: "Simplicity is prerequisite for reliability.", author: "Edsger W. Dijkstra" },
  { text: "The best way to predict the future is to invent it.", author: "Alan Kay" },
  { text: "Well begun is half done.", author: "Aristotle" },
  { text: "What we do today is what matters most.", author: "Marcus Aurelius" },
  {
    text: "Perfection is achieved not when there is nothing more to add, but when there is nothing left to take away.",
    author: "Antoine de Saint-Exupéry",
  },
  { text: "Knowledge speaks, but wisdom listens.", author: "Jimi Hendrix" },
  { text: "Act as if what you do makes a difference. It does.", author: "William James" },
];

function QuoteBody({ ctx }: { ctx: RenderCtx }) {
  const host = useHost();
  const now = host.now ? host.now() : new Date();
  const dayIdx = Math.floor(now.getTime() / 86_400_000) % QUOTES.length;
  const [offset, setOffset] = useState(0);

  const customTopic = ctx.content.opt<string>("customTopic").trim();
  const customVal = customTopic ? toJson(ctx.get(customTopic)) : null;
  const customText = typeof customVal === "string" && customVal.trim() ? customVal.trim() : null;

  const picked = QUOTES[(dayIdx + offset) % QUOTES.length] ?? QUOTES[0];
  if (!picked) return null;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>
          <Icon name="text_fields" size={16} /> {ctx.content.title || "Quote"}
        </span>
        {!customText ? (
          <button
            type="button"
            data-interactive="true"
            aria-label="Next quote"
            className={styles.iconBtn}
            onClick={() => {
              setOffset((o) => o + 1);
            }}
          >
            <Icon name="keyboard_arrow_right" size={14} />
          </button>
        ) : null}
      </div>
      <p className={styles.quoteText}>&ldquo;{customText ?? picked.text}&rdquo;</p>
      {!customText ? <div className={styles.quoteAuthor}>— {picked.author}</div> : null}
    </div>
  );
}

export const quoteWidget: WidgetDef = {
  kind: "quote",
  name: "Quote of the Day",
  icon: "text_fields",
  category: "info",
  sizes: ["2x1", "S", "M", "L"],
  defaultSize: "M",
  topics: [],
  fields: [],
  defaultFields: [],
  options: [
    {
      kind: "text",
      key: "customTopic",
      label: "Custom source topic (optional)",
      default: "",
      maxLength: 64,
      placeholder: "source.my-quotes",
    },
  ],
  status: () => ({ kind: "ready" }),
  render: (ctx) => <QuoteBody ctx={ctx} />,
};
