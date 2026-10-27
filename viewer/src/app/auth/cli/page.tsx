import type { Metadata } from "next";

import { CommandBlock } from "@/components/command-block";

export const metadata: Metadata = { title: "Accounts have closed · Axiom" };

export default function AuthCLIPage() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">
        Accounts have closed
      </h1>
      <p className="text-muted-foreground">
        Axiom is now a free local toolkit, so there is no sign-in. Publishing
        has closed; your files stay yours. Update the CLI to the local edition:
      </p>
      <CommandBlock label="Run" command="axm upgrade" />
    </div>
  );
}
