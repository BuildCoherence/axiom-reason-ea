"use client";

import Link from "next/link";
import * as React from "react";

import { isLoopbackHost } from "@/lib/loopback";

// Renders only after hydration, and only under `axm viewer` on loopback.
export function LocalNavLink({ className }: { className?: string }) {
  const [onLoopback, setOnLoopback] = React.useState(false);
  React.useEffect(() => {
    setOnLoopback(isLoopbackHost(window.location.hostname));
  }, []);
  if (!onLoopback) return null;
  return (
    <Link href="/local" className={className}>
      Workspace
    </Link>
  );
}
