import type { Metadata } from "next";
import Link from "next/link";

import { CommandBlock } from "@/components/command-block";
import {
  GET_STARTED_COMMANDS,
  REPO_URL,
  UNIX_INSTALL_COMMAND,
  WINDOWS_INSTALL_COMMAND,
} from "@/lib/site";

export const metadata: Metadata = { title: "Install the Axiom Toolkit · Axiom" };

export default function InstallToolkitPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-10 px-4 py-12">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Install the Axiom Toolkit
        </h1>
        <p className="text-muted-foreground">
          The toolkit is free and runs locally: no account and no server. You
          need git, elan (the Lean toolchain manager) and Claude Code or Codex.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">
          1. Install axm
        </h2>
        <CommandBlock label="macOS and Linux" command={UNIX_INSTALL_COMMAND} />
        <CommandBlock label="Windows (PowerShell)" command={WINDOWS_INSTALL_COMMAND} />
        <p className="text-sm text-muted-foreground">
          Only the CLI?{" "}
          <Link href="/install/cli" className="text-primary hover:underline">
            Install axm directly
          </Link>
          .
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">
          2. Create a workspace and start
        </h2>
        <CommandBlock label="Then run" command={GET_STARTED_COMMANDS.join("\n")} />
        <p className="text-sm text-muted-foreground">
          Source, releases and documentation are on{" "}
          <a href={REPO_URL} className="text-primary hover:underline">
            GitHub
          </a>
          .
        </p>
      </section>
    </div>
  );
}
