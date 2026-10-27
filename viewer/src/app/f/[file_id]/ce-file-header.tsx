import Link from "next/link";

import { PublisherName, type Publisher } from "@/components/publisher-name";
import { Timestamp } from "@/components/ui/timestamp";
import inTextLinkStyles from "@/components/lean-ui/in-text-link.module.css";

import styles from "./ce-file-header.module.css";

// Page-specific header for the CE file page (per the file-page spec § Header).
// Lives in the route dir, not src/components/lean-ui/, because it is the file
// page's layout chrome — not the reusable Lean renderer. Three optional-region
// rules from the spec: when `publisher` is null the publisher line is omitted
// entirely (no placeholder); when `forkedFrom` is null the forked-from line is
// omitted. This ships as the finished beta header — no "coming soon" stubs.

export interface CeFileHeaderProps {
  fileId: string;
  publisher: Publisher;
  createdAt: string; // RFC3339
  forkedFrom: string | null; // parent base50, or null
}

export function CeFileHeader({
  fileId,
  publisher,
  createdAt,
  forkedFrom,
}: CeFileHeaderProps) {
  return (
    <header className={styles.header}>
      {/* File-id chip: the base50 id in a monospace chip. base50 is
       * case-sensitive — rendered verbatim, never lowercased. */}
      <code className={styles.fileIdChip}>{fileId}</code>

      <div className={styles.meta}>
        <p className={styles.metaLine}>
          Published by{" "}
          <PublisherName
            publisher={publisher}
            className={inTextLinkStyles.link}
          />
        </p>

        <p className={styles.metaLine}>
          Created <Timestamp iso={createdAt} />
        </p>

        {forkedFrom !== null ? (
          <p className={styles.metaLine}>
            Forked from{" "}
            <Link href={`/f/${encodeURIComponent(forkedFrom)}`}>
              <code className={styles.forkedFromId}>{forkedFrom}</code>
            </Link>
          </p>
        ) : null}
      </div>
    </header>
  );
}
