# ADR 0003: dGPU sleep rule and a testable acceptance check

Status: accepted · 2026-11-22

## Context
The brief's acceptance check (§6) is: "on this laptop, with the GPU widget visible, the NVIDIA GPU reaches
`suspended` within 60 s after GPU apps close."

On this machine (see `docs/SENSORS.md` §4):
- `/proc/driver/nvidia/gpus/0000:01:00.0/power` says **`Runtime D3 status: Not supported`**.
- `runtime_suspended_time` is 0: the GPU hasn't runtime-suspended once since boot.
- The external MSI monitor is plugged into `HDMI-A-2`, which is wired to the NVIDIA GPU, and `gnome-shell` keeps
  `/dev/nvidia*` open to drive it.

So the GPU stays awake whatever Opaline does, and the check can't pass here as written.

## Decision
1. Implement the rule exactly as the brief says: check `power/runtime_status` first, never touch NVML or amdgpu
   sysfs while `suspended`, initialise NVML lazily, and shut it down after 10 s without GPU subscribers.
2. Replace the acceptance check with three checks that do prove the behaviour:
   - **Unit/integration:** with a fixture where `runtime_status = suspended`, the GPU provider opens no NVML handle
     and reads no file under the device except `power/runtime_status` (asserted through an instrumented file layer).
   - **On this laptop:** with the GPU widget visible, Opaline holds no `/dev/nvidia*` file descriptor while no GPU
     topic is subscribed, and drops it within 15 s after the GPU widget is removed or covered
     (`ls -l /proc/<pid>/fd`). `nvidia-smi` never lists Opaline as a process.
   - **On a machine with RTD3** (any Turing+ laptop where `Runtime D3 status: Enabled`), the brief's original check.
     If you can't provide one, it moves to a community hardware report before 1.0.
3. Diagnostics shows the GPU's RTD3 status and who holds it awake ("Kept awake by the display on HDMI-A-2"), which
   is useful honest information for users with the same setup.

## Consequences
The rule still protects battery life on laptops that can sleep their dGPU. On this laptop the GPU widget never
shows "Asleep" while the HDMI monitor is connected, and that's correct. If you unplug the monitor, RTD3 is still
"Not supported", so it stays awake; the cause may be the BIOS or the `NVreg_DynamicPowerManagement` setting. That's
outside Opaline's scope, but I can look into it separately if you want.
