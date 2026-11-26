// `date(ms, skeleton, zone)` for the layer (docs/EXPRESSIONS.md §6): an ICU skeleton such as
// 'yMMMd' or 'Hm' becomes Intl.DateTimeFormat options, which pick the locale's own pattern for
// those fields. Formatters are cached per skeleton, zone and locale.

type Opts = Intl.DateTimeFormatOptions;

const cache = new Map<string, Intl.DateTimeFormat | null>();

/** Intl options for an ICU skeleton; unknown letters are ignored. */
export function skeletonOptions(skeleton: string): Opts {
  const o: Opts = {};
  for (const [, run] of skeleton.matchAll(/(([A-Za-z])\2*)/g)) {
    if (!run) continue;
    const n = run.length;
    const twoOr = (one: "numeric") => (n >= 2 ? "2-digit" : one);
    const text = n >= 5 ? "narrow" : n === 4 ? "long" : "short";
    switch (run[0]) {
      case "G":
        o.era = text;
        break;
      case "y":
      case "Y":
        o.year = n === 2 ? "2-digit" : "numeric";
        break;
      case "M":
      case "L":
        o.month = n <= 2 ? twoOr("numeric") : text;
        break;
      case "d":
        o.day = twoOr("numeric");
        break;
      case "E":
      case "c":
        o.weekday = text;
        break;
      case "h":
        o.hour = twoOr("numeric");
        o.hourCycle = "h12";
        break;
      case "K":
        o.hour = twoOr("numeric");
        o.hourCycle = "h11";
        break;
      case "H":
        o.hour = twoOr("numeric");
        o.hourCycle = "h23";
        break;
      case "k":
        o.hour = twoOr("numeric");
        o.hourCycle = "h24";
        break;
      case "j":
        o.hour = twoOr("numeric");
        break;
      case "m":
        o.minute = "2-digit";
        break;
      case "s":
        o.second = "2-digit";
        break;
      case "S":
        o.fractionalSecondDigits = Math.min(3, n) as 1 | 2 | 3;
        break;
      case "z":
        o.timeZoneName = n >= 4 ? "long" : "short";
        break;
      case "v":
        o.timeZoneName = n >= 4 ? "longGeneric" : "shortGeneric";
        break;
      case "O":
        o.timeZoneName = n >= 4 ? "longOffset" : "shortOffset";
        break;
    }
  }
  return o;
}

/** The ISO 8601 week number of `ms` in a zone. */
export function isoWeek(ms: number, zone: string | undefined): number | null {
  let ymd: string;
  try {
    ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(ms);
  } catch {
    return null;
  }
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

/**
 * The date in a zone (`undefined` = the system's) and locale; `null` for an unknown zone. The
 * skeleton `'w'` alone is the ISO week number (Intl has no week field).
 */
export function formatDate(
  ms: number,
  skeleton: string,
  zone: string | undefined,
  locale?: string,
): string | null {
  if (skeleton === "w") {
    const w = Number.isFinite(ms) ? isoWeek(ms, zone) : null;
    return w === null ? null : String(w);
  }
  const key = `${skeleton}|${zone ?? ""}|${locale ?? ""}`;
  let f = cache.get(key);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat(locale, { ...skeletonOptions(skeleton), timeZone: zone });
    } catch {
      f = null;
    }
    if (cache.size > 256) cache.clear();
    cache.set(key, f);
  }
  return f && Number.isFinite(ms) ? f.format(ms) : null;
}
