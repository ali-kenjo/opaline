# ADR 0005: Docker endpoint resolution

Status: accepted · 2026-11-22

## Context
The brief's order is `DOCKER_HOST` → current CLI context → `/var/run/docker.sock` → Podman user socket. On this
machine the current context is **`default`** (`unix:///var/run/docker.sock`, which doesn't exist). Docker Desktop's
context `desktop-linux` exists, but the `docker-desktop` user unit is disabled and inactive, so its socket is also
missing. Podman isn't installed. Following the brief's order literally would report "Docker not installed", which
is wrong.

## Decision
Resolution order:
1. `DOCKER_HOST` if set.
2. The current context's endpoint (from `~/.docker/config.json` `currentContext` + `~/.docker/contexts/meta/*`).
3. Every other known context whose endpoint is a local Unix socket that exists (covers `desktop-linux` when the
   current context is `default`).
4. `/var/run/docker.sock`.
5. `$XDG_RUNTIME_DIR/podman/podman.sock`.

If none answers, the state is decided like this:
- `docker-desktop.service` user unit exists but is inactive → **"Docker Desktop is stopped"**, with a Start action
  (`org.freedesktop.systemd1` `StartUnit("docker-desktop.service", "replace")` on the user bus).
- A socket exists but gives `EACCES` → **"Permission denied"**, with guidance (docker group or Docker Desktop).
- Nothing found → **"Docker isn't installed"** (the widget is hidden from the picker, with that reason).

## Consequences
It works on this machine out of the box. Starting Docker Desktop from the widget is a user-bus systemd call, so it
needs no sudo.
