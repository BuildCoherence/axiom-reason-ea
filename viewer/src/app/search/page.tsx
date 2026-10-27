import type { Metadata } from "next";
import { Suspense } from "react";

import { SITE_URL } from "@/lib/site";

import { SearchApp } from "./search-app";
import { SEARCH_PATH } from "./search-route";

export const metadata: Metadata = {
  title: "Search",
  description: "Search the archive's users, type heads and declarations.",
  alternates: { canonical: `${SITE_URL}${SEARCH_PATH}` },
};

// Search runs in the browser over `search-index.json`; the export holds only
// the workbench and a loading line.
export default function SearchPage() {
  return (
    <div
      data-workbench="true"
      className="fixed inset-x-0 bottom-0 top-[var(--ce-nav-height)] flex flex-col overflow-hidden bg-background"
    >
      <Suspense
        fallback={<p className="px-6 py-8 text-sm text-muted-foreground">Loading search…</p>}
      >
        <SearchApp />
      </Suspense>
    </div>
  );
}
