// Notes widget (brief §8.3, ADR 0015, PLAN-2 7.2 & 7.3):
// Markdown files in `~/.local/share/opaline/notes/`, interactive checkboxes written back in place,
// inline editing with Escape -> release-focus, and external-edit conflict safety.
import { useState } from "react";
import { Icon } from "../design-system/icons";
import { useHost } from "./host";
import { toJson } from "./json";
import styles from "./p7Widgets.module.css";
import type { RenderCtx, WidgetDef } from "./types";

interface NoteTask {
  line: number;
  text: string;
  done: boolean;
}

interface NoteItem {
  id: string;
  title: string;
  body: string;
  sha256: string;
  tasks: NoteTask[];
}

function NotesBody({ ctx }: { ctx: RenderCtx }) {
  const host = useHost();
  const raw = toJson(ctx.get("notes.list"));
  const notes = (Array.isArray(raw) ? raw : []) as unknown as NoteItem[];
  const pickedId = ctx.content.opt<string>("noteId").trim();
  const active = notes.find((n) => n.id === pickedId) ?? notes[0];

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const openEditor = () => {
    setDraft(active?.body ?? "# Note\n\n");
    setStatus(null);
    setEditing(true);
  };

  const handleSave = () => {
    const id = active?.id ?? (pickedId || "quick-note");
    void host
      .command({
        cmd: "note-save",
        id,
        body: draft,
        ...(active?.sha256 ? { expected_sha256: active.sha256 } : {}),
      })
      .then((res) => {
        if (res.result === "err") {
          setStatus(res.reason === "conflict-external-edit" ? "File changed on disk" : res.reason);
        } else {
          setEditing(false);
          setStatus(null);
          void host.command({ cmd: "release-focus" });
        }
      });
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>
          <Icon name="edit" size={16} /> {active?.title ?? (ctx.content.title || "Notes")}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {editing ? (
            <>
              <button
                type="button"
                data-interactive="true"
                className={`${styles.iconBtn} ${styles.iconBtnPrimary}`}
                onClick={handleSave}
              >
                Save
              </button>
              <button
                type="button"
                data-interactive="true"
                className={styles.iconBtn}
                onClick={() => {
                  setEditing(false);
                  void host.command({ cmd: "release-focus" });
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              data-interactive="true"
              className={styles.iconBtn}
              aria-label="Edit note"
              onClick={openEditor}
            >
              <Icon name="edit" size={14} /> Edit
            </button>
          )}
        </div>
      </div>

      {status ? <span className={styles.sub}>{status}</span> : null}

      {editing ? (
        <textarea
          data-interactive="true"
          aria-label="Note markdown editor"
          className={styles.textarea}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
              void host.command({ cmd: "release-focus" });
            }
          }}
        />
      ) : active ? (
        <ul className={styles.list}>
          {active.tasks.length > 0
            ? active.tasks.map((task) => (
                <li key={task.line} className={styles.listItem}>
                  <button
                    type="button"
                    data-interactive="true"
                    aria-label={`Toggle ${task.text}`}
                    className={styles.iconBtn}
                    style={{ padding: "2px 4px" }}
                    onClick={() => {
                      void host
                        .command({ cmd: "note-toggle-checkbox", id: active.id, line: task.line })
                        .then(() => host.command({ cmd: "release-focus" }));
                    }}
                  >
                    <Icon name={task.done ? "check_box" : "check_box_outline_blank"} size={16} />
                  </button>
                  <span className={`${styles.itemText} ${task.done ? styles.doneText : ""}`}>
                    {task.text}
                  </span>
                </li>
              ))
            : active.body
                .split("\n")
                .filter((l) => l.trim() && !l.trim().startsWith("# "))
                .slice(0, 8)
                .map((line, i) => (
                  <li key={i} className={styles.listItem}>
                    <span className={styles.itemText}>{line}</span>
                  </li>
                ))}
        </ul>
      ) : (
        <span className={styles.sub}>Click Edit to create your first Markdown note.</span>
      )}
    </div>
  );
}

export const notesWidget: WidgetDef = {
  kind: "notes",
  name: "Notes",
  icon: "edit",
  category: "info",
  sizes: ["S", "2x3", "M", "L"],
  defaultSize: "M",
  topics: ["notes.list"],
  fields: [],
  defaultFields: [],
  options: [
    {
      kind: "text",
      key: "noteId",
      label: "Note file name",
      default: "",
      maxLength: 60,
      placeholder: "welcome",
    },
  ],
  status: () => ({ kind: "ready" }),
  render: (ctx) => <NotesBody ctx={ctx} />,
};
