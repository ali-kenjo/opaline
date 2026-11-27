// A fake core for the Settings and Onboarding windows (the `shell_*` commands of
// app/src/shell/api.ts). Injected before the page loads, like fakeCore.ts; serialized by
// Playwright, so `installFakeShell` must not reach outside its own body.
import type { Json } from "./fakeCore";

export interface FakeShellHandle {
  calls: { cmd: string; args: Json }[];
  state: () => Json;
}

declare global {
  interface Window {
    __fakeShell?: FakeShellHandle;
  }
}

export function installFakeShell(initial: Record<string, Json>): void {
  const w = window as unknown as Record<string, unknown>;
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
  const state: Record<string, Json> = structuredClone(initial);
  const calls: { cmd: string; args: Json }[] = [];
  const secrets = new Map<string, string>();
  const profilesState: {
    version: number;
    activeId: string | null;
    profiles: Record<string, Json>[];
  } = {
    version: 1,
    activeId: null,
    profiles: [],
  };
  const automationState: {
    enabled: boolean;
    manualOverride: boolean;
    manualOverrideReason: string | null;
    activeRuleId: string | null;
    rules: Record<string, Json>[];
    runtime: Record<string, Json>;
    context: Record<string, Json>;
  } = {
    enabled: true,
    manualOverride: false,
    manualOverrideReason: null,
    activeRuleId: null,
    rules: [],
    runtime: {},
    context: {
      workspace: 0,
      focusedApp: "code",
      fullscreen: false,
      monitorCount: 2,
      docked: true,
      locked: false,
      idle: false,
    },
  };
  const sources: {
    specs: Record<string, Json>[];
    statuses: Record<string, Json>[];
  } = {
    specs: [],
    statuses: [
      {
        id: "imported-pack-cmd",
        name: "Imported Pack Status",
        kind: "command",
        topic: "source.imported-pack-cmd",
        state: "needs-approval",
        enabled: true,
        origin: { type: "imported", packageId: "demo-rice", packageVersion: "1.0.0" },
        trustSummary: "Runs command: uname -r",
        trustFingerprint: "abc123",
        lastRunMs: null,
        lastDurationUs: null,
        runCount: 0,
        error: null,
        logs: [],
      },
    ],
  };
  let nextCallback = 1;

  const handle = (cmd: string, args: Record<string, Json>): Json => {
    switch (cmd) {
      case "shell_get_state":
        return structuredClone(state);
      case "shell_update_settings":
        state.settings = merge(state.settings ?? null, args.patch ?? null);
        return null;
      case "shell_update_layouts":
        state.layouts = args.layouts ?? null;
        return null;
      case "shell_set_autostart":
        state.autostart = Boolean(args.enabled);
        return null;
      case "shell_export_backup":
        return JSON.stringify({ settings: state.settings, layouts: state.layouts });
      case "shell_diagnostics":
        return {
          opalineVersion: "test",
          backend: "native",
          helperInstalled: true,
          helperRunning: true,
          helperApiVersion: 1,
          corePssMb: 40,
          totalPssMb: 250,
          processCpuJiffies: 1,
          totalCpuJiffies: 1000,
          processCount: 4,
          providers: { cpu: { cost: "cheap", health: "ok", sample_us: 170 } },
          topics: { "cpu.load": "available" },
          recentLogs: ["test log line"],
          debugReportJson: "{}",
        };
      case "shell_check_updates":
        return {
          currentVersion: "1.1.0",
          latestVersion: "1.1.0",
          updateAvailable: false,
          releaseUrl: "https://example.invalid/release",
          notes: "",
          debUrl: null,
          debName: null,
          checksumsUrl: null,
          signatureUrl: null,
          checkedAt: "2026-11-25T12:00:00Z",
        };
      case "shell_geocode":
        return [{ name: "Berlin", latitude: 52.52, longitude: 13.4, country: "Germany" }];
      case "shell_list_sources":
        return { safeMode: false, specs: sources.specs, statuses: sources.statuses };
      case "shell_save_source": {
        const str = (v: Json | undefined, fallback = "") => (typeof v === "string" ? v : fallback);
        const spec = (args.spec ?? {}) as Record<string, Json>;
        const sid = str(spec.id, "src");
        const sname = str(spec.name, sid);
        const skind = str(spec.kind, "command");
        sources.specs = [...sources.specs.filter((s) => s.id !== sid), spec];
        const status: Record<string, Json> = {
          id: sid,
          name: sname,
          kind: skind,
          topic: skind === "variable" ? `var.${sid}` : `source.${sid}`,
          state: skind === "variable" ? "ok" : "waiting",
          enabled: true,
          origin: { type: "user" },
          trustSummary: `Custom ${skind} source`,
          trustFingerprint: "user-fp",
          lastRunMs: null,
          lastDurationUs: null,
          runCount: 0,
          error: null,
          logs: [],
        };
        sources.statuses = [...sources.statuses.filter((s) => s.id !== sid), status];
        return null;
      }
      case "shell_delete_source": {
        const sid = typeof args.id === "string" ? args.id : "";
        sources.specs = sources.specs.filter((s) => s.id !== sid);
        sources.statuses = sources.statuses.filter((s) => s.id !== sid);
        return null;
      }
      case "shell_approve_source": {
        const sid = typeof args.id === "string" ? args.id : "";
        sources.statuses = sources.statuses.map((s) =>
          s.id === sid ? { ...s, state: "waiting" } : s,
        );
        return null;
      }
      case "shell_revoke_source": {
        const sid = typeof args.id === "string" ? args.id : "";
        sources.statuses = sources.statuses.map((s) =>
          s.id === sid ? { ...s, state: "needs-approval" } : s,
        );
        return null;
      }
      case "shell_run_source_now": {
        const sid = typeof args.id === "string" ? args.id : "";
        sources.statuses = sources.statuses.map((s) =>
          s.id === sid
            ? {
                ...s,
                state: "ok",
                lastRunMs: Date.now(),
                lastDurationUs: 1200,
                runCount: Number(s.runCount ?? 0) + 1,
                logs: [{ atMs: Date.now(), level: "info", message: "Updated in 1.2 ms" }],
              }
            : s,
        );
        return { ok: true, source: sid };
      }
      case "shell_set_variable":
        return null;
      case "shell_list_secrets":
        return [...secrets.keys()].sort();
      case "shell_set_secret": {
        const sname = typeof args.name === "string" ? args.name : "";
        const sval = typeof args.value === "string" ? args.value : "";
        secrets.set(sname, sval);
        return null;
      }
      case "shell_delete_secret": {
        const sname = typeof args.name === "string" ? args.name : "";
        return secrets.delete(sname);
      }
      case "shell_list_profiles":
        return structuredClone(profilesState);
      case "shell_snapshot_profile": {
        const pid = typeof args.id === "string" ? args.id : "profile";
        const pname = typeof args.name === "string" ? args.name : pid;
        const entry: Record<string, Json> = {
          id: pid,
          name: pname,
          theme: "opaline",
          look: "glass",
          appearanceState: "automatic",
          performanceMode: "balanced",
          layouts: null,
          hiddenWidgets: [],
        };
        profilesState.profiles = [...profilesState.profiles.filter((p) => p.id !== pid), entry];
        return entry;
      }
      case "shell_save_profile": {
        const prof = (args.profile ?? {}) as Record<string, Json>;
        const pid = typeof prof.id === "string" ? prof.id : "profile";
        profilesState.profiles = [...profilesState.profiles.filter((p) => p.id !== pid), prof];
        return prof;
      }
      case "shell_delete_profile": {
        const pid = typeof args.id === "string" ? args.id : "";
        profilesState.profiles = profilesState.profiles.filter((p) => p.id !== pid);
        if (profilesState.activeId === pid) profilesState.activeId = null;
        return true;
      }
      case "shell_activate_profile": {
        const pid = typeof args.id === "string" ? args.id : "";
        profilesState.activeId = pid;
        automationState.manualOverride = true;
        automationState.manualOverrideReason = `Manual switch to '${pid}'`;
        return profilesState.profiles.find((p) => p.id === pid) ?? { id: pid, name: pid };
      }
      case "shell_get_automation":
        return structuredClone(automationState);
      case "shell_set_automation_enabled":
        automationState.enabled = Boolean(args.enabled);
        return null;
      case "shell_save_automation_rule": {
        const rule = (args.rule ?? {}) as Record<string, Json>;
        const rid = typeof rule.id === "string" ? rule.id : "rule";
        automationState.rules = [...automationState.rules.filter((r) => r.id !== rid), rule];
        return rule;
      }
      case "shell_delete_automation_rule": {
        const rid = typeof args.id === "string" ? args.id : "";
        automationState.rules = automationState.rules.filter((r) => r.id !== rid);
        return true;
      }
      case "shell_resume_automation":
        automationState.manualOverride = false;
        automationState.manualOverrideReason = null;
        return null;
      case "shell_set_extended_shortcuts": {
        const sc = (state.shortcuts ?? {}) as Record<string, Json>;
        state.shortcuts = {
          ...sc,
          peek: args.peek ?? sc.peek ?? "<Super><Alt>w",
          edit: args.edit ?? sc.edit ?? "<Super><Alt>e",
          nextProfile: args.nextProfile ?? "",
          cycleLook: args.cycleLook ?? "",
          peekPrimary: args.peekPrimary ?? "",
        };
        return null;
      }
      case "shell_wallpaper_asset":
        throw new Error("no assets in tests");
      default:
        return null;
    }
  };

  w.isTauri = true;
  w.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "settings" },
      currentWebview: { windowLabel: "settings", label: "settings" },
    },
    transformCallback(callback: (p: unknown) => void): number {
      const id = nextCallback++;
      w[`_${String(id)}`] = callback;
      return id;
    },
    unregisterCallback(id: number) {
      Reflect.deleteProperty(w, `_${String(id)}`);
    },
    async invoke(cmd: string, args: Record<string, Json> = {}): Promise<unknown> {
      await Promise.resolve();
      calls.push({ cmd, args });
      return handle(cmd, args);
    },
    convertFileSrc: (path: string) => path,
  };
  window.__fakeShell = { calls, state: () => state };
}
