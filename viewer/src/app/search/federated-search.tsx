"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { profilePath } from "@/lib/profile-path";
import {
  DEFAULT_SORT,
  paginate,
  parseDateBound,
  parseSort,
  searchConstants,
  searchTypes,
  searchUsers,
  type Page,
  type SearchFilters,
  type SearchIndex,
  type UserRow,
} from "@/lib/search-index.mjs";
import { Timestamp } from "@/components/ui/timestamp";

import { Pager } from "./pager";
import { ConstantResultRow, RowActionRegion, TypeHeadResultRow } from "./result-rows";
import { PAGE_SIZE, SEARCH_PATH } from "./search-route";

type DomainKey = "users" | "types" | "constants";

// Presentation order of the chips, facet cards and result sections.
const DOMAINS: { key: DomainKey; label: string }[] = [
  { key: "users", label: "Users" },
  { key: "types", label: "Type heads" },
  { key: "constants", label: "Constants" },
];

const DOMAIN_ACCENT: Record<DomainKey, string> = {
  users: "var(--base0B)",
  types: "var(--base0D)",
  constants: "var(--base0C)",
};

const SORTS: { value: string; label: string }[] = [
  { value: "name:asc", label: "Name (A→Z)" },
  { value: "created_at:desc", label: "Newest first" },
  { value: "created_at:asc", label: "Oldest first" },
];

// `kind` values in `search-index.json` constants.
const KIND_FILTER: { value: string; label: string }[] = [
  { value: "theorem", label: "Theorems" },
  { value: "definition", label: "Definitions" },
  { value: "axiom", label: "Axioms" },
  { value: "inductive_type", label: "Inductive types" },
  { value: "opaque", label: "Opaque" },
];

// The query-string keys this view owns; others (`def`) are preserved.
const OWN_PARAMS = ["q", "in", "sort", "kind", "author", "created_after", "created_before"];

const ALL_DOMAINS: Record<DomainKey, boolean> = { users: true, types: true, constants: true };
const FIRST_PAGES: Record<DomainKey, number> = { users: 0, types: 0, constants: 0 };

function domainsFromParam(inParam: string | null): Record<DomainKey, boolean> {
  if (inParam === null) return ALL_DOMAINS;
  const set = new Set(inParam.split(","));
  return { users: set.has("users"), types: set.has("types"), constants: set.has("constants") };
}

/** A filter value the CLI would reject, as an error line; null when valid. */
function invalidDate(name: string, raw: string): string | null {
  return raw !== "" && parseDateBound(raw) === null
    ? `${name} must be RFC3339 or YYYY-MM-DD (got "${raw}"); the filter is ignored.`
    : null;
}

export function FederatedSearch({
  index,
  onInspect,
}: {
  index: SearchIndex;
  onInspect: (defId: string) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [q, setQ] = React.useState(() => searchParams.get("q") ?? "");
  const [domains, setDomains] = React.useState(() => domainsFromParam(searchParams.get("in")));
  const [sort, setSort] = React.useState(() => searchParams.get("sort") || DEFAULT_SORT);
  const [kinds, setKinds] = React.useState<string[]>(
    () => searchParams.get("kind")?.split(",").filter(Boolean) ?? [],
  );
  const [author, setAuthor] = React.useState(() => searchParams.get("author") ?? "");
  const [createdAfter, setCreatedAfter] = React.useState(
    () => searchParams.get("created_after") ?? "",
  );
  const [createdBefore, setCreatedBefore] = React.useState(
    () => searchParams.get("created_before") ?? "",
  );
  const [advancedOpen, setAdvancedOpen] = React.useState(() =>
    ["kind", "author", "created_after", "created_before"].some((k) => searchParams.has(k)),
  );
  const [offsets, setOffsets] = React.useState(FIRST_PAGES);

  const activeDomains = DOMAINS.filter((d) => domains[d.key]).map((d) => d.key);
  const kindsParam = kinds.join(",");
  const advancedCount =
    (kinds.length ? 1 : 0) + (author ? 1 : 0) + (createdAfter ? 1 : 0) + (createdBefore ? 1 : 0);

  // Any change to the search returns every section to its first page.
  React.useEffect(() => {
    setOffsets(FIRST_PAGES);
  }, [q, sort, kindsParam, author, createdAfter, createdBefore]);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    for (const k of OWN_PARAMS) params.delete(k);
    if (q) params.set("q", q);
    if (!DOMAINS.every((d) => domains[d.key])) params.set("in", activeDomains.join(","));
    if (sort !== DEFAULT_SORT) params.set("sort", sort);
    if (kindsParam) params.set("kind", kindsParam);
    if (author) params.set("author", author);
    if (createdAfter) params.set("created_after", createdAfter);
    if (createdBefore) params.set("created_before", createdBefore);
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
    );
  }, [q, domains, activeDomains, sort, kindsParam, author, createdAfter, createdBefore]);

  const parsedSort = parseSort(sort);
  const errors = [
    parsedSort === null
      ? `sort must be <key>:<dir> with key name or created_at and dir asc or desc (got "${sort}"); showing newest first.`
      : null,
    invalidDate("created_after", createdAfter),
    invalidDate("created_before", createdBefore),
  ].filter((e): e is string => e !== null);

  const results = React.useMemo(() => {
    const order = parseSort(sort) ?? parseSort(DEFAULT_SORT)!;
    const filters: SearchFilters = {
      kinds: kindsParam ? kindsParam.split(",") : [],
      author,
      after: parseDateBound(createdAfter),
      before: parseDateBound(createdBefore),
    };
    return {
      users: searchUsers(index, q, order),
      types: searchTypes(index, q, filters, order),
      constants: searchConstants(index, q, filters, order),
    };
  }, [index, q, sort, kindsParam, author, createdAfter, createdBefore]);

  const pages = {
    users: paginate(results.users, PAGE_SIZE, offsets.users),
    types: paginate(results.types, PAGE_SIZE, offsets.types),
    constants: paginate(results.constants, PAGE_SIZE, offsets.constants),
  };
  const shown = activeDomains.reduce((n, k) => n + pages[k].results.length, 0);
  const onPage = (key: DomainKey) => (offset: number) =>
    setOffsets((prev) => ({ ...prev, [key]: offset }));

  const openQuery = (typeHead: string) => {
    const next = new URLSearchParams({ type_head: typeHead });
    if (q) next.set("from_q", q);
    router.push(`${SEARCH_PATH}?${next.toString()}`);
  };

  return (
    <div className="mx-auto w-full max-w-[1080px] px-4 py-8 sm:px-6">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search the archive"
        aria-label="Search the archive"
        className="w-full rounded-xl border border-[var(--base02)] bg-background px-5 py-4 font-mono text-base text-foreground shadow-[var(--shadow-float)] outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Search domains">
          {DOMAINS.map((d) => (
            <DomainCheckbox
              key={d.key}
              label={d.label}
              checked={domains[d.key]}
              onToggle={() => setDomains((prev) => ({ ...prev, [d.key]: !prev[d.key] }))}
            />
          ))}
        </div>
        <label className="flex items-center gap-2 text-muted-foreground">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-md border border-[var(--base02)] bg-background px-2 py-1 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            aria-expanded={advancedOpen}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--base02)] bg-background px-3 py-1 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Advanced
            {advancedCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 font-mono text-[11px] leading-[18px] text-primary-foreground">
                {advancedCount}
              </span>
            )}
          </button>
          <span className="font-mono text-xs text-muted-foreground">{shown} shown</span>
        </div>
      </div>

      {advancedOpen && (
        <AdvancedPanel
          domains={domains}
          counts={{ constants: results.constants.length }}
          kinds={kinds}
          toggleKind={(v) =>
            setKinds((prev) => (prev.includes(v) ? prev.filter((k) => k !== v) : [...prev, v]))
          }
          author={author}
          setAuthor={setAuthor}
          createdAfter={createdAfter}
          setCreatedAfter={setCreatedAfter}
          createdBefore={createdBefore}
          setCreatedBefore={setCreatedBefore}
          clear={
            advancedCount > 0
              ? () => {
                  setKinds([]);
                  setAuthor("");
                  setCreatedAfter("");
                  setCreatedBefore("");
                }
              : null
          }
        />
      )}

      {errors.map((e) => (
        <p
          key={e}
          role="alert"
          className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {e}
        </p>
      ))}

      {activeDomains.length === 0 && (
        <p className="mt-6 text-sm text-muted-foreground">Select at least one domain to search.</p>
      )}

      <div className="mt-6 space-y-6">
        {activeDomains.map((key) => {
          switch (key) {
            case "users":
              return (
                <SectionCard key={key} domainKey={key} title="Users" page={pages.users} onPage={onPage(key)}>
                  {pages.users.results.map((row) => (
                    <UserResultRow key={row.username} row={row} />
                  ))}
                </SectionCard>
              );
            case "types":
              return (
                <SectionCard key={key} domainKey={key} title="Type heads" page={pages.types} onPage={onPage(key)}>
                  {pages.types.results.map((row) => (
                    <li key={row.type_head} className="flex items-stretch" data-type-head={row.type_head}>
                      <TypeHeadResultRow
                        row={row}
                        onInspect={onInspect}
                        action={
                          <RowActionRegion variant="button" onClick={() => openQuery(row.type_head)}>
                            Query instances →
                          </RowActionRegion>
                        }
                      />
                    </li>
                  ))}
                </SectionCard>
              );
            case "constants":
              return (
                <SectionCard
                  key={key}
                  domainKey={key}
                  title="Constants"
                  page={pages.constants}
                  onPage={onPage(key)}
                >
                  {pages.constants.results.map((row) => (
                    <ConstantResultRow key={row.def_id} row={row} onInspect={onInspect} />
                  ))}
                </SectionCard>
              );
          }
        })}
      </div>
    </div>
  );
}

function SectionCard<T>({
  domainKey,
  title,
  page,
  onPage,
  children,
}: {
  domainKey: DomainKey;
  title: string;
  page: Page<T>;
  onPage: (offset: number) => void;
  children: React.ReactNode;
}) {
  const headingId = `search-section-${domainKey}`;
  return (
    <section
      data-domain={domainKey}
      aria-labelledby={headingId}
      className="overflow-hidden rounded-xl border border-[var(--base02)] bg-background shadow-[var(--shadow-float)]"
    >
      <header className="flex items-baseline justify-between border-b border-[var(--base02)] px-4 py-3">
        <h2
          id={headingId}
          className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-foreground"
        >
          {title}
          <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground">
            {page.total}
          </span>
        </h2>
      </header>
      {page.results.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">No matches.</p>
      ) : (
        <ul className="divide-y divide-[var(--base02)]">{children}</ul>
      )}
      {page.total > page.limit && (
        <div className="border-t border-[var(--base02)] px-4 py-2.5">
          <Pager total={page.total} limit={page.limit} offset={page.offset} onOffsetChange={onPage} />
        </div>
      )}
    </section>
  );
}

// Every users row is an exported user, and each has a profile page.
function UserResultRow({ row }: { row: UserRow }) {
  return (
    <li className="flex items-stretch">
      <div className="min-w-0 flex-1 py-3 pl-4 pr-2 font-sans">
        <div className="text-sm font-semibold text-foreground">@{row.username}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {row.first_published_at !== null ? (
            <>
              First published <Timestamp iso={row.first_published_at} />
            </>
          ) : (
            "No published files"
          )}
        </div>
      </div>
      <RowActionRegion variant="link" href={profilePath(row.username)}>
        Profile →
      </RowActionRegion>
    </li>
  );
}

// A visually-hidden native checkbox with a styled square, keeping keyboard
// and accessibility semantics.
function DomainCheckbox({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="group inline-flex cursor-pointer select-none items-center gap-2 rounded-full border border-[var(--base02)] bg-background px-3 py-1 text-sm text-muted-foreground transition-colors has-[:checked]:border-primary has-[:checked]:text-foreground">
      <input type="checkbox" checked={checked} onChange={onToggle} className="peer sr-only" />
      <span
        aria-hidden
        className="inline-block h-[13px] w-[13px] shrink-0 rounded-[4px] border-[1.5px] border-muted-foreground/70 transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:shadow-[inset_0_0_0_2px_var(--color-background)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
      />
      {label}
    </label>
  );
}

// The shared author and date facets apply to Type heads and Constants; kind
// applies to Constants only. Users has no facet with an index field.
function AdvancedPanel({
  domains,
  counts,
  kinds,
  toggleKind,
  author,
  setAuthor,
  createdAfter,
  setCreatedAfter,
  createdBefore,
  setCreatedBefore,
  clear,
}: {
  domains: Record<DomainKey, boolean>;
  counts: { constants: number };
  kinds: string[];
  toggleKind: (v: string) => void;
  author: string;
  setAuthor: (v: string) => void;
  createdAfter: string;
  setCreatedAfter: (v: string) => void;
  createdBefore: string;
  setCreatedBefore: (v: string) => void;
  clear: (() => void) | null;
}) {
  const fieldCls =
    "w-full rounded-md border border-[var(--base02)] bg-background px-2 py-1 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const labelCls = "mb-1 block font-mono text-[11px] text-muted-foreground";
  const accent = DOMAIN_ACCENT.constants;
  return (
    <section
      aria-label="Advanced search"
      className="mt-3 overflow-hidden rounded-xl border border-[var(--base02)] bg-background shadow-[var(--shadow-float)]"
    >
      <div className="flex items-center gap-3 border-b border-[var(--base02)] px-4 py-3">
        <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-foreground">
          Advanced search
        </h2>
        {clear && (
          <button
            type="button"
            onClick={clear}
            className="ml-auto rounded text-xs font-medium text-primary hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>
      <div className="border-b border-[var(--base02)] p-4">
        <div className="mb-3 font-mono text-[10.5px] tracking-[0.1em] text-muted-foreground uppercase">
          Shared <span className="tracking-normal normal-case">· applies to Type heads · Constants</span>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="min-w-[170px] flex-1">
            <span className={labelCls}>Published by</span>
            <input
              type="text"
              className={fieldCls}
              value={author}
              placeholder="@username"
              onChange={(e) => setAuthor(e.target.value)}
            />
          </label>
          <label className="min-w-[150px] flex-1">
            <span className={labelCls}>Created after</span>
            <input
              type="date"
              className={fieldCls}
              value={createdAfter}
              onChange={(e) => setCreatedAfter(e.target.value)}
            />
          </label>
          <label className="min-w-[150px] flex-1">
            <span className={labelCls}>Created before</span>
            <input
              type="date"
              className={fieldCls}
              value={createdBefore}
              onChange={(e) => setCreatedBefore(e.target.value)}
            />
          </label>
        </div>
      </div>
      <div className="p-4">
        <div
          className={`overflow-hidden rounded-lg border border-[var(--base02)] ${domains.constants ? "" : "opacity-50"}`}
        >
          <div
            className="flex items-center gap-2 border-b border-l-2 border-[var(--base02)] px-3 py-2"
            style={{
              borderLeftColor: accent,
              backgroundColor: `color-mix(in oklab, ${accent} 6%, transparent)`,
            }}
          >
            <span className="font-mono text-xs font-semibold text-foreground">Constants</span>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">
              {domains.constants ? counts.constants : "hidden"}
            </span>
          </div>
          <fieldset className="p-3">
            <legend className={labelCls}>Kind</legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {KIND_FILTER.map((k) => (
                <label
                  key={k.value}
                  className="inline-flex cursor-pointer items-center gap-1.5 font-mono text-xs text-foreground"
                >
                  <input
                    type="checkbox"
                    className="accent-[var(--base0D)]"
                    checked={kinds.includes(k.value)}
                    disabled={!domains.constants}
                    onChange={() => toggleKind(k.value)}
                  />
                  {k.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </div>
    </section>
  );
}
