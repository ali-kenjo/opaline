# ADR 0001: One binary, separate core and layer processes

Status: accepted · 2026-11-22

## Context
The brief (§5.1) describes four processes: core, layer, the GNOME Shell helper and the optional privileged helper.
In Native mode the layer has to be spawned by the shell helper through `Meta.WaylandClient.new_subprocess`, or it
won't be a trusted client and can't be hidden from the window list. Core has to run in both modes and own the tray,
the store and the sensors.

## Decision
- Core and layer are **separate processes from the same `opaline` binary** (`opaline` and `opaline --layer`).
- `opaline-privileged` is a separate minimal binary without Tauri/GTK, because it runs as root.
- The layer never samples sensors. It only renders and talks to core over the IPC socket.

## Consequences
- No version skew between core and layer, because they come from one file. Skew is only possible with the shell
  helper, which is handled by `ApiVersion` N/N−1.
- The layer binary links the sensor code but never runs it. That costs disk space, not RAM.
- A crash in the layer doesn't lose state, because core holds all of it. Core restarts the layer in Instant mode;
  in Native mode the helper respawns it (with backoff).
