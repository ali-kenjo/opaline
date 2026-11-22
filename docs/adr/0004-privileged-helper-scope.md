# ADR 0004: Privileged helper only reads RAPL in 1.0

Status: accepted · 2026-11-22

## Context
The brief plans two privileged methods: `GetCpuEnergy()` (RAPL) and `GetNvmeSmart(device)`. On this machine:
- RAPL `energy_uj` is `0400 root` → Permission denied for the user. Root is required.
- UDisks2 `org.freedesktop.UDisks2.NVMe.Controller.SmartGetAttributes` returned the full SMART/health log without
  root or a polkit prompt, and `Drive.Ata` SMART properties are readable for the SATA drive too.

## Decision
- 1.0 ships `opaline-privileged` with **only `GetCpuEnergy()`**.
- Storage health always comes from UDisks2. If UDisks2 denies SMART on some system, the widget shows
  "Needs permission" with a link to the troubleshooting docs, instead of adding a second root code path.
- Onboarding step 5 becomes "Show CPU power", since full SSD health doesn't need the helper.

## Consequences
The root-running surface is smaller: one method, a fixed allow-list of sysfs paths, no user-supplied arguments. If
hardware reports show UDisks2 failing in practice, `GetNvmeSmart` can be added later behind the same polkit action.
