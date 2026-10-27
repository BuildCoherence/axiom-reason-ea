import Link from "next/link";
import { Network } from "lucide-react";

import { theoremHref } from "@/lib/theorem-href";

import styles from "./view-theorem-page-link.module.css";

// "View theorem page" icon-link — the single source of truth for the three
// inbound affordances that ship with the Theorem Page
// (navigate-to-theorem-page flow): the file-page decl-header link, the side
// panel's Identity-section link, and the profile theorem-row link.
//
// Icon-only by default, so the accessible name MUST live on the LINK wrapper
// (lucide icons are `aria-hidden`) via `aria-label` — the icon-only-control
// rule in the internal nextjs-styling-and-component-stack doc. The side
// panel passes `showLabel` to render a visible text label alongside the icon.
//
// This NAVIGATES to the theorem page (not the side-panel `?def=` affordance)
// — the navigate-vs-inspect split mirrors the file page's file-ref vs.
// identifier split.

export interface ViewTheoremPageLinkProps {
  defId: string;
  /** Render a visible "View theorem page" text label next to the icon. */
  showLabel?: boolean;
  className?: string;
}

const ACCESSIBLE_NAME = "View theorem page";

export function ViewTheoremPageLink({
  defId,
  showLabel = false,
  className,
}: ViewTheoremPageLinkProps) {
  return (
    <Link
      href={theoremHref(defId)}
      className={[styles.link, className].filter(Boolean).join(" ")}
      // Icon-only control: the accessible name lives on the wrapper. When
      // `showLabel` adds a visible text node the aria-label is redundant but
      // harmless (it matches the visible text).
      aria-label={ACCESSIBLE_NAME}
    >
      <Network className={styles.icon} aria-hidden="true" />
      {showLabel ? <span>{ACCESSIBLE_NAME}</span> : null}
    </Link>
  );
}
