// What every node component of the renderer shares: the runtime, the list scope, and the
// services blocks need from where they run (commands, history, color ramps).
import { type CSSProperties, createContext, useContext } from "react";
import type { Ramp, RampName } from "../../design-system/color/ramps";
import { space } from "../../design-system/tokens/tokens";
import type { Value } from "../../expr";
import { text } from "../../expr/format";
import type { Command, CommandResult } from "../../layer/protocol";
import type { Runtime, Scope } from "../runtime";

export interface Services {
  /** Sends a command to core (which validates it); the Lab only pretends. */
  command(cmd: Command): Promise<CommandResult>;
  /** Core's history of a series over the last `seconds`. */
  history(series: string, seconds: number): Promise<number[]>;
  /** A meaning ramp in the widget's colors. */
  ramp(name: RampName): Ramp;
}

export interface ViewCtx {
  rt: Runtime;
  scope: Scope | undefined;
  animate: boolean;
  services: Services | undefined;
}

export const Ctx = createContext<ViewCtx | null>(null);

export function useView(): ViewCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("composition node rendered outside a CompositionView");
  return v;
}

export interface FieldValue {
  value: Value;
  failed: boolean;
  present: boolean;
}

/** Reads fields of the node at `at` (`"value"`, `"params/ms"`). */
export function useField(at: string): (key: string) => FieldValue {
  const { rt, scope } = useView();
  return (key) => {
    const id = `${at}/${key}`;
    if (!rt.has(id)) return { value: null, failed: false, present: false };
    const o = rt.read(id, scope);
    return { value: o.value, failed: o.errors.length > 0, present: true };
  };
}

export type Attrs = Record<string, string | undefined>;

/** Inline style with the renderer's custom properties. */
export type CSSVars = CSSProperties & Record<`--${string}`, string | number | undefined>;
export const vars = (o: CSSVars): CSSProperties => o;

/** A spacing step (0 … 8) of the 4-pt scale in px. */
export const px = (step: number | undefined) =>
  step === undefined ? undefined : `${String(space[Math.min(8, Math.max(0, step))] ?? 0)}px`;

export const asString = (v: Value) => (typeof v === "string" ? v : v === null ? "" : text(v, "en"));

export const ratio = (v: Value) => (typeof v === "number" ? Math.min(1, Math.max(0, v)) : null);

export const numbers = (v: Value): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];

/** A CSS color from an expression's value, or undefined (the role's color). */
export const cssColor = (v: Value): string | undefined =>
  typeof v === "string" && /^(#[0-9a-f]{3,8}|rgba?\([^;{}]*\)|var\(--[a-z0-9-]+\))$/i.test(v)
    ? v
    : undefined;
