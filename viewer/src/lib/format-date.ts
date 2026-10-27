// Absolute calendar-date formatting via the built-in Intl.DateTimeFormat — no
// external date library (sibling to format-relative.ts, which handles the
// "2 hours ago" relative case). Used by surfaces that show an authored
// creation date, e.g. the CE file page header's "created" timestamp.
//
// The formatter is fixed to "en-US" + medium dateStyle (e.g. "May 1, 2026")
// rather than the runtime locale. On a Server Component this is rendered once
// on the server, so a runtime-locale formatter (toLocaleDateString with no
// args) would key the output to the SERVER's locale, not the visitor's — a
// pinned locale is deterministic and avoids that surprise. Medium dateStyle is
// the format the file-page spec § Header calls for.
//
// The zone is left to the environment by default; a caller may pass `timeZone`
// explicitly to force determinism (e.g. an SSR pass that must pin to UTC, or
// the shared `<Timestamp>` component after hydration pinning to the visitor's
// zone).
const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

// Per-timeZone cache of Intl.DateTimeFormat instances. `<Timestamp>` resolves
// the visitor's zone once per render tree and passes it as `timeZone`, so
// without a cache every rendered row of a feed / token list allocates a fresh
// formatter (~O(ms) construction). Keyed on the timeZone string; effectively
// one entry in production (all rows on a page share the visitor's zone).
const cache = new Map<string, Intl.DateTimeFormat>();

// `iso` is an ISO-8601 / RFC3339 timestamp string (e.g. a file's created_at).
// Returns a localized medium date; on an unparseable input, falls back to the
// raw string rather than surfacing "Invalid Date".
export function formatDate(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  if (timeZone === undefined) {
    return dateFormat.format(date);
  }
  let f = cache.get(timeZone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone });
    cache.set(timeZone, f);
  }
  return f.format(date);
}
