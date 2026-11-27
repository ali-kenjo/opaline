# Opaline expressions

Status: Phase 2 (2026-11-26). One small, safe language for widget bindings and templates (TypeScript, in the layer)
and for automation rules and conditional styles (Rust, in core). Both implementations pass the same conformance
corpus in `spec/expressions/`. No `eval`, no `new Function`, no access to anything but the values given to it.

## 1. Two forms

- **Expression**: `cpu.load >= 90 && cpu.temp > 80`, `clamp(battery.percent / 100, 0, 1)`.
- **Template**: text with expressions in braces: `"{cpu.load | round}%"`, `"{weather.current.tempC | unit('°C')} · {weather.current.condition}"`.
  `{{` and `}}` are literal braces. A template always yields a string.

## 2. Values and types

| Type | Literals | Notes |
| - | - | - |
| `number` | `42`, `3.5`, `1e3`, `.5` | 64-bit float; no NaN or infinity escape a function (they become `null`) |
| `string` | `'text'`, `"text"` | escapes `\\` `\'` `\"` `\n` `\t` `\u{1F600}` |
| `bool` | `true`, `false` | |
| `null` | `null` | "no value": missing data, a missing field, a failed conversion |
| `list` | from topics only | indexed with `[n]` (0-based; negative counts from the end) |
| `map` | from topics only | fields with `.name` or `['any key']` |

Colors are strings (`'#rrggbb'`, `'#rrggbbaa'`); durations as arguments are strings (`'30s'`, `'5m'`, `'2h'`, `'1d'`).

**Types are checked where they are known** (literals, function results, arithmetic) and dynamic where they come
from data (topic values). A known mismatch is a compile error with its position (`round('x')`); a mismatch found at
run time makes the result `null` and records an error.

## 3. Grammar

```
template   = { text | "{" expr "}" } ;
expr       = pipe ;
pipe       = coalesce { "|" call_tail } ;          (* x | f(a)  ≡  f(x, a) *)
coalesce   = or { "??" or } ;
or         = and { "||" and } ;
and        = equality { "&&" equality } ;
equality   = compare { ( "==" | "!=" ) compare } ;
compare    = additive { ( "<" | "<=" | ">" | ">=" ) additive } ;
additive   = multiplicative { ( "+" | "-" ) multiplicative } ;
multiplicative = unary { ( "*" | "/" | "%" ) unary } ;
unary      = ( "-" | "!" ) unary | postfix ;
postfix    = primary { "." ident | "[" expr "]" } ;
primary    = number | string | "true" | "false" | "null"
           | ident "(" [ expr { "," expr } ] ")"     (* function call *)
           | path
           | "(" expr ")" ;
call_tail  = ident [ "(" [ expr { "," expr } ] ")" ] ;
path       = ident { "." ident } ;                   (* resolved against the known topics, §5 *)
ident      = ( letter | "_" | "$" ) { letter | digit | "_" } ;
```

Whitespace is free between tokens. Comments don't exist. Keywords: `true`, `false`, `null`.
Limits (they keep hostile input cheap): at most 4096 characters per expression or template (`too-long`) and at
most 64 levels of nesting (`too-deep`). Parentheses, calls, operators and member access each count as a level, so
`a + b + c` nests two deep: evaluation never recurses deeper than 64, whatever the input.

**Precedence** (loosest first): `|`, `??`, `||`, `&&`, `== !=`, `< <= > >=`, `+ -`, `* / %`, unary `- !`,
member access and calls. All binary operators are left-associative. Comparisons don't chain (`a < b < c` is an error).

## 4. Semantics

- **Arithmetic** on numbers only; `+` also joins two strings. Anything with `null` gives `null`. Division by zero
  gives `null`. A result that isn't finite gives `null`.
- **Comparison**: numbers with numbers, strings with strings (code-point order); anything else is a type error.
  `==` and `!=` compare any two values by value (lists and maps deeply); `null == null` is true.
- **Logic**: `&&`, `||` and `!` take bools; `&&` and `||` short-circuit. `null` in a condition counts as false.
- `a ?? b`: `a` unless it is `null`.
- **Member access**: a missing field or index is `null`, never an error.
- **Template holes**: `null` renders as `—` (and the template reports that a value was missing); numbers render
  with the locale's formatting and at most 3 decimals unless a format function says otherwise; bools as `true`/`false`.
- **Errors never escape**: evaluation returns a value and a list of errors. A widget block shows its "unavailable"
  state when its expression errors, never a crash and never a made-up number.

## 5. Paths and topics

A path names data: `cpu.load`, `weather.current.tempC`, `gpu.list[0].name`. Topic names contain dots, so a path is
resolved by **longest known topic prefix**: with topics `weather.current` and `cpu.load`, `weather.current.tempC` is
field `tempC` of topic `weather.current`. An unknown path is `null` and a compile warning.

Special names: `$item` (the current element inside a List block's item template), `$index` (its position), and
variables set from outside (`var.build`, §10 of the brief).

**Automation rules** (core, `automation.json`) see every topic plus `desktop.*` (`workspace`, `focusedApp`,
`fullscreen`, `monitorCount`, `docked`, `locked`, `idle`, `dnd`) and `time.*` from the local wall clock: `time.hour`,
`time.minute`, `time.weekday` (1 = Monday … 7 = Sunday) and `time.isNight`, which is fixed to **before 06:00 or from
21:00 on** (not sunset; write e.g. `time.hour >= 19 || time.hour < 7` for other hours). Rule conditions format numbers in
English (`Locale::En`), whatever the desktop language.

## 6. Functions

Arguments in `[]` are optional. "num?" means the result is `null` when an input is `null`.

### Math
| Function | Result |
| - | - |
| `round(x, [digits])` | num?; half away from zero; `digits` 0 … 10 |
| `floor(x)`, `ceil(x)`, `abs(x)`, `sqrt(x)` | num? |
| `min(a, b, …)`, `max(a, b, …)` | num?; at least two numbers (see history for the two-argument form with a duration) |
| `clamp(x, lo, hi)` | num? |
| `map(x, inMin, inMax, outMin, outMax)` | num?; linear, not clamped; `null` when `inMin == inMax` |
| `if(cond, a, b)` | `a` when `cond` is true, else `b` (only the chosen branch is evaluated) |

### Text
| Function | Result |
| - | - |
| `upper(s)`, `lower(s)`, `trim(s)` | string? |
| `len(x)` | number of characters of a string or elements of a list; `null` otherwise |
| `string(x)` | the value as text (same rules as template holes) |
| `join(list, [sep])` | the elements as text, `sep` default `", "` |
| `has(c, x)` | bool?: a list holds `x` (by value), a map has key `x`, or a string contains `x` |
| `pad(x, width, [char])` | left-pads to `width` (default char `'0'`) |

### Formatting (locale-aware; the locale comes from the host)
Numbers use the locale's decimal and grouping separators (`en` 1,234.5 · `de` 1.234,5). Units follow the number
after a narrow no-break space (U+202F).

| Function | Result |
| - | - |
| `fixed(x, digits)` | the number with exactly `digits` decimals (0 … 10) |
| `percent(x, [digits])` | `x` is 0 … 100: `percent(42.4)` → `42 %` (digits default 0) |
| `unit(x, u, [digits])` | `unit(7, '°C')` → `7 °C`; without `digits`, at most 3 decimals, trailing zeros dropped |
| `bytes(x, [base])` | `'si'` (default; B, kB, MB, GB, TB, factor 1000) or `'iec'` (B, KiB, MiB, GiB, TiB, factor 1024); one decimal from kB up (`1.5 MB`, `268.0 GB`), whole bytes below (`999 B`) |
| `duration(seconds, [style])` | `'short'` (default): `3 h 25 min`, `25 min`, `45 s` (whole units, largest two); `'clock'`: `3:25:07` or `25:07` |

### Color
Colors are `#rrggbb` or `#rrggbbaa` strings; results are lowercase `#rrggbb`, or `#rrggbbaa` when alpha isn't 1.

| Function | Result |
| - | - |
| `mix(c1, c2, t)` | per-channel linear blend in sRGB, `t` 0 … 1 (clamped), channels rounded |
| `alpha(c, a)` | the color with alpha `a` 0 … 1 |
| `lighten(c, amount)` | `amount` 0 … 1 mixes toward white, −1 … 0 toward black (`mix` with `#ffffff` / `#000000`) |

### Time, history and the scheme (provided by the host)
| Function | Result |
| - | - |
| `now()` | current time in ms; templates that use it re-evaluate at the coarsest step their formats need |
| `until(ms)` | seconds from now until `ms` (negative when past) |
| `avg(path, window)`, `min(path, window)`, `max(path, window)`, `delta(path, window)` | over core's history of that path; `window` a duration string; `null` without history. `min`/`max` with a path and a duration literal are the history form |
| `date(ms, [skeleton], [zone])` | ICU skeleton, default `'yMMMd'` (`Nov 23, 2026`); `'Hm'` → `10:09`, `'jm'` → `10:09 AM`; `zone` an IANA name; missing or `null` is the system's. The skeleton `'w'` alone is the ISO 8601 week number. **Layer only**: core knows the signature (so it can check a composition) but returns `null` |
| `ramp(t, name)` | color on the scheme's `'thermal'`, `'load'` or `'health'` ramp, `t` 0 … 1. **Layer only** (needs the scheme; `null` in core) |

The conformance corpus runs the host functions against a fixed test host: `now()` returns the case's `now`, and the
history functions aggregate the values listed for the path under the case's `history` (the window isn't simulated).

Functions not in this list are compile errors. Hosts may add functions (the layer adds `sunrise()`), listed in their
own docs and marked "host" in the corpus.

## 7. Cost

Expressions are **compiled once** (parse, check, collect the paths they read) and **re-evaluated only when one of
their inputs changes**. `now()` makes an expression time-dependent; the host schedules it at the step its formats
need (a `date(now(), 'Hm')` once a minute). Idle means zero evaluations.

## 8. Conformance

`spec/expressions/*.json`: cases of the form

```json
{ "name": "rounding half away from zero", "expr": "round(-2.5)", "data": {}, "expect": -3 }
{ "name": "unknown function", "expr": "frobnicate(1)", "error": "unknown-function" }
{ "name": "template with a missing value", "template": "{cpu.load}%", "data": {}, "expect": "—%" }
```

Error codes: `parse-error`, `unknown-function`, `arity`, `type-error`, `chained-comparison`, `too-long`,
`too-deep`. `data` maps topic names to JSON values; `topics` (optional) lists extra known topic names; `locale` defaults to
`en`. `expect` is the value; `error` is the error code expected at compile or run time. Both implementations run
every case; formatting cases use `en` so that they don't depend on a platform's locale data.
