"use client";

import styles from "./pager.module.css";

export interface PagerProps {
  total: number;
  limit: number;
  /** 0-indexed first row of the shown page. */
  offset: number;
  /** Emits the new offset for the requested page. */
  onOffsetChange: (offset: number) => void;
}

// The elided page-number window: first, last, the current page and its
// neighbours, with "…" gaps.
function pageWindow(current: number, pageCount: number): (number | "…")[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const out: (number | "…")[] = [1];
  const lo = Math.max(2, current - 1);
  const hi = Math.min(pageCount - 1, current + 1);
  if (lo > 2) out.push("…");
  for (let p = lo; p <= hi; p++) out.push(p);
  if (hi < pageCount - 1) out.push("…");
  out.push(pageCount);
  return out;
}

/** "X–Y of Z", prev / next and numbered page buttons. */
export function Pager({ total, limit, offset, onOffsetChange }: PagerProps) {
  const current = Math.floor(offset / limit) + 1;
  const pageCount = Math.max(1, Math.ceil(total / limit), current);
  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(offset + limit, total);
  const goToPage = (page: number) => onOffsetChange((Math.max(1, page) - 1) * limit);

  return (
    <nav className={styles.pager} aria-label="Pages">
      <span className={styles.info}>
        {first}–{last} of {total}
      </span>
      <span className={styles.spacer} />
      <button
        type="button"
        className={styles.btn}
        onClick={() => goToPage(current - 1)}
        disabled={current <= 1}
        aria-label="Previous page"
      >
        ‹
      </button>
      {pageWindow(current, pageCount).map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} className={styles.gap} aria-hidden>
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            className={`${styles.btn} ${p === current ? styles.cur : ""}`}
            onClick={() => goToPage(p)}
            aria-current={p === current ? "page" : undefined}
            aria-label={`Page ${p}`}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        className={styles.btn}
        onClick={() => goToPage(current + 1)}
        disabled={current >= pageCount}
        aria-label="Next page"
      >
        ›
      </button>
      <span className={styles.rows}>
        Rows <b>{limit}</b>
      </span>
    </nav>
  );
}
