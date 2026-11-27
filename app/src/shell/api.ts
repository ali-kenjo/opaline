// Typed bridge to core's shell window commands (Settings and Onboarding).
import type { DesktopLook } from "../design-system/style";
import { invoke } from "@tauri-apps/api/core";
import type { LayoutsDoc } from "../layer/grid";
import type { BackendKind, Monitor } from "../layer/protocol";
import type { Style } from "../design-system/style";
import type { LanguagePref } from "../i18n";

export type AppearanceState = "automatic" | "full" | "dimmed";
export type Density = "compact" | "comfortable" | "spacious";
export type PerformanceMode = "eco" | "balanced" | "realtime";

export interface AlertRule {
  id: string;
  series: string;
  comparator: "above" | "below";
  threshold: number;
  clear?: number | null;
  forS: number;
  cooldownS: number;
  enabled: boolean;
}

export interface WeatherLocation {
  name: string;
  latitude: number;
  longitude: number;
  country?: string | null;
}

export interface CoreSettings {
  version: number;
  theme?: string;
  onboardingDone: boolean;
  language: LanguagePref;
  appearance: {
    state: AppearanceState;
    glass: number;
    density: Density;
    look?: DesktopLook;
    lookColor?: string | null;
    masterTransparency?: number;
  };
  layout: {
    marginPx: number;
  };
  performance: {
    mode: PerformanceMode;
    pauseOnBattery: boolean;
  };
  weather: {
    location: WeatherLocation | null;
    automatic: boolean;
  };
  network: {
    billingDay: number;
    latencyTarget: string;
    publicIp: boolean;
  };
  calendar: {
    system: boolean;
    subscriptions: string[];
  };
  privacy: {
    updateChecks: boolean;
    privilegedSensors: boolean;
  };
  alerts: AlertRule[];
  style: Style;
  styles: Record<string, Style>;
  widgets: Record<string, { kind: string; style?: Style; content?: Record<string, unknown> }>;
}

export interface DesktopStatus {
  backend: BackendKind;
  helperInstalled: boolean;
  helperEnabled: boolean;
  helperRunning: boolean;
  helperApiVersion: number | null;
  helperPath: string | null;
}

export interface ShortcutsState {
  backend: BackendKind;
  editable: boolean;
  peek: string;
  edit: string;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  notes: string;
  debUrl: string | null;
  debName: string | null;
  checksumsUrl: string | null;
  signatureUrl: string | null;
  checkedAt: string;
}

export interface ProviderReport {
  cost: string | null;
  health: unknown;
  sample_us: number | null;
}

export interface LiveDiagnostics {
  opalineVersion: string;
  backend: BackendKind;
  helperInstalled: boolean;
  helperRunning: boolean;
  helperApiVersion: number | null;
  corePssMb: number;
  totalPssMb: number;
  processCpuJiffies: number;
  totalCpuJiffies: number;
  processCount: number;
  providers: Record<string, ProviderReport>;
  topics: Record<string, string>;
  recentLogs: string[];
  debugReportJson: string;
}

export interface GeocodePlace {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

export interface WallpaperMonitorEntry {
  glass?: string;
  backdrop?: string;
  luminance?: number[];
}

export interface ShellState {
  version: string;
  settings: CoreSettings;
  layouts: LayoutsDoc;
  monitors: Monitor[];
  appearance: {
    accentRgb?: number[];
    colorScheme?: string;
    animations?: boolean;
    highContrast?: boolean;
    reducedMotion?: boolean;
    textScale?: number;
  } | null;
  wallpapers: Record<string, WallpaperMonitorEntry> | null;
  autostart: boolean;
  paused: boolean;
  desktop: DesktopStatus;
  shortcuts: ShortcutsState;
  latestUpdate: UpdateInfo | null;
}

export const inTauriShell = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function getShellState(): Promise<ShellState> {
  return await invoke<ShellState>("shell_get_state");
}

export async function patchSettings(patch: Record<string, unknown>): Promise<void> {
  await invoke("shell_update_settings", { patch });
}

export async function resetSettings(): Promise<void> {
  await invoke("shell_reset_settings");
}

export async function saveLayouts(layouts: LayoutsDoc): Promise<void> {
  await invoke("shell_update_layouts", { layouts });
}

export async function setAutostart(enabled: boolean): Promise<void> {
  await invoke("shell_set_autostart", { enabled });
}

export async function setHelperEnabled(enabled: boolean): Promise<void> {
  await invoke("shell_set_helper_enabled", { enabled });
}

export async function setNativeShortcuts(peek: string, edit: string): Promise<void> {
  await invoke("shell_set_shortcuts", { peek, edit });
}

export async function exportBackup(): Promise<string> {
  return await invoke<string>("shell_export_backup");
}

export async function importBackup(json: string): Promise<void> {
  await invoke("shell_import_backup", { json });
}

export async function getDiagnostics(): Promise<LiveDiagnostics> {
  return await invoke<LiveDiagnostics>("shell_diagnostics");
}

export async function checkUpdates(): Promise<UpdateInfo> {
  return await invoke<UpdateInfo>("shell_check_updates");
}

export async function installUpdate(): Promise<string> {
  return await invoke<string>("shell_install_update");
}

export async function triggerAction(
  action:
    | "peek"
    | "edit"
    | "pause"
    | "resume"
    | "open-settings"
    | "open-onboarding"
    | "quit"
    | "test-alert",
): Promise<void> {
  await invoke("shell_trigger_action", { action });
}

export async function geocodePlaces(query: string, language = "en"): Promise<GeocodePlace[]> {
  const raw = await invoke<unknown>("shell_geocode", { query, language });
  if (!Array.isArray(raw)) return [];
  const out: GeocodePlace[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (
      typeof r.name === "string" &&
      typeof r.latitude === "number" &&
      typeof r.longitude === "number"
    ) {
      out.push({
        name: r.name,
        latitude: r.latitude,
        longitude: r.longitude,
        ...(typeof r.country === "string" ? { country: r.country } : {}),
        ...(typeof r.admin1 === "string" ? { admin1: r.admin1 } : {}),
      });
    }
  }
  return out;
}

export async function fetchWallpaperBlobUrl(assetUrl: string): Promise<string | null> {
  if (!inTauriShell) return null;
  try {
    const bytes = await invoke<ArrayBuffer>("shell_wallpaper_asset", { url: assetUrl });
    const blob = new Blob([bytes], { type: "image/png" });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export async function closeWindow(): Promise<void> {
  await invoke("shell_close");
}

export type OutputFormat = "text" | "lines" | "json" | "csv" | "regex" | "markdown" | "todotxt";
export type SourceState = "ok" | "error" | "waiting" | "needs-approval" | "disabled";
export type SourceOrigin =
  { type: "user" } | { type: "imported"; packageId: string; packageVersion: string };

export type SourceSpec = {
  version: number;
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  origin: SourceOrigin;
} & (
  | {
      kind: "command";
      argv: string[];
      shell: boolean;
      intervalS: number;
      timeoutMs: number;
      maxBytes: number;
      envAllowlist: string[];
      format: OutputFormat;
      regex?: string;
    }
  | {
      kind: "file";
      path: string;
      maxBytes: number;
      format: OutputFormat;
      jsonPath?: string;
    }
  | {
      kind: "http";
      url: string;
      allowLocalHttp: boolean;
      intervalS: number;
      timeoutMs: number;
      maxBytes: number;
      headers: Record<string, string>;
      format: OutputFormat;
      jsonPath?: string;
    }
  | {
      kind: "dbus";
      bus: "session" | "system";
      destination: string;
      path: string;
      interface: string;
      member: string;
      mode: "property" | "signal";
      intervalS: number;
    }
  | {
      kind: "mqtt";
      host: string;
      port: number;
      tls: boolean;
      topic: string;
      clientId?: string;
      usernameSecret?: string;
      passwordSecret?: string;
      format: OutputFormat;
      jsonPath?: string;
    }
  | {
      kind: "variable";
      persist: boolean;
      defaultValue?: unknown;
    }
);

export interface SourceLogEntry {
  atMs: number;
  level: string;
  message: string;
}

export interface SourceRuntimeStatus {
  id: string;
  name: string;
  kind: string;
  topic: string;
  state: SourceState;
  enabled: boolean;
  origin: SourceOrigin;
  trustSummary: string;
  trustFingerprint: string;
  lastRunMs: number | null;
  lastDurationUs: number | null;
  runCount: number;
  error: string | null;
  logs: SourceLogEntry[];
}

export interface SourcesCatalog {
  safeMode: boolean;
  specs: SourceSpec[];
  statuses: SourceRuntimeStatus[];
}

export async function listSources(): Promise<SourcesCatalog> {
  return await invoke<SourcesCatalog>("shell_list_sources");
}

export async function saveSource(spec: SourceSpec): Promise<void> {
  await invoke("shell_save_source", { spec });
}

export async function deleteSource(id: string): Promise<void> {
  await invoke("shell_delete_source", { id });
}

export async function approveSource(id: string): Promise<void> {
  await invoke("shell_approve_source", { id });
}

export async function revokeSource(id: string): Promise<void> {
  await invoke("shell_revoke_source", { id });
}

export async function runSourceNow(id: string): Promise<unknown> {
  return await invoke<unknown>("shell_run_source_now", { id });
}

export async function setVariable(name: string, value: unknown): Promise<void> {
  await invoke("shell_set_variable", { name, value });
}

export async function listSecrets(): Promise<string[]> {
  return await invoke<string[]>("shell_list_secrets");
}

export async function setSecret(name: string, value: string): Promise<void> {
  await invoke("shell_set_secret", { name, value });
}

export async function deleteSecret(name: string): Promise<boolean> {
  return await invoke<boolean>("shell_delete_secret", { name });
}
