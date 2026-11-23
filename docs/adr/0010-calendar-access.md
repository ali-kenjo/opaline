# ADR 0010: Calendar access through Evolution Data Server's D-Bus API

Status: accepted (Phase 1, task 1.14) · 2026-11-23

## Context
The brief asks for calendar events from Evolution Data Server (EDS), which GNOME Calendar and GNOME Online Accounts
use, through "the most robust read-only access path", with ICS/webcal subscriptions as a second source. Three paths
exist on this machine (all checked):

| Path | For | Against |
| - | - | - |
| **EDS D-Bus directly**: `org.gnome.evolution.dataserver.Sources5` (sources) and `…Calendar8` (`CalendarFactory.OpenCalendar(uid)` → `Calendar.Open()`, `GetObjectList(sexp)`) | Versioned interfaces (the number bumps on breaking changes); works without GNOME Shell; zbus only | Returns raw iCalendar objects: we expand recurrences and time zones ourselves |
| `libecal` through FFI | Expands recurrences for us | C library, `unsafe` (denied by our lints), GLib main loop in core, large dependency |
| `org.gnome.Shell.CalendarServer` | Expanded instances, honours what the shell's clock menu shows | Private shell API with no stability promise; changed shape in GNOME 3.38 |

Checked here on 2026-11-23: `OpenCalendar("system-calendar")` returned a subprocess object path on
`org.gnome.evolution.dataserver.Calendar8`, `Open()` returned the backend properties, and `GetObjectList` with an
`occur-in-time-range?` query answered (no events in the range at the time).

## Decision
Use EDS's D-Bus API directly. Enabled sources with a `[Calendar]` group and `Selected=true` are read, with their
localized `DisplayName` and `Color`. Objects in the next 14 days are fetched with `occur-in-time-range?`, then
parsed and expanded by our own iCalendar code (`providers/calendar.rs`): line unfolding, text escapes, `DTSTART`/
`DTEND`/`DURATION`, `TZID` through `chrono-tz` (unknown zones such as Windows names fall back to local time),
`RRULE` + `EXDATE` through the `rrule` crate, `RECURRENCE-ID` overrides, and `STATUS:CANCELLED`. The same parser
reads ICS/webcal subscriptions (fetched by core over https, at most 4 MB). Refreshed every 5 minutes while a calendar
widget is subscribed.

## Consequences
- One parser for both sources, and no `unsafe` or GLib loop in core.
- Recurrence edge cases (`RDATE`, `RANGE=THISANDFUTURE`) aren't handled in 1.0; an event with an unsupported rule
  shows its first occurrence instead of disappearing. Parser tests cover the common shapes (weekly with exceptions
  and a moved instance, all-day, cancelled, folded lines).
- If EDS bumps `Calendar8`/`Sources5`, the provider reports "no calendar source" and needs an update, which
  `--diagnose` shows.
