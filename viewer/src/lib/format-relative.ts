// SSR-friendly relative-time formatting ("2 hours ago", "in 3 days") via the
// built-in Intl.RelativeTimeFormat — no external date library. Used by the CLI
// token list to render last-used / created timestamps.

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

// Cascading divisions from MDN's canonical relative-time recipe: walk from the
// smallest unit up, dividing the running duration by each threshold until it
// fits, so a 90-minute gap reads "an hour ago" rather than "90 minutes ago".
const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: "seconds" },
  { amount: 60, unit: "minutes" },
  { amount: 24, unit: "hours" },
  { amount: 7, unit: "days" },
  { amount: 4.34524, unit: "weeks" },
  { amount: 12, unit: "months" },
  { amount: Number.POSITIVE_INFINITY, unit: "years" },
];

// `iso` is an ISO-8601 timestamp string (e.g. a token's created_at). Returns a
// localized relative phrase; on an unparseable input, falls back to the raw
// string rather than surfacing "Invalid Date".
export function formatRelative(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  let duration = (date.getTime() - Date.now()) / 1000;
  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return rtf.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return rtf.format(Math.round(duration), "years");
}

// formatAbsolute renders the full, localized date + time ("June 28, 2026 at 3:04
// PM GMT-7") for a hover tooltip / `title` next to the relative phrase — so the
// exact moment is one hover away. The short UTC offset is ALWAYS included so
// the wall-clock reading is unambiguous across zones. A caller may pin the
// zone explicitly via `timeZone`; when omitted, the environment default is
// used. Falls back to the raw string on an unparseable input.
//
// Locale is pinned to "en-US" (matches formatDate's explicit anti-drift
// stance): on a Server Component this runs on the server, so a runtime-locale
// call (`toLocaleString(undefined, …)`) would key the output to the SERVER's
// locale, not the visitor's — deterministic + pinned avoids that surprise. It
// also stabilizes the offset literal on the "GMT±N" CLDR en-US form the tests
// and design docs describe.
//
// Explicit y/M/d/h/m fields are used (rather than dateStyle/timeStyle) because
// the Intl spec forbids combining dateStyle/timeStyle with `timeZoneName`.
const absoluteOptions: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "shortOffset",
};
const absoluteFormat = new Intl.DateTimeFormat("en-US", absoluteOptions);

// Per-timeZone cache; keyed on the timeZone string. See format-date.ts's
// same-shaped cache for the rationale — one entry per zone in production,
// avoids reallocating an Intl.DateTimeFormat on every hover-tooltip render.
const absoluteCache = new Map<string, Intl.DateTimeFormat>();

export function formatAbsolute(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  if (timeZone === undefined) {
    return absoluteFormat.format(date);
  }
  let f = absoluteCache.get(timeZone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", { ...absoluteOptions, timeZone });
    absoluteCache.set(timeZone, f);
  }
  return f.format(date);
}
