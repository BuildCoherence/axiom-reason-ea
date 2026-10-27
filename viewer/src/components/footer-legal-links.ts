// Shared source-of-truth for the legal-page links rendered in BOTH the
// marketing footer (axiom/web/src/components/footer.tsx, Resources column)
// AND the file route's status bar (axiom/web/src/app/(app)/(public)/f/
// [file_id]/status-bar.tsx, right block). Both surfaces need a copyright
// notice + reachable Privacy / Terms links per the standard "no per-page
// notice required by Berne, but reachable links prevent the innocent-
// infringer defense" convention — and they MUST point at the same URLs.
// The marketing footer originally inlined these in a `RESOURCE_LINKS`
// const; the status bar briefly hard-coded `/terms` and `/privacy` as
// Next.js routes that don't exist on axiomreason.com (the legal pages
// live on coherencelabs.net). Lifting the canonical list here removes
// the drift hazard — change a URL once and both surfaces follow.
//
// LEGAL_LINKS is the key-addressable form for named-lookup callers
// (e.g. the signup clickwrap asks for `LEGAL_LINKS.terms`); LEGAL_LINKS_LIST
// is an ordered array for `.map()`-shape consumers (marketing footer, file
// route status bar, etc.). The entries are URLs on coherencelabs.net because
// the legal pages live on the marketing site and aren't duplicated on
// axiomreason.com.

export interface LegalLink {
  label: string;
  href: string;
}

// Key-addressable: signup/clickwrap code asks for `LEGAL_LINKS.terms` /
// `LEGAL_LINKS.privacy` by name — no `.find(..., ...)!` non-null
// assertion needed; a label rename can no longer silently turn the
// reference into `undefined`.
export const LEGAL_LINKS = {
  terms: {
    label: "Terms of Service",
    href: "https://coherencelabs.net/terms-of-service",
  },
  privacy: {
    label: "Privacy Policy",
    href: "https://coherencelabs.net/privacy-policy",
  },
} as const satisfies Record<string, LegalLink>;

// Ordered list for `.map()`-shape callers (marketing footer, file status bar).
// Order matches the original: Privacy then Terms.
export const LEGAL_LINKS_LIST: readonly LegalLink[] = [
  LEGAL_LINKS.privacy,
  LEGAL_LINKS.terms,
];
