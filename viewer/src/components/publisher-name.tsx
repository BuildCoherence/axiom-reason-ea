import Link from "next/link";

import { profilePath } from "@/lib/profile-path";

// The Corpus Export writes a removed account's publisher as `null`, and its
// `data/**` payloads may carry this literal username; neither has a profile.
export const UNATTRIBUTED_PUBLISHER = "unattributed (account removed)";

export type Publisher = { username: string } | null;

/** The profile username behind a publisher, or null when it has no profile. */
export function attributedUsername(publisher: Publisher): string | null {
  if (publisher === null || publisher.username === UNATTRIBUTED_PUBLISHER) {
    return null;
  }
  return publisher.username;
}

/** `@username` linked to its profile, or the unlinked unattributed marker. */
export function PublisherName({
  publisher,
  className,
}: {
  publisher: Publisher;
  className?: string;
}) {
  const username = attributedUsername(publisher);
  if (username === null) {
    return <span>{UNATTRIBUTED_PUBLISHER}</span>;
  }
  return (
    <Link href={profilePath(username)} className={className}>
      @{username}
    </Link>
  );
}
