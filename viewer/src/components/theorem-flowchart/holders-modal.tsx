"use client";

import { attributedUsername, PublisherName } from "@/components/publisher-name";
import * as React from "react";
import Link from "next/link";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { loadDefPanel, loadPropPanel } from "@/lib/panel-data";
import { profilePath } from "@/lib/profile-path";
import { theoremHref } from "@/lib/theorem-href";

import type { HoldingRow, DrillInRequest } from "./types";

// Drill-in modal — the searchable list behind a count badge. It serves BOTH
// drill-ins on the Theorem Page, in one consistent Radix `Dialog` chrome:
//
//   • Holders (per-proposition) — opened from a node's Holding bar
//     (`kind: "holders"`). Reads the proposition's panel data `holders`
//     and shows BOTH legs (adopts / rejects the proposition) in a filterable,
//     searchable Username / Stance / Provenance table.
//   • Adopters (theorem-level) — opened from the proof-fold node's turnstile
//     chip (`kind: "adopters"`). Reads the theorem def's panel data `adopters`
//     and shows the users whose axioms adopt the argument in a searchable
//     Username table (no stance/negation concept, and adopter rows carry no
//     per-row provenance link).
//
// Both views list locked-out accounts flagged `inconsistent` (the strategy's
// flag-don't-hide rule) while the on-canvas COUNT excludes them — see the
// substrate's `inconsistent` flag (#895 for holders; the mirrored `AdopterRows`
// change for adopters).
//
// PRIMITIVE: the project's shadcn `Dialog` (Radix), so focus trap, Esc/backdrop
// close, focus return, and `role="dialog"`/`aria-modal` come from Radix. Theme
// via semantic tokens (no hex) so it tracks light/dark.

type FetchState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded-holders"; pro: HoldingRow[]; con: HoldingRow[] }
  | {
      status: "loaded-adopters";
      adopters: Array<{ username: string; inconsistent: boolean }>;
    };

type StanceFilter = "all" | "adopters" | "rejectors";
type Stance = "adopts" | "rejects";
// `key` is the row's position in its source list: usernames are not unique
// (every removed account reads as the unattributed marker).
type Row = HoldingRow & { stance: Stance; key: string };

const FILTERS: { key: StanceFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "adopters", label: "Adopters" },
  { key: "rejectors", label: "Rejectors" },
];

// Provenance cell — condensed for a table cell. `axiom` rows name the listed
// User Axiom; `derived` rows link to
// the witnessing theorem when one exists (v1 emits witness {def_id, source}).
function ProvenanceCell({
  row,
  onNavigate,
}: {
  row: HoldingRow;
  onNavigate: () => void;
}): React.ReactNode {
  const linkClass = "underline underline-offset-2 hover:text-foreground";
  if (row.provenance === "axiom") {
    // Axiom provenance: the holder lists this proposition among their own
    // axioms — link to their profile (where those axioms live). Close the modal
    // on the way there.
    const name = row.axiom_name ?? "";
    const label = name.length > 0 ? `axiom ${name}` : "axiom";
    const username = attributedUsername({ username: row.username });
    if (username === null) return label;
    return (
      <Link
        className={linkClass}
        href={profilePath(username)}
        onClick={onNavigate}
      >
        {label}
      </Link>
    );
  }
  // Derived provenance: link to the witnessing argument's Theorem Page AND close
  // the modal — the witness is often the current theorem (a conclusion's holders
  // derive it via THIS argument), so a bare same-route Link wouldn't unmount the
  // page and the modal would stay open.
  const witness = row.witness;
  if (witness?.source === "theorem") {
    return (
      <Link
        className={linkClass}
        href={theoremHref(witness.def_id)}
        onClick={onNavigate}
      >
        via an argument
      </Link>
    );
  }
  return "via an argument";
}

export function HoldersModal({
  request,
  onClose,
}: {
  request: DrillInRequest | null;
  onClose: () => void;
}) {
  const [state, setState] = React.useState<FetchState>({ status: "loading" });
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<StanceFilter>("all");

  // Lazy read on open; a result that lands after close or a newer request is
  // dropped.
  React.useEffect(() => {
    if (request === null) return;
    setQuery("");
    setState({ status: "loading" });
    let cancelled = false;
    const fail = (err: unknown) => {
      if (cancelled) return;
      console.error(`${request.kind} drill-in failed:`, err);
      setState({ status: "error" });
    };

    if (request.kind === "adopters") {
      loadDefPanel(request.def_id).then((file) => {
        if (cancelled) return;
        if (file.adopters === undefined) {
          fail(new Error(`def ${request.def_id} has no adopters`));
          return;
        }
        setState({ status: "loaded-adopters", adopters: file.adopters });
      }, fail);
    } else {
      // Holders: the clicked leg sets the initial stance filter.
      setFilter(request.side === "con" ? "rejectors" : "all");
      loadPropPanel(request.proposition_id).then((file) => {
        if (cancelled) return;
        setState({
          status: "loaded-holders",
          pro: file.holders.pro,
          con: file.holders.con,
        });
      }, fail);
    }
    return () => {
      cancelled = true;
    };
  }, [request]);

  const open = request !== null;
  const isAdopters = request?.kind === "adopters";

  // --- Holders rows (proposition view) ---
  const allRows = React.useMemo<Row[]>(() => {
    if (state.status !== "loaded-holders") return [];
    return [
      ...state.pro.map((r, i): Row => ({ ...r, stance: "adopts", key: `pro-${i}` })),
      ...state.con.map((r, i): Row => ({ ...r, stance: "rejects", key: `con-${i}` })),
    ];
  }, [state]);

  const adopterCount = state.status === "loaded-holders" ? state.pro.length : 0;
  const rejectorCount = state.status === "loaded-holders" ? state.con.length : 0;

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows.filter((r) => {
      if (filter === "adopters" && r.stance !== "adopts") return false;
      if (filter === "rejectors" && r.stance !== "rejects") return false;
      if (q && !r.username.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allRows, filter, query]);

  // --- Adopter rows (theorem view) ---
  const adopters = React.useMemo(() => {
    if (state.status !== "loaded-adopters") return [];
    const q = query.trim().toLowerCase();
    return state.adopters
      .map((a, i) => ({ ...a, key: i }))
      .filter((a) => !q || a.username.toLowerCase().includes(q));
  }, [state, query]);
  const adoptersTotal =
    state.status === "loaded-adopters" ? state.adopters.length : 0;

  // Focus return: the trigger (the node's Holding bar / adopter chip) lives
  // inside React Flow, not a Radix DialogTrigger, so we restore focus to the
  // captured element on close ourselves (it's still connected while the canvas
  // stays mounted).
  const triggerRef = React.useRef<HTMLElement | null>(null);
  if (request) triggerRef.current = request.element;
  const handleCloseAutoFocus = React.useCallback((event: Event) => {
    const t = triggerRef.current;
    if (t !== null && t.isConnected) {
      event.preventDefault();
      t.focus();
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="flex max-h-[80vh] flex-col gap-4 sm:max-w-2xl"
        aria-modal="true"
        onCloseAutoFocus={handleCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{isAdopters ? "Adopters" : "Holders"}</DialogTitle>
          <DialogDescription>
            {isAdopters
              ? "Everyone whose axioms adopt this argument."
              : "Everyone who holds this proposition, or its negation."}
          </DialogDescription>
        </DialogHeader>

        {state.status === "loading" ? (
          <p className="py-6 text-center text-sm text-muted-foreground" role="status">
            Loading…
          </p>
        ) : state.status === "error" ? (
          <p className="py-6 text-center text-sm text-destructive" role="alert">
            {isAdopters ? "Unable to load adopters." : "Unable to load holders."}
          </p>
        ) : isAdopters ? (
          <>
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                <span className="font-medium text-foreground">
                  {adoptersTotal}
                </span>{" "}
                adopter{adoptersTotal === 1 ? "" : "s"}
              </p>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                <Input
                  type="search"
                  placeholder="Search username…"
                  aria-label="Search adopters by username"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="sm:w-56"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th scope="col" className="px-3 py-2 font-medium">
                      Username
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {adopters.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-muted-foreground">
                        No adopters match your search.
                      </td>
                    </tr>
                  ) : (
                    adopters.map((a) => (
                      <tr
                        key={a.key}
                        className="border-b border-border/60 last:border-b-0"
                        data-inconsistent={a.inconsistent || undefined}
                      >
                        <td className="px-3 py-2 font-mono">
                          <PublisherName
                            publisher={{ username: a.username }}
                            className="hover:underline"
                          />
                          {a.inconsistent ? (
                            <span className="ml-2 rounded bg-muted px-1 py-0.5 text-xs text-muted-foreground">
                              inconsistent
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                <span className="font-medium text-foreground">{adopterCount}</span>{" "}
                adopter{adopterCount === 1 ? "" : "s"} ·{" "}
                <span className="font-medium text-foreground">{rejectorCount}</span>{" "}
                rejector{rejectorCount === 1 ? "" : "s"}
              </p>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div role="group" aria-label="Filter by stance" className="flex gap-1">
                  {FILTERS.map((f) => (
                    <Button
                      key={f.key}
                      type="button"
                      size="sm"
                      variant={filter === f.key ? "default" : "outline"}
                      aria-pressed={filter === f.key}
                      onClick={() => setFilter(f.key)}
                    >
                      {f.label}
                    </Button>
                  ))}
                </div>
                <Input
                  type="search"
                  placeholder="Search username…"
                  aria-label="Search holders by username"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="sm:w-56"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th scope="col" className="px-3 py-2 font-medium">
                      Username
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Stance
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Provenance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-3 py-6 text-center text-muted-foreground"
                      >
                        No holders match your search.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr
                        key={r.key}
                        className="border-b border-border/60 last:border-b-0"
                        data-inconsistent={r.inconsistent || undefined}
                      >
                        <td className="px-3 py-2 font-mono">
                          <PublisherName
                            publisher={{ username: r.username }}
                            className="hover:underline"
                          />
                          {r.inconsistent ? (
                            <span className="ml-2 rounded bg-muted px-1 py-0.5 text-xs text-muted-foreground">
                              inconsistent
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                              r.stance === "adopts"
                                ? "bg-primary/10 text-primary"
                                : "bg-destructive/10 text-destructive",
                            )}
                          >
                            {r.stance === "adopts" ? "Adopts" : "Rejects"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          <ProvenanceCell row={r} onNavigate={onClose} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
