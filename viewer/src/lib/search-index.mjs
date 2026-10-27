// Client-side search over the Published Corpus `search-index.json`. Matching,
// filtering, sorting and paging follow `axm search` / `axm query`
// (axiom/cli/cmd/search.go, query.go) so the archive and the CLI agree.

/** The same-origin path the archive build copies `search-index.json` to. */
export const SEARCH_INDEX_PATH = "/search-index.json";

export const DEFAULT_SORT = "created_at:desc";

/**
 * `<key>:<dir>` with key `name` or `created_at`; null when malformed.
 * @param {string} raw
 */
export function parseSort(raw) {
  const [key, dir, extra] = raw.split(":");
  if (extra !== undefined) return null;
  if (key !== "name" && key !== "created_at") return null;
  if (dir !== "asc" && dir !== "desc") return null;
  return { byName: key === "name", desc: dir === "desc" };
}

// RFC 3339 or YYYY-MM-DD (UTC midnight), as the CLI's date flags accept.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;

/**
 * Epoch milliseconds of a date filter value; null when blank or malformed.
 * @param {string} raw
 */
export function parseDateBound(raw) {
  if (!DATE_ONLY.test(raw) && !RFC3339.test(raw)) return null;
  const ms = Date.parse(DATE_ONLY.test(raw) ? `${raw}T00:00:00Z` : raw);
  return Number.isNaN(ms) ? null : ms;
}

function containsFold(s, lowerQuery) {
  return s.toLowerCase().includes(lowerQuery);
}

function timeOf(iso) {
  return iso == null ? 0 : Date.parse(iso);
}

// A row without a publisher or date fails the corresponding filter.
function matchFilters(filters, kind, publisher, createdAt) {
  const { kinds = [], author = "", after = null, before = null } = filters;
  if (kinds.length > 0 && (kind == null || !kinds.includes(kind))) return false;
  const who = author.replace(/^@/, "").toLowerCase();
  if (who !== "" && (publisher == null || publisher.toLowerCase() !== who)) return false;
  const at = createdAt == null ? null : Date.parse(createdAt);
  if (after !== null && (at === null || at < after)) return false;
  if (before !== null && (at === null || at >= before)) return false;
  return true;
}

// Name order is case-insensitive; ties keep index order (Array sort is stable).
function sortRows(rows, sort, nameOf, timeOfRow) {
  const sign = sort.desc ? -1 : 1;
  return rows.sort((a, b) => {
    if (sort.byName) {
      const x = nameOf(a).toLowerCase();
      const y = nameOf(b).toLowerCase();
      return x < y ? -sign : x > y ? sign : 0;
    }
    return sign * (timeOfRow(a) - timeOfRow(b));
  });
}

/** Type heads whose searchable name or type head contains `query`. */
export function searchTypes(index, query, filters, sort) {
  const q = query.toLowerCase();
  const rows = index.types.filter(
    (r) =>
      (containsFold(r.searchable_name, q) || containsFold(r.type_head, q)) &&
      matchFilters({ ...filters, kinds: [] }, r.kind, r.publisher, r.created_at),
  );
  return sortRows(rows, sort, (r) => r.searchable_name, (r) => timeOf(r.created_at));
}

/** Declarations whose fully-qualified name contains `query`. */
export function searchConstants(index, query, filters, sort) {
  const q = query.toLowerCase();
  const rows = index.constants.filter(
    (r) => containsFold(r.name, q) && matchFilters(filters, r.kind, r.publisher, r.created_at),
  );
  return sortRows(rows, sort, (r) => r.name, (r) => timeOf(r.created_at));
}

/** Exported users whose username contains `query`. */
export function searchUsers(index, query, sort) {
  const q = query.toLowerCase();
  const rows = index.users.filter((r) => containsFold(r.username, q));
  return sortRows(rows, sort, (r) => r.username, (r) => timeOf(r.first_published_at));
}

/**
 * Every declaration whose type head is exactly `typeHead`, newest first, and
 * the head's schema row. `known` is false when the index has neither.
 */
export function queryTypeHead(index, typeHead) {
  const schema = index.types.find((t) => t.type_head === typeHead) ?? null;
  const rows = sortRows(
    index.constants.filter((r) => r.type_head === typeHead),
    { byName: false, desc: true },
    (r) => r.name,
    (r) => timeOf(r.created_at),
  );
  return { schema, rows, known: schema !== null || rows.length > 0 };
}

/** One `limit`/`offset` window over sorted rows. */
export function paginate(rows, limit, offset) {
  const start = Math.min(offset, rows.length);
  const end = Math.min(start + limit, rows.length);
  return {
    total: rows.length,
    limit,
    offset,
    has_more: end < rows.length,
    results: rows.slice(start, end),
  };
}
