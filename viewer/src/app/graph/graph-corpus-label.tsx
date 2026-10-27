"use client";

import * as React from "react";

import { formatDate } from "@/lib/format-date";
import { isLoopbackHost } from "@/lib/loopback";

// The local target (`axm viewer`, on loopback) labels the graph with the
// corpus it was built from. Renders only after hydration.
export function GraphCorpusLabel({
  frozenAt,
  className,
}: {
  frozenAt: string;
  className?: string;
}) {
  const [onLoopback, setOnLoopback] = React.useState(false);
  React.useEffect(() => {
    setOnLoopback(isLoopbackHost(window.location.hostname));
  }, []);
  if (!onLoopback) return null;
  return (
    <span className={className}>
      published corpus at{" "}
      <time dateTime={frozenAt}>{formatDate(frozenAt, "UTC")}</time>
    </span>
  );
}
