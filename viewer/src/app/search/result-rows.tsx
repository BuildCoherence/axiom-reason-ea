"use client";

import Link from "next/link";
import type * as React from "react";

import { byteLen } from "@/components/lean-ui/byte-len";
import { ShikiSlice } from "@/components/lean-ui/shiki-slice";
import { PublisherName } from "@/components/publisher-name";
import { Timestamp } from "@/components/ui/timestamp";
import type { ConstantRow, TypeHeadRow } from "@/lib/search-index.mjs";

import styles from "./result-rows.module.css";

// Grammar-only highlighting stamps no identifier spans, so this never fires.
const noopIdentifierClick = () => {};

/** `searchable_name` and its parameter telescope with Lean binder brackets. */
export function typeSignature(row: TypeHeadRow): string {
  const wrap = ({ name, type, binder }: TypeHeadRow["params"][number]) => {
    const inner = `${name} : ${type}`;
    switch (binder) {
      case "implicit":
        return `{${inner}}`;
      case "strict_implicit":
        return `⦃${inner}⦄`;
      case "inst_implicit":
        return `[${inner}]`;
      default:
        return `(${inner})`;
    }
  };
  return [row.searchable_name, ...row.params.map(wrap)].join(" ");
}

/**
 * A Lean line highlighted by the grammar. With a def it is one inspect
 * affordance that opens the side panel on that def.
 */
function SignatureHero({
  text,
  defId,
  onInspect,
}: {
  text: string;
  defId: string | null;
  onInspect: (defId: string) => void;
}) {
  const body = (
    <code className={styles.code}>
      <ShikiSlice
        source={text}
        range={{ start: 0, end: byteLen(text) }}
        tokens={[]}
        onIdentifierClick={noopIdentifierClick}
      />
    </code>
  );
  if (defId === null) return <div className={styles.hero}>{body}</div>;
  const inspect = () => onInspect(defId);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={inspect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inspect();
        }
      }}
      aria-haspopup="dialog"
      aria-label={`Inspect ${text}`}
      title="Inspect declaration"
      className={styles.heroInteractive}
    >
      {body}
    </div>
  );
}

function FileIdChip({ fileId }: { fileId: string }) {
  return (
    <code className="rounded border border-[var(--base02)] bg-[var(--base01)] px-1.5 py-px font-mono text-[0.8rem] break-all text-[var(--base05)]">
      {fileId}
    </code>
  );
}

/** kind · file id · date · publisher, as each row carries them. */
function ResultSubline({
  kind,
  fileId,
  createdAt,
  publisher,
  arity,
}: {
  kind?: string | null;
  fileId: string;
  createdAt: string | null;
  publisher: string | null;
  arity?: number;
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {kind && <span>{kind.replaceAll("_", " ")}</span>}
      <FileIdChip fileId={fileId} />
      {createdAt && <Timestamp iso={createdAt} />}
      <PublisherName
        publisher={publisher === null ? null : { username: publisher }}
        className="inline-flex min-h-[24px] items-center rounded px-2 hover:bg-[var(--base01)] hover:underline"
      />
      {arity !== undefined && <span>arity {arity}</span>}
    </div>
  );
}

/** The row's primary action: a content-sized, full-height click region. */
export function RowActionRegion(
  props:
    | { variant: "link"; href: string; ghost?: boolean; children: React.ReactNode }
    | { variant: "button"; onClick: () => void; ghost?: boolean; children: React.ReactNode },
) {
  const className = `group flex flex-none items-center self-stretch pl-2 pr-4 text-sm font-medium transition-colors hover:bg-[var(--base01)] ${
    props.ghost ? "text-muted-foreground hover:text-foreground" : "text-primary"
  }`;
  const label = (
    <span className="whitespace-nowrap group-hover:underline">{props.children}</span>
  );
  return props.variant === "link" ? (
    <Link href={props.href} className={className}>
      {label}
    </Link>
  ) : (
    <button type="button" onClick={props.onClick} className={className}>
      {label}
    </button>
  );
}

/** A declaration row: a constant, or an instance of a queried type head. */
export function ConstantResultRow({
  row,
  onInspect,
}: {
  row: ConstantRow;
  onInspect: (defId: string) => void;
}) {
  return (
    <li className="flex items-stretch" data-def-id={row.def_id}>
      <div className="min-w-0 flex-1 py-3 pl-4 pr-2">
        <SignatureHero text={row.name} defId={row.def_id} onInspect={onInspect} />
        <ResultSubline
          kind={row.kind}
          fileId={row.file_id}
          createdAt={row.created_at}
          publisher={row.publisher}
        />
      </div>
      <RowActionRegion variant="link" href={`/f/${row.file_id}`} ghost>
        Open file →
      </RowActionRegion>
    </li>
  );
}

/**
 * A type head's hero and subline. A platform built-in has no declaring file,
 * so it shows a "platform" chip instead.
 */
export function TypeHeadResultRow({
  row,
  showArity,
  onInspect,
  action,
}: {
  row: TypeHeadRow;
  showArity?: boolean;
  onInspect: (defId: string) => void;
  action: React.ReactNode;
}) {
  return (
    <>
      <div className="min-w-0 flex-1 py-3 pl-4 pr-2">
        <SignatureHero text={typeSignature(row)} defId={row.def_id} onInspect={onInspect} />
        {row.file_id !== null ? (
          <ResultSubline
            fileId={row.file_id}
            createdAt={row.created_at}
            publisher={row.publisher}
            arity={showArity ? row.arity : undefined}
          />
        ) : (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 font-sans text-[11px] font-medium"
              style={{
                backgroundColor: "color-mix(in oklab, var(--base0D) 16%, transparent)",
                color: "var(--base0D)",
              }}
            >
              platform
            </span>
            {showArity && <span>arity {row.arity}</span>}
          </div>
        )}
      </div>
      {action}
    </>
  );
}
