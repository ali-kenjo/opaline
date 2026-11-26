// What a widget frame needs from where it runs: live data, the stored settings and a way to
// change them, and the color context. The layer and the Lab provide different implementations.
import type { LookPrefs } from "../design-system/style";
import { createContext, useContext } from "react";
import type { ColorContext, Style } from "../design-system/style";
import type { ActivityClass, Command, CommandResult, Value } from "../layer/protocol";
import type { Json } from "./json";

export interface StoredWidget {
  kind: string;
  style?: Style;
  /** Per-element style overrides keyed by role or `#block-id`. */
  elements?: Record<string, Style>;
  content?: Record<string, Json>;
}

/** Active theme layers supplied by the theme engine (Step 3 / brief §5.2). */
export interface ThemeStyleLayers {
  id: string;
  style?: Style;
  kinds?: Record<string, Style>;
  elements?: Record<string, Style>;
}

export interface StoredSettings {
  /** Active theme id (e.g. `"opaline"`, `"classic"`). */
  theme?: string;
  style: Style;
  /** Per-widget-kind user style overrides. */
  kindStyles?: Record<string, Style>;
  styles: Record<string, Style>;
  widgets: Record<string, StoredWidget>;
  /** The desktop look quick mode and master transparency (default: Glass, unchanged). */
  look?: LookPrefs;
}

export interface WidgetHost {
  /** Subscribes the component to a slice of the latest topic values (a zustand selector hook). */
  useValues<T>(selector: (values: Readonly<Record<string, Value>>) => T): T;
  subscribe(topics: readonly string[], activity: ActivityClass): void;
  settings: StoredSettings;
  /** Active theme's resolved style layers (undefined = built-in Classic defaults). */
  theme?: ThemeStyleLayers | undefined;
  /** A JSON merge patch on settings.json (`null` resets a field). */
  updateSettings(patch: Record<string, Json>): Promise<CommandResult>;
  /** Asks core to act (eject, media, End task, containers); the Lab only pretends. */
  command(cmd: Command): Promise<CommandResult>;
  /** Visualizer frames; returns the unsubscribe function. */
  onSpectrum(listener: (levels: readonly number[]) => void): () => void;
  /** Installed font families (fontconfig), or none outside Opaline. */
  listFonts(): Promise<string[]>;
  colors: ColorContext;
  /** A fixed time (Lab screenshots); unset = the real clock. */
  now?: () => Date;
}

export const HostContext = createContext<WidgetHost | null>(null);

export function useHost(): WidgetHost {
  const host = useContext(HostContext);
  if (!host) throw new Error("widget rendered outside a HostContext");
  return host;
}
