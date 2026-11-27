// Sandboxed code-plugin renderer (ADR 0014, PLAN-2 9.1):
// Runs plugin code exclusively inside a dedicated Web Worker under `opaline-plugin://<id>/host.html`
// inside an invisible sandboxed iframe, enforcing strict origin checks, declared-topic filtering,
// allow-listed commands, and a 2 s heartbeat watchdog.
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../design-system/icons";
import styles from "../widgets/p7Widgets.module.css";
import {
  PLUGIN_SANDBOX_ATTR,
  type PluginHealthState,
  type PluginRenderOutput,
  PluginWatchdog,
  filterAllowedTopics,
  isAllowedPluginCommand,
  isTrustedPluginEvent,
  isValidPluginId,
  pluginHostUrl,
  pluginOrigin,
  sanitizePluginOutput,
} from "./pluginSandbox";

/** How often the host pings the plugin worker and checks its watchdog. */
const HEARTBEAT_MS = 500;

export interface PluginHostProps {
  pluginId: string;
  name: string;
  approved: boolean;
  declaredTopics: readonly string[];
  declaredActions: readonly string[];
  topicValues: Readonly<Record<string, unknown>>;
  onAction?: (cmd: string) => void;
}

export function PluginWidget({
  pluginId,
  name,
  approved,
  declaredTopics,
  declaredActions,
  topicValues,
  onAction,
}: PluginHostProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [health, setHealth] = useState<PluginHealthState>("starting");
  const [output, setOutput] = useState<PluginRenderOutput | null>(null);
  const [errorNote, setErrorNote] = useState<string | null>(null);

  const valid = isValidPluginId(pluginId);
  const filteredTopics = useMemo(
    () => filterAllowedTopics(topicValues, declaredTopics),
    [topicValues, declaredTopics],
  );

  useEffect(() => {
    if (!approved || !valid) return;
    const origin = pluginOrigin(pluginId);
    let restartTimer: ReturnType<typeof setTimeout> | null = null;

    const postToHost = (msg: unknown) => {
      const win = iframeRef.current?.contentWindow;
      if (win) win.postMessage(msg, origin);
    };

    const watchdog = new PluginWatchdog({
      timeoutMs: 2000,
      maxRestarts: 4,
      checkEveryMs: HEARTBEAT_MS,
      onTerminate: (reason, backoffMs, exhausted) => {
        postToHost({ kind: "terminate" });
        setHealth(exhausted ? "crashed" : "unavailable");
        setErrorNote(exhausted ? "Stopped after repeated timeouts" : `Restarting (${reason})`);
        if (!exhausted) {
          restartTimer = setTimeout(() => {
            postToHost({ kind: "start" });
          }, backoffMs);
        }
      },
    });

    const onMessage = (ev: MessageEvent) => {
      if (!isTrustedPluginEvent(ev, pluginId, iframeRef.current?.contentWindow)) return;
      const msg = ev.data as Record<string, unknown> | null;
      if (!msg || typeof msg !== "object") return;
      if (msg.kind === "host-ready") {
        watchdog.recordPong();
        setHealth("ready");
        setErrorNote(null);
      } else if (msg.kind === "plugin-error") {
        setHealth("unavailable");
        setErrorNote(typeof msg.message === "string" ? msg.message : "Plugin error");
      } else if (msg.kind === "plugin-msg") {
        const payload = msg.payload as Record<string, unknown> | null;
        if (!payload || typeof payload !== "object") return;
        if (payload.type === "pong") {
          watchdog.recordPong();
          setHealth("ready");
        } else if (payload.type === "render") {
          watchdog.recordPong();
          const clean = sanitizePluginOutput(payload.data);
          if (clean) {
            setOutput(clean);
            setHealth("ready");
          }
        } else if (
          payload.type === "action" &&
          typeof payload.cmd === "string" &&
          isAllowedPluginCommand(payload.cmd, declaredActions)
        ) {
          onAction?.(payload.cmd);
        }
      }
    };

    window.addEventListener("message", onMessage);
    const heartbeat = setInterval(() => {
      postToHost({ kind: "to-worker", payload: { type: "ping", at: Date.now() } });
      watchdog.check();
    }, HEARTBEAT_MS);

    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(heartbeat);
      if (restartTimer) clearTimeout(restartTimer);
      postToHost({ kind: "terminate" });
    };
  }, [approved, valid, pluginId, declaredActions, onAction]);

  useEffect(() => {
    if (!approved || !valid || health !== "ready") return;
    const win = iframeRef.current?.contentWindow;
    if (win) {
      win.postMessage(
        { kind: "to-worker", payload: { type: "topics", values: filteredTopics } },
        pluginOrigin(pluginId),
      );
    }
  }, [approved, valid, health, filteredTopics, pluginId]);

  if (!approved || !valid) {
    return (
      <div className={styles.wrap}>
        <div className={styles.header}>
          <span className={styles.title}>
            <Icon name="lock" size={16} /> {name}
          </span>
        </div>
        <span className={styles.sub}>
          {valid ? "Approval required in Settings → Plugins & Gallery" : "Invalid plugin id"}
        </span>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <iframe
        ref={iframeRef}
        title={`Plugin sandbox: ${pluginId}`}
        sandbox={PLUGIN_SANDBOX_ATTR}
        src={pluginHostUrl(pluginId)}
        style={{ display: "none", width: 0, height: 0, border: 0 }}
        onLoad={() => {
          iframeRef.current?.contentWindow?.postMessage({ kind: "start" }, pluginOrigin(pluginId));
        }}
      />
      <div className={styles.header}>
        <span className={styles.title}>
          <Icon name="widgets" size={16} /> {output?.title ?? name}
        </span>
        {health !== "ready" ? <span className={styles.sub}>{health}</span> : null}
      </div>
      {health === "unavailable" || health === "crashed" ? (
        <span className={styles.sub}>{errorNote ?? "Plugin unavailable"}</span>
      ) : output ? (
        <>
          {output.value ? <div className={styles.heroNum}>{output.value}</div> : null}
          {output.subtitle ? <span className={styles.sub}>{output.subtitle}</span> : null}
          {typeof output.progress === "number" ? (
            <div className={styles.barTrack}>
              <div
                className={styles.barFill}
                style={{ width: `${Math.round(output.progress * 100)}%` }}
              />
            </div>
          ) : null}
        </>
      ) : (
        <span className={styles.sub}>Starting sandbox…</span>
      )}
    </div>
  );
}
