// Commands a composition's controls may send (docs/COMPOSITION.md §3). Core validates every
// command against its own listings anyway; this list keeps a composition, which may come from an
// imported theme or widget, away from settings, layouts and everything else that isn't a control.
// The Rust validator holds the same list (crates/opaline-compose, `COMMANDS`).
import type { Value } from "../expr";
import type { Command } from "../layer/protocol";

/** Allowed command names, and whether a button must ask first (`confirm`). */
export const COMMANDS: Readonly<Record<string, { confirm: boolean }>> = {
  media: { confirm: false },
  "media-seek": { confirm: false },
  "media-shuffle": { confirm: false },
  "media-loop": { confirm: false },
  "media-volume": { confirm: false },
  "set-power-profile": { confirm: false },
  container: { confirm: false },
  "start-docker-desktop": { confirm: false },
  "drive-eject": { confirm: false },
  "drive-power-off": { confirm: true },
  "end-task": { confirm: true },
};

/** The command a control sends, or null when it isn't allowed here. */
export function buildCommand(
  cmd: string,
  args: Readonly<Record<string, Value>>,
  confirmed: boolean,
): Command | null {
  const rule = Object.hasOwn(COMMANDS, cmd) ? COMMANDS[cmd] : undefined;
  if (!rule || (rule.confirm && !confirmed)) return null;
  // Core deserializes and validates the shape; anything wrong comes back as an error.
  // `cmd` last: an argument named "cmd" must not turn the command into another one.
  return { ...args, cmd } as unknown as Command;
}
