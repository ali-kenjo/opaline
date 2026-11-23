// What a widget frame needs from where it runs: live data, the stored settings and a way to
// change them, and the color context. The layer and the Lab provide different implementations.
import { createContext, useContext } from "react";
import type { ColorContext, Style } from "../design-system/style";
import type { ActivityClass, CommandResult, Value } from "../layer/protocol";
import type { Json } from "./json";

export interface StoredWidget {
  kind: string;
  style?: Style;
  content?: Record<string, Json>;
}

export interface StoredSettings {
  style: Style;
  styles: Record<string, Style>;
  widgets: Record<string, StoredWidget>;
}

export interface WidgetHost {
  /** Subscribes the component to a slice of the latest topic values (a zustand selector hook). */
  useValues<T>(selector: (values: Readonly<Record<string, Value>>) => T): T;
  subscribe(topics: readonly string[], activity: ActivityClass): void;
  settings: StoredSettings;
  /** A JSON merge patch on settings.json (`null` resets a field). */
  updateSettings(patch: Record<string, Json>): Promise<CommandResult>;
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
