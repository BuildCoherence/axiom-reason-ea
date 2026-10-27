import Link from "next/link";

import { ArchiveBanner } from "@/components/archive-banner";
import { AxiomLogo } from "@/components/axiom-logo";
import { AxiomWordmark } from "@/components/axiom-wordmark";
import { LocalNavLink } from "@/components/local-nav-link";
import { REPO_URL } from "@/lib/site";

const NAV_LINK =
  "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)]";

// Fixed at the `--ce-nav-height` the workbench pages offset below.
export function SiteNav() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-[var(--ce-nav-height)] flex-col bg-background">
      <ArchiveBanner />
      <nav
        aria-label="Site"
        className="flex min-h-0 flex-1 items-center gap-2 border-b border-border px-4"
      >
        <Link href="/" className="flex items-center gap-2" aria-label="Axiom home">
          <AxiomLogo className="h-7 w-7" />
          <AxiomWordmark className="h-4 w-auto text-foreground" decorative />
        </Link>
        <div className="flex-1" />
        <LocalNavLink className={NAV_LINK} />
        <Link href="/search" className={NAV_LINK}>
          Search
        </Link>
        <Link href="/graph" className={NAV_LINK}>
          Graph
        </Link>
        <Link href="/install/toolkit" className={NAV_LINK}>
          Install
        </Link>
        <a href={REPO_URL} className={NAV_LINK}>
          GitHub
        </a>
      </nav>
    </header>
  );
}
