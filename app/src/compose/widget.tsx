// A widget drawn from its composition (PLAN-2 2.7): the frame's topic values, the content
// settings as `opt.*` and the layer's clock and date formatting become the runtime's inputs.
import { useMemo } from "react";
import { makeRamp, type RampName } from "../design-system/color/ramps";
import { toJson } from "../widgets/json";
import { type Value, localeFromTag } from "../expr";
import type { Value as Wire } from "../layer/protocol";
import type { SizeClass } from "../design-system/tokens/tokens";
import type { ResolvedContent } from "../widgets/content";
import { useHost } from "../widgets/host";
import type { WidgetDef } from "../widgets/types";
import { formatDate } from "./dates";
import { CompositionView, type Services } from "./render/View";
import type { Env, Runtime } from "./runtime";

export const EMPTY_ENV: Env = { topics: {}, options: {}, locale: "en", now: () => Date.now() };

/** Every option of the widget, plus the shown fields. */
export function defaultOptions(def: WidgetDef, content: ResolvedContent): Record<string, Value> {
  const out: Record<string, Value> = { fields: [...content.fields], title: content.title };
  for (const o of def.options ?? []) {
    const v = content.opt<string | number | boolean | readonly [number, number]>(o.key);
    out[o.key] = Array.isArray(v) ? [...(v as readonly number[])] : (v as Value);
  }
  return out;
}

const locale = localeFromTag(typeof navigator === "undefined" ? "en" : navigator.language);

export interface ComposedBodyProps {
  runtime: Runtime;
  def: WidgetDef;
  content: ResolvedContent;
  values: Readonly<Record<string, Wire | undefined>>;
  size: SizeClass;
  animate: boolean;
  /** The widget's color source and theme, for ramps. */
  colorSource: number;
  dark: boolean;
}

const hex = (argb: number) => `#${(argb & 0xffffff).toString(16).padStart(6, "0")}`;

export function ComposedBody({
  runtime,
  def,
  content,
  values,
  size,
  animate,
  colorSource,
  dark,
}: ComposedBodyProps) {
  const host = useHost();
  const options = useMemo(
    () => def.compositionOptions?.(content) ?? defaultOptions(def, content),
    [def, content],
  );
  const services = useMemo<Services>(
    () => ({
      command: (cmd) => host.command(cmd),
      history: async (series, seconds) => {
        const r = await host.command({ cmd: "history", series, seconds });
        if (r.result !== "data") return [];
        const j = toJson(r.value);
        const v = typeof j === "object" && j !== null && !Array.isArray(j) ? j.values : null;
        return Array.isArray(v) ? v.filter((n): n is number => typeof n === "number") : [];
      },
      ramp: (name: RampName) => makeRamp(name, colorSource, dark),
    }),
    [host, colorSource, dark],
  );
  const fixed = host.now;
  runtime.setEnv({
    topics: values,
    options,
    locale,
    now: fixed ? () => fixed().getTime() : () => Date.now(),
    date: (ms, skeleton, zone) => formatDate(ms, skeleton, zone),
    ramp: (t, name) =>
      name === "thermal" || name === "load" || name === "health"
        ? hex(services.ramp(name).at(t))
        : null,
  });
  return <CompositionView runtime={runtime} size={size} animate={animate} services={services} />;
}
