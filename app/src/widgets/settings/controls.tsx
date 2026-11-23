// Small form controls for the widget settings sheet. Values that change while dragging or typing
// are committed after a short pause, so core isn't asked to write settings.json per pixel.
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Icon } from "../../design-system/icons";
import type { Origin } from "../../design-system/style";
import styles from "./settings.module.css";

const COMMIT_DELAY_MS = 250;

/** Local value that follows `value` from outside and commits changes after a pause. */
function useDraft<T>(value: T, commit: (v: T) => void): [T, (v: T) => void] {
  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState(false);
  const [synced, setSynced] = useState(value);
  // A new value from outside (another window, a reset) replaces the draft unless the user is
  // in the middle of changing it.
  if (!pending && !Object.is(synced, value)) {
    setSynced(value);
    setDraft(value);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const change = (v: T) => {
    setDraft(v);
    setPending(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setPending(false);
      commit(v);
    }, COMMIT_DELAY_MS);
  };
  return [draft, change];
}

const ORIGIN_LABEL: Record<Origin, string> = {
  default: "Default",
  global: "From all widgets",
  widget: "This widget",
};

export interface RowProps {
  label: string;
  help?: string | undefined;
  origin?: Origin | undefined;
  onReset?: (() => void) | undefined;
  children: ReactNode;
  htmlFor?: string;
}

export function Row({ label, help, origin, onReset, children, htmlFor }: RowProps) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <label className={styles.rowLabel} htmlFor={htmlFor}>
          {label}
        </label>
        {help ? <div className={styles.help}>{help}</div> : null}
      </div>
      <div className={styles.rowControl}>
        {children}
        {origin ? (
          <span className={`${styles.origin} ${origin === "widget" ? styles.own : ""}`}>
            {ORIGIN_LABEL[origin]}
          </span>
        ) : null}
        {onReset ? (
          <button
            type="button"
            className={styles.iconButton}
            aria-label={`Reset ${label}`}
            title="Reset"
            onClick={onReset}
          >
            <Icon name="restart_alt" size={18} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Select({
  id,
  value,
  options,
  onChange,
  label,
}: {
  id?: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <select
      id={id}
      className={styles.select}
      value={value}
      aria-label={label}
      onChange={(e) => {
        onChange(e.target.value);
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Segmented({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? styles.segOn : undefined}
          onClick={() => {
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TextField({
  id,
  value,
  onCommit,
  maxLength,
  placeholder,
  label,
}: {
  id?: string;
  value: string;
  onCommit: (v: string) => void;
  maxLength: number;
  placeholder?: string | undefined;
  label: string;
}) {
  const [draft, change] = useDraft(value, onCommit);
  return (
    <input
      id={id}
      className={styles.text}
      type="text"
      value={draft}
      maxLength={maxLength}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => {
        change(e.target.value);
      }}
    />
  );
}

export function RangeField({
  value,
  min,
  max,
  step,
  unit,
  ends,
  onCommit,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string | undefined;
  ends?: readonly [string, string] | undefined;
  onCommit: (v: number) => void;
  label: string;
}) {
  const [draft, change] = useDraft(value, onCommit);
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const shown = `${draft.toFixed(decimals)}${unit ? ` ${unit}` : ""}`;
  return (
    <div className={styles.range}>
      {ends ? <span className={styles.end}>{ends[0]}</span> : null}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        aria-label={label}
        aria-valuetext={shown}
        onChange={(e) => {
          change(Number(e.target.value));
        }}
      />
      {ends ? <span className={styles.end}>{ends[1]}</span> : null}
      <output className={styles.value}>{shown}</output>
    </div>
  );
}

export function ColorField({
  value,
  fallback,
  nullLabel,
  onChange,
  label,
}: {
  value: string | null;
  /** What "inherit" currently looks like, for the swatch. */
  fallback: string;
  nullLabel: string;
  onChange: (v: string | null) => void;
  label: string;
}) {
  const [draft, change] = useDraft(value ?? fallback, (v) => {
    onChange(v);
  });
  return (
    <div className={styles.color}>
      <input
        type="color"
        value={(value ? draft : fallback).slice(0, 7)}
        aria-label={label}
        onChange={(e) => {
          change(e.target.value);
        }}
      />
      <span className={styles.hex}>{value ? draft.toUpperCase() : nullLabel}</span>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`${styles.toggle} ${checked ? styles.toggleOn : ""}`}
      onClick={() => {
        onChange(!checked);
      }}
    >
      <span />
    </button>
  );
}

export const BUNDLED_FAMILIES = ["Roboto Flex", "Inter", "Noto Sans Arabic"] as const;

export function FontField({
  value,
  fonts,
  onChange,
  label,
}: {
  value: string;
  fonts: readonly string[];
  onChange: (v: string) => void;
  label: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const installed = fonts.filter((f) => !q || f.toLowerCase().includes(q)).slice(0, 400);
  const known = (BUNDLED_FAMILIES as readonly string[]).includes(value) || fonts.includes(value);
  return (
    <div className={styles.font}>
      <input
        className={styles.text}
        type="search"
        placeholder="Search fonts"
        value={query}
        aria-label={`${label}: search`}
        aria-controls={id}
        onChange={(e) => {
          setQuery(e.target.value);
        }}
      />
      <select
        id={id}
        className={styles.select}
        value={value}
        aria-label={label}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      >
        <optgroup label="Included with Opaline">
          {BUNDLED_FAMILIES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </optgroup>
        {!known ? <option value={value}>{value} (not installed)</option> : null}
        {installed.length ? (
          <optgroup label="Installed on this computer">
            {installed.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      <div
        className={styles.preview}
        style={{ fontFamily: `"${value}", "${value} Variable", sans-serif` }}
      >
        Aa Bb 0123456789 °C %
      </div>
    </div>
  );
}

export function Thresholds({
  value,
  min,
  max,
  step,
  unit,
  onCommit,
  label,
}: {
  value: readonly [number, number];
  min: number;
  max: number;
  step: number;
  unit: string;
  onCommit: (v: [number, number]) => void;
  label: string;
}) {
  const [warn, setWarn] = useState(value[0]);
  const [crit, setCrit] = useState(value[1]);
  const commit = (w: number, c: number) => {
    const lo = Math.min(Math.max(min, w), max);
    const hi = Math.min(Math.max(lo, c), max);
    onCommit([lo, hi]);
  };
  return (
    <div className={styles.thresholds}>
      <label>
        <span className={styles.warnDot} /> Warning
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={warn}
          aria-label={`${label}: warning`}
          onChange={(e) => {
            setWarn(Number(e.target.value));
          }}
          onBlur={() => {
            commit(warn, crit);
          }}
        />
        {unit}
      </label>
      <label>
        <span className={styles.critDot} /> Critical
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={crit}
          aria-label={`${label}: critical`}
          onChange={(e) => {
            setCrit(Number(e.target.value));
          }}
          onBlur={() => {
            commit(warn, crit);
          }}
        />
        {unit}
      </label>
    </div>
  );
}
