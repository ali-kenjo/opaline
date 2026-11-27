// To-do widget (brief §8.3, ADR 0015, PLAN-2 7.2 & 7.3):
// Local todo.txt tasks with inline quick-add (Escape -> release-focus), priorities, due dates,
// completion toggle, and delete.
import { useState } from "react";
import { Icon } from "../design-system/icons";
import { useHost } from "./host";
import { toJson } from "./json";
import styles from "./p7Widgets.module.css";
import type { RenderCtx, WidgetDef } from "./types";

interface TodoItem {
  index: number;
  text: string;
  done: boolean;
  priority: string;
  due: string;
}

interface TodoPayload {
  items?: TodoItem[];
  openCount?: number;
  totalCount?: number;
}

function TodoBody({ ctx }: { ctx: RenderCtx }) {
  const host = useHost();
  const raw = toJson(ctx.get("todos.list"));
  const data = (
    typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}
  ) as TodoPayload;
  const showDone = ctx.content.opt<boolean>("showDone");
  const items = (data.items ?? []).filter((it) => showDone || !it.done);

  const [draft, setDraft] = useState("");

  const handleAdd = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void host.command({ cmd: "todo-add", text }).then(() => host.command({ cmd: "release-focus" }));
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>
          <Icon name="check_box" size={16} /> {ctx.content.title || "To-do"}
        </span>
        <span className={styles.badge}>{data.openCount ?? items.length} open</span>
      </div>

      <form
        style={{ display: "flex", gap: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          handleAdd();
        }}
      >
        <input
          type="text"
          data-interactive="true"
          aria-label="New task"
          className={styles.inlineInput}
          placeholder="Add a task…"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
              void host.command({ cmd: "release-focus" });
            }
          }}
        />
        <button
          type="submit"
          data-interactive="true"
          aria-label="Add task"
          className={`${styles.iconBtn} ${styles.iconBtnPrimary}`}
        >
          <Icon name="add" size={16} />
        </button>
      </form>

      <ul className={styles.list}>
        {items.length === 0 ? (
          <li className={styles.sub}>All caught up.</li>
        ) : (
          items.map((item) => (
            <li key={item.index} className={styles.listItem}>
              <button
                type="button"
                data-interactive="true"
                aria-label={`Toggle task ${item.text}`}
                className={styles.iconBtn}
                style={{ padding: "2px 4px" }}
                onClick={() => {
                  void host
                    .command({ cmd: "todo-toggle", index: item.index })
                    .then(() => host.command({ cmd: "release-focus" }));
                }}
              >
                <Icon name={item.done ? "check_box" : "check_box_outline_blank"} size={16} />
              </button>
              {item.priority ? <span className={styles.badge}>{item.priority}</span> : null}
              <span className={`${styles.itemText} ${item.done ? styles.doneText : ""}`}>
                {item.text}
              </span>
              {item.due ? <span className={styles.sub}>{item.due}</span> : null}
              <button
                type="button"
                data-interactive="true"
                aria-label={`Delete task ${item.text}`}
                className={styles.iconBtn}
                style={{ padding: "2px 4px" }}
                onClick={() => {
                  void host
                    .command({ cmd: "todo-delete", index: item.index })
                    .then(() => host.command({ cmd: "release-focus" }));
                }}
              >
                <Icon name="delete" size={14} />
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export const todoWidget: WidgetDef = {
  kind: "todo",
  name: "To-do",
  icon: "check_box",
  category: "info",
  sizes: ["S", "2x3", "M", "L"],
  defaultSize: "M",
  topics: ["todos.list"],
  fields: [],
  defaultFields: [],
  options: [
    {
      kind: "bool",
      key: "showDone",
      label: "Show completed tasks",
      default: true,
    },
  ],
  status: () => ({ kind: "ready" }),
  render: (ctx) => <TodoBody ctx={ctx} />,
};
