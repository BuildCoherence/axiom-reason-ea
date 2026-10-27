import Link from "next/link";

import { CommandBlock } from "@/components/command-block";
import { REPO_URL, UNIX_INSTALL_COMMAND } from "@/lib/site";

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-10 px-4 py-16">
      <header className="space-y-4">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          Axiom is a free, open-source local toolkit
        </h1>
        <p className="text-lg text-muted-foreground">
          Turn your ideas into formal definitions, axioms and theorems on your
          own machine, checked by Lean — just bring an AI agent.
        </p>
        <p className="text-muted-foreground">
          Publishing has closed. This site is the read-only archive of every
          file published to Axiom; each file belongs to its publisher.
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        <a
          href={REPO_URL}
          className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          View on GitHub
        </a>
        <Link
          href="/install/toolkit"
          className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          Install the toolkit
        </Link>
      </div>

      <CommandBlock label="Install axm (macOS and Linux)" command={UNIX_INSTALL_COMMAND} />
    </div>
  );
}
