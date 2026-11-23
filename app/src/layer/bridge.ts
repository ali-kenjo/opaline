import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type { ActivityClass, Command, CommandResult, LayerEvent } from "./protocol";

/** True when running inside the Tauri layer process (false in a plain browser / Playwright). */
export const inTauri = isTauri();

/**
 * Connects this window to the layer process. The Rust side replays the current connection
 * state immediately, so a late-mounting window never misses the handshake.
 */
export async function attach(onEvent: (event: LayerEvent) => void): Promise<void> {
  const channel = new Channel<LayerEvent>();
  channel.onmessage = onEvent;
  await invoke("layer_attach", { onEvent: channel });
}

export async function subscribe(topic: string, activity: ActivityClass): Promise<void> {
  await invoke("layer_subscribe", { topic, activity });
}

/** Sends a command to core; outside Tauri (Lab, tests) it answers "standalone". */
export async function command(cmd: Command): Promise<CommandResult> {
  if (!inTauri) return { result: "err", reason: "standalone" };
  return await invoke<CommandResult>("layer_command", { command: cmd });
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Clicks inside these rectangles reach the layer; everywhere else they go to the desktop. */
export async function setInputRegion(rects: Rect[]): Promise<void> {
  await invoke("layer_set_input_region", { rects });
}

/** Sends a Phase 0 spike result to the layer log (see docs/PROGRESS.md). */
export async function report(key: string, value: unknown): Promise<void> {
  await invoke("layer_report", { key, value: JSON.stringify(value) });
}
