// A fake core for UI tests. It is injected into the page before the app loads (Playwright
// `addInitScript`) and stands in for Tauri's IPC: the real layer page runs unchanged, calls
// `invoke` and receives `Channel` messages, and the test can push events and read the commands
// the page sent. Mocks only in tests (CLAUDE.md).
//
// `installFakeCore` is serialized by Playwright, so it must not use anything from outside its
// own body (no imports, no closures over module scope).

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface FakeCoreInit {
  /** Window label, e.g. `layer-eDP-1`. */
  label: string;
  monitor: Json;
  monitors: Json[];
  geometry: { x: number; y: number; width: number; height: number };
  settings: Json;
  layouts: Json;
  appearance: Json;
  /** Topic values already in protocol shape (`{ kind, v }`), sent on subscribe. */
  values: Record<string, Json>;
}

export interface FakeCommand {
  cmd: string;
  args: Json;
}

/** What the test sees on `window.__fake`. */
export interface FakeCoreHandle {
  commands: FakeCommand[];
  subscriptions: string[];
  emit: (event: Json) => void;
  settings: () => Json;
  layouts: () => Json;
  /** Every input region the page set, in order (`layer_set_input_region`). */
  regions: { x: number; y: number; width: number; height: number }[][];
}

declare global {
  interface Window {
    __fake?: FakeCoreHandle;
  }
}

export function installFakeCore(init: FakeCoreInit): void {
  type Cb = (payload: unknown) => void;
  const w = window as unknown as Record<string, unknown>;

  const fromJson = (j: Json): Json => {
    if (j === null) return { kind: "missing", v: { state: "unavailable", reason: "not-reported" } };
    if (typeof j === "boolean") return { kind: "bool", v: j };
    if (typeof j === "number") return { kind: "num", v: j };
    if (typeof j === "string") return { kind: "text", v: j };
    if (Array.isArray(j)) return { kind: "list", v: j.map(fromJson) };
    const o: Record<string, Json> = {};
    for (const [k, x] of Object.entries(j)) o[k] = fromJson(x);
    return { kind: "map", v: o };
  };
  const toJson = (v: Json): Json => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
    const kind = v.kind;
    const val = v.v ?? null;
    if (kind === "list" && Array.isArray(val)) return val.map(toJson);
    if (kind === "map" && typeof val === "object" && val !== null && !Array.isArray(val)) {
      const o: Record<string, Json> = {};
      for (const [k, x] of Object.entries(val)) o[k] = toJson(x);
      return o;
    }
    if (kind === "missing") return null;
    return val;
  };
  const merge = (target: Json, patch: Json): Json => {
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return patch;
    const base: Record<string, Json> =
      typeof target === "object" && target !== null && !Array.isArray(target) ? { ...target } : {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) Reflect.deleteProperty(base, k);
      else base[k] = merge(base[k] ?? null, v);
    }
    return base;
  };

  let settings: Json = init.settings;
  let layouts: Json = init.layouts;
  let nextCallback = 1;
  let channel: { id: number; index: number } | null = null;
  let seq = 0;
  const commands: FakeCommand[] = [];
  const subscriptions: string[] = [];
  const regions: FakeCoreHandle["regions"] = [];

  const send = (event: Json) => {
    if (!channel) return;
    const cb = w[`_${String(channel.id)}`] as Cb | undefined;
    cb?.({ message: event, index: channel.index });
    channel.index += 1;
  };
  const update = (topic: string, value: Json) => {
    seq += 1;
    send({ kind: "update", seq, atMs: Date.now(), updates: [{ topic, value }] });
  };

  const handle = (cmd: string, args: Record<string, unknown>): unknown => {
    switch (cmd) {
      case "layer_attach": {
        const ch = args.onEvent as { id: number } | undefined;
        if (!ch) throw new Error("no channel");
        channel = { id: ch.id, index: 0 };
        send({
          kind: "connected",
          coreVersion: "test",
          backend: "native",
          monitor: init.monitor,
          monitors: init.monitors,
        });
        send({ kind: "geometry", ...init.geometry });
        update("settings", fromJson(settings));
        update("layouts", fromJson(layouts));
        update("appearance.settings", fromJson(init.appearance));
        return null;
      }
      case "layer_subscribe": {
        const topic = String(args.topic);
        subscriptions.push(topic);
        const value = init.values[topic];
        if (value !== undefined)
          setTimeout(() => {
            update(topic, value);
          }, 0);
        return null;
      }
      case "layer_command": {
        const c = args.command as Record<string, Json>;
        const name = typeof c.cmd === "string" ? c.cmd : "";
        commands.push({ cmd: name, args: c });
        if (name === "update-settings") {
          settings = merge(settings, toJson(c.patch ?? null));
          setTimeout(() => {
            update("settings", fromJson(settings));
          }, 0);
          return { result: "ok" };
        }
        if (name === "update-layouts") {
          layouts = toJson(c.layouts ?? null);
          setTimeout(() => {
            update("layouts", fromJson(layouts));
          }, 0);
          return { result: "ok" };
        }
        if (name === "history") return { result: "data", value: { kind: "nums", v: [] } };
        if (name === "list-fonts") {
          return { result: "data", value: { kind: "list", v: [{ kind: "text", v: "Inter" }] } };
        }
        return { result: "ok" };
      }
      case "layer_set_edit":
        setTimeout(() => {
          send({ kind: "edit", active: Boolean(args.active) });
        }, 0);
        return null;
      case "layer_set_peek":
        setTimeout(() => {
          send({ kind: "peek", active: Boolean(args.active) });
        }, 0);
        return null;
      case "layer_asset":
        throw new Error("no assets in tests");
      case "layer_set_input_region":
        regions.push(args.rects as FakeCoreHandle["regions"][number]);
        return null;
      default:
        // layer_report, layer_set_raised: nothing to do.
        return null;
    }
  };

  w.isTauri = true;
  w.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: init.label },
      currentWebview: { windowLabel: init.label, label: init.label },
    },
    transformCallback(callback: Cb, once = false): number {
      const id = nextCallback++;
      w[`_${String(id)}`] = (payload: unknown) => {
        if (once) Reflect.deleteProperty(w, `_${String(id)}`);
        callback(payload);
      };
      return id;
    },
    unregisterCallback(id: number) {
      Reflect.deleteProperty(w, `_${String(id)}`);
    },
    async invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
      await Promise.resolve();
      return handle(cmd, args);
    },
    convertFileSrc: (path: string) => path,
  };

  const fake: FakeCoreHandle = {
    commands,
    subscriptions,
    regions,
    emit: send,
    settings: () => settings,
    layouts: () => layouts,
  };
  window.__fake = fake;
}
