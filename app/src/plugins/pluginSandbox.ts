// Sandboxed code-plugin bridge, origin/permission enforcement, and heartbeat watchdog
// implementing ADR 0014 (PLAN-2 9.1, 9.2).

export const PLUGIN_SANDBOX_ATTR = "allow-scripts allow-same-origin";

const GLOBAL_ALLOWED_COMMANDS = new Set([
  "media-toggle",
  "media-next",
  "media-prev",
  "power-profile",
  "control-toggle",
  "timer-action",
  "todo-toggle",
  "note-toggle-checkbox",
  "ha-toggle-entity",
  "n8n-set-workflow-active",
]);

const MAX_PAYLOAD_BYTES = 256 * 1024;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export interface PluginRenderOutput {
  title?: string;
  value: string;
  subtitle?: string;
  progress?: number;
  items?: { label: string; value?: string; action?: string }[];
}

export type PluginHealthState = "starting" | "ready" | "unavailable" | "crashed";

export function isValidPluginId(id: string): boolean {
  return /^[a-z0-9_-]{2,48}$/.test(id) && id !== "spike";
}

export function pluginOrigin(pluginId: string): string {
  return `opaline-plugin://${pluginId}`;
}

export function pluginHostUrl(pluginId: string): string {
  return `opaline-plugin://${pluginId}/host.html`;
}

/** Strict ADR 0014 item 3 check: only accept messages from THIS plugin's frame and origin. */
export function isTrustedPluginEvent(
  event: { origin: string; source: unknown },
  pluginId: string,
  expectedWindow: unknown,
): boolean {
  if (!isValidPluginId(pluginId) || expectedWindow == null) return false;
  return event.source === expectedWindow && event.origin === pluginOrigin(pluginId);
}

/** Filters Hub topic values so a plugin ONLY sees topics declared and approved in its manifest. */
export function filterAllowedTopics(
  allTopics: Readonly<Record<string, unknown>>,
  declaredTopics: readonly string[],
): Record<string, unknown> {
  const allowed = new Set(declaredTopics);
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [k, v] of Object.entries(allTopics)) {
    if (allowed.has(k) && !FORBIDDEN_KEYS.has(k)) {
      out[k] = v;
    }
  }
  return out;
}

/** Validates a plugin action request against BOTH the global allowlist and manifest permissions. */
export function isAllowedPluginCommand(cmd: string, declaredActions: readonly string[]): boolean {
  return GLOBAL_ALLOWED_COMMANDS.has(cmd) && declaredActions.includes(cmd);
}

function hasForbiddenKeys(obj: unknown, depth = 0): boolean {
  if (depth > 16 || obj === null || typeof obj !== "object") return false;
  if (Array.isArray(obj)) {
    return obj.some((el) => hasForbiddenKeys(el, depth + 1));
  }
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (hasForbiddenKeys((obj as Record<string, unknown>)[key], depth + 1)) return true;
  }
  return false;
}

/** Sanitizes and bounds structured render data returned by a plugin worker. */
export function sanitizePluginOutput(raw: unknown): PluginRenderOutput | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (hasForbiddenKeys(raw)) return null;
  let serialized: string;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    return null;
  }
  if (serialized.length > MAX_PAYLOAD_BYTES) return null;

  const rec = raw as Record<string, unknown>;
  const value = typeof rec.value === "string" ? rec.value.slice(0, 240) : "";
  if (!value && !Array.isArray(rec.items)) return null;

  const out: PluginRenderOutput = { value };
  if (typeof rec.title === "string") out.title = rec.title.slice(0, 80);
  if (typeof rec.subtitle === "string") out.subtitle = rec.subtitle.slice(0, 120);
  if (typeof rec.progress === "number" && Number.isFinite(rec.progress)) {
    out.progress = Math.max(0, Math.min(1, rec.progress));
  }
  if (Array.isArray(rec.items)) {
    out.items = rec.items
      .slice(0, 12)
      .filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null)
      .map((it) => {
        const entry: { label: string; value?: string; action?: string } = {
          label: typeof it.label === "string" ? it.label.slice(0, 100) : "",
        };
        if (typeof it.value === "string") entry.value = it.value.slice(0, 60);
        if (typeof it.action === "string") entry.action = it.action.slice(0, 48);
        return entry;
      })
      .filter((it) => it.label.length > 0);
  }
  return out;
}

export interface WatchdogOptions {
  /** Heartbeat deadline in milliseconds (ADR 0014 default: 2000 ms). */
  timeoutMs?: number;
  /** Maximum consecutive restarts before stopping permanently until user reloads. */
  maxRestarts?: number;
  /** How often the host calls `check()`. With it, a gap between checks longer than the
   * deadline means the host itself was paused (WebKit stops timers in a covered layer window;
   * the machine slept), not that the plugin hung: the deadline starts again instead. */
  checkEveryMs?: number;
  onTerminate: (reason: string, backoffMs: number, exhausted: boolean) => void;
}

/**
 * Watchdog for a sandboxed plugin worker (ADR 0014 item 4):
 * Tracks heartbeat responses and terminates hung / busy-loop / memory-exhausted workers
 * without affecting sibling widgets. Restarts with exponential backoff (`1s -> 2s -> 4s -> 30s`).
 */
export class PluginWatchdog {
  readonly timeoutMs: number;
  readonly maxRestarts: number;
  private readonly onTerminate: WatchdogOptions["onTerminate"];
  private lastPongAt: number;
  private lastCheckAt: number | null = null;
  private readonly checkEveryMs: number | undefined;
  private restarts = 0;
  private state: PluginHealthState = "starting";

  constructor(opts: WatchdogOptions, nowMs = Date.now()) {
    this.timeoutMs = opts.timeoutMs ?? 2000;
    this.maxRestarts = opts.maxRestarts ?? 4;
    this.onTerminate = opts.onTerminate;
    this.checkEveryMs = opts.checkEveryMs;
    this.lastPongAt = nowMs;
  }

  get health(): PluginHealthState {
    return this.state;
  }

  get restartCount(): number {
    return this.restarts;
  }

  recordPong(nowMs = Date.now()): void {
    this.lastPongAt = nowMs;
    this.state = "ready";
    this.restarts = 0;
  }

  /** Call periodically (e.g. every 500 ms). Returns true if the worker timed out and was terminated. */
  check(nowMs = Date.now()): boolean {
    if (this.state === "crashed") return false;
    const previous = this.lastCheckAt;
    this.lastCheckAt = nowMs;
    if (
      this.checkEveryMs !== undefined &&
      previous !== null &&
      nowMs - previous > Math.max(this.timeoutMs, 4 * this.checkEveryMs)
    ) {
      // The host didn't run: give the plugin a full deadline to answer the ping sent now.
      this.lastPongAt = Math.max(this.lastPongAt, nowMs);
      return false;
    }
    if (nowMs - this.lastPongAt <= this.timeoutMs) return false;
    this.restarts += 1;
    const exhausted = this.restarts >= this.maxRestarts;
    this.state = exhausted ? "crashed" : "unavailable";
    const backoffMs = Math.min(30_000, 1000 * 2 ** (this.restarts - 1));
    this.lastPongAt = nowMs + backoffMs;
    this.onTerminate("heartbeat-timeout", backoffMs, exhausted);
    return true;
  }
}
