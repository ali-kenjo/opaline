// Hostile-plugin security suite (PLAN-2 9.2, ADR 0014):
// Verifies strict origin/source isolation, declared-topic filtering, command allow-list,
// sandbox attribute hardening, prototype-pollution & payload-size rejection, and watchdog
// termination of hung/busy-loop workers without affecting healthy siblings.
import { describe, expect, it, vi } from "vitest";
import {
  PLUGIN_SANDBOX_ATTR,
  PluginWatchdog,
  filterAllowedTopics,
  isAllowedPluginCommand,
  isTrustedPluginEvent,
  isValidPluginId,
  sanitizePluginOutput,
} from "./pluginSandbox";

describe("Hostile-plugin sandbox invariants (ADR 0014 / PLAN-2 9.2)", () => {
  it("sandbox attribute excludes top-navigation, popups, forms, and modals", () => {
    const tokens = new Set(PLUGIN_SANDBOX_ATTR.split(/\s+/));
    expect(tokens.has("allow-scripts")).toBe(true);
    expect(tokens.has("allow-same-origin")).toBe(true);
    expect(tokens.has("allow-top-navigation")).toBe(false);
    expect(tokens.has("allow-top-navigation-by-user-activation")).toBe(false);
    expect(tokens.has("allow-popups")).toBe(false);
    expect(tokens.has("allow-forms")).toBe(false);
    expect(tokens.has("allow-modals")).toBe(false);
  });

  it("rejects spoofed origins, cross-plugin messages, and wrong event.source", () => {
    const fakeFrameWin = { id: "frame-1" };
    const otherWin = { id: "frame-2" };

    expect(
      isTrustedPluginEvent(
        { origin: "opaline-plugin://demo-gauge", source: fakeFrameWin },
        "demo-gauge",
        fakeFrameWin,
      ),
    ).toBe(true);

    // Spoofed origins rejected
    expect(
      isTrustedPluginEvent(
        { origin: "https://evil.example", source: fakeFrameWin },
        "demo-gauge",
        fakeFrameWin,
      ),
    ).toBe(false);
    expect(
      isTrustedPluginEvent(
        { origin: "tauri://localhost", source: fakeFrameWin },
        "demo-gauge",
        fakeFrameWin,
      ),
    ).toBe(false);
    // Another plugin's origin rejected (no cross-plugin interference)
    expect(
      isTrustedPluginEvent(
        { origin: "opaline-plugin://other-plugin", source: fakeFrameWin },
        "demo-gauge",
        fakeFrameWin,
      ),
    ).toBe(false);
    // Wrong window source rejected
    expect(
      isTrustedPluginEvent(
        { origin: "opaline-plugin://demo-gauge", source: otherWin },
        "demo-gauge",
        fakeFrameWin,
      ),
    ).toBe(false);
    // Reserved spike id and invalid ids rejected
    expect(isValidPluginId("spike")).toBe(false);
    expect(isValidPluginId("../escape")).toBe(false);
  });

  it("filters topics strictly to manifest-declared topics (cannot snoop on secrets/notes/calendar)", () => {
    const allTopics = {
      "cpu.load": 42,
      "notes.active": "private journal",
      "calendar.events": ["secret meeting"],
      "network.publicIp": "203.0.113.5",
    };
    const visible = filterAllowedTopics(allTopics, ["cpu.load"]);
    expect(Object.keys(visible)).toEqual(["cpu.load"]);
    expect(visible["cpu.load"]).toBe(42);
    expect("notes.active" in visible).toBe(false);
    expect("network.publicIp" in visible).toBe(false);
  });

  it("enforces BOTH global command allowlist AND manifest-approved actions", () => {
    expect(isAllowedPluginCommand("media-toggle", ["media-toggle"])).toBe(true);
    // Allowlisted globally, but NOT declared in this plugin's manifest -> rejected
    expect(isAllowedPluginCommand("control-toggle", ["media-toggle"])).toBe(false);
    // Dangerous / non-allowlisted commands -> always rejected even if listed in manifest
    expect(isAllowedPluginCommand("end-task", ["end-task"])).toBe(false);
    expect(isAllowedPluginCommand("drive-eject", ["drive-eject"])).toBe(false);
    expect(isAllowedPluginCommand("shell-exec", ["shell-exec"])).toBe(false);
  });

  it("rejects prototype pollution and oversized memory-blowup payloads from hostile workers", () => {
    const polluted = JSON.parse('{"value":"ok","__proto__":{"polluted":true}}') as unknown;
    expect(sanitizePluginOutput(polluted)).toBeNull();

    // > 256 KiB payload rejected cleanly
    const huge = { value: "x".repeat(300_000) };
    expect(sanitizePluginOutput(huge)).toBeNull();

    // Clean structured output accepted and clamped
    const clean = sanitizePluginOutput({ title: "Gauge", value: "42%", progress: 1.5 });
    expect(clean).toEqual({ title: "Gauge", value: "42%", progress: 1 });
  });

  it("watchdog terminates hung/busy-loop plugin with backoff while healthy sibling keeps running", () => {
    const hostileTerm = vi.fn();
    const healthyTerm = vi.fn();

    const hostile = new PluginWatchdog(
      { timeoutMs: 2000, maxRestarts: 3, onTerminate: hostileTerm },
      10_000,
    );
    const healthy = new PluginWatchdog(
      { timeoutMs: 2000, maxRestarts: 3, onTerminate: healthyTerm },
      10_000,
    );

    // Healthy plugin answers heartbeats; hostile plugin enters an infinite loop.
    healthy.recordPong(11_000);
    expect(healthy.check(12_500)).toBe(false);
    expect(hostile.check(12_500)).toBe(true);
    expect(hostile.health).toBe("unavailable");
    expect(hostileTerm).toHaveBeenCalledTimes(1);
    expect(hostileTerm).toHaveBeenLastCalledWith("heartbeat-timeout", 1000, false);
    expect(healthyTerm).not.toHaveBeenCalled();

    // Repeated hangs hit maxRestarts and permanently stop the hostile plugin.
    expect(hostile.check(16_000)).toBe(true);
    expect(hostile.check(21_000)).toBe(true);
    expect(hostile.health).toBe("crashed");
    expect(hostileTerm).toHaveBeenLastCalledWith("heartbeat-timeout", 4000, true);

    // Sibling remains healthy throughout.
    healthy.recordPong(20_500);
    expect(healthy.check(21_000)).toBe(false);
    expect(healthy.health).toBe("ready");
  });
});
