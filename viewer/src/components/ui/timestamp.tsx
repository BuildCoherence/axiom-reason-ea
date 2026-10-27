"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/lib/format-date";
import { formatAbsolute, formatRelative } from "@/lib/format-relative";

export interface TimestampProps {
  /** ISO-8601 / RFC3339 timestamp string. */
  iso: string;
  /** absolute → medium date (e.g., "Jun 30, 2026"); relative → "2 hours ago". */
  mode?: "absolute" | "relative";
  className?: string;
  style?: React.CSSProperties;
}

// SSR + first client render use UTC (deterministic; no hydration mismatch).
// After `useEffect` fires we re-render in the visitor's zone. Because the text
// legitimately changes between passes, `suppressHydrationWarning` is set on
// the `<time>` element — Next.js's documented escape hatch for exactly this
// case. The hover tooltip always includes `timeZoneName: "shortOffset"` so
// the exact moment is unambiguous.
//
// The component renders ONLY the datetime string inside `<time>`. Any leading
// prose ("Joined ", "Created ", "Last used ") is the caller's responsibility
// — emit it as sibling text next to `<Timestamp>`. Keeping `<time>` scoped to
// the datetime keeps the hover-tooltip surface consistent (the tooltip shows
// the date, not "Joined <date>") and matches the semantic role of `<time>`.
export function Timestamp({
  iso,
  mode = "absolute",
  className,
  style,
}: TimestampProps): React.JSX.Element {
  const [tz, setTz] = useState<string | undefined>(undefined);
  useEffect(() => {
    setTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  const zone = tz ?? "UTC";
  const label =
    mode === "relative" ? formatRelative(iso) : formatDate(iso, zone);
  const tooltip = formatAbsolute(iso, zone);

  return (
    <time
      dateTime={iso}
      title={tooltip}
      className={className}
      style={style}
      suppressHydrationWarning
    >
      {label}
    </time>
  );
}
