// Single source of truth for the `/u/` public-profile URL.
//
// The canonical form — lowercased + percent-encoded — is what the
// `(app)/(public)/u/[username]` route normalizes to via its 308 redirect
// (see that route's § "Username canonicalization"). Building links in this
// exact form avoids a needless 308 round-trip on navigation. Consumers:
// the file-page header (`ce-file-header.tsx`), the Lean-UI side panel
// (`side-panel.tsx`), the global nav's per-user "Profile" entry
// (`global-nav/global-nav.tsx`), and the `/u/[username]` route's own
// redirect target.
//
// Keep this in lock-step with that route's redirect — they are the two ends
// of one contract. Do not add normalization beyond lowercasing +
// encodeURIComponent; that would change the contract the 308 enforces.

/**
 * Canonical path to a user's public profile, e.g. `profilePath("Alice")`
 * → `"/u/alice"`. Lowercases (the route's canonical casing) and
 * percent-encodes the username segment.
 */
export function profilePath(username: string): string {
  return `/u/${encodeURIComponent(username.toLowerCase())}`;
}
