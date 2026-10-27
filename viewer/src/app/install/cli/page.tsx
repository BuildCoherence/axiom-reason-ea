import type { Metadata } from "next";
import Link from "next/link";

import { CommandBlock } from "@/components/command-block";
import {
  GO_INSTALL_COMMAND,
  UNIX_INSTALL_COMMAND,
  WINDOWS_INSTALL_COMMAND,
} from "@/lib/site";

export const metadata: Metadata = { title: "Install the AXM CLI · Axiom" };

export default function InstallCLIPage() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-10 px-4 py-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Install the AXM CLI
        </h1>
        <p className="text-muted-foreground">
          These commands install only{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm text-foreground">
            axm
          </code>
          . For Lean and workspace setup, follow the{" "}
          <Link href="/install/toolkit" className="text-primary hover:underline">
            Axiom Toolkit flow
          </Link>
          .
        </p>
      </header>
      <CommandBlock label="macOS and Linux" command={UNIX_INSTALL_COMMAND} />
      <CommandBlock label="Windows (PowerShell)" command={WINDOWS_INSTALL_COMMAND} />
      <CommandBlock label="With Go" command={GO_INSTALL_COMMAND} />
    </div>
  );
}
