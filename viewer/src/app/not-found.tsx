import Link from "next/link";

import { REPO_URL } from "@/lib/site";

// The archive 404 page (`404.html`): unknown paths and ids outside the corpus.
export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">
        Page not found
      </h1>
      <p className="text-muted-foreground">
        This page is not in the Axiom archive. The archive is read-only and
        publishing has closed; the toolkit lives on{" "}
        <a href={REPO_URL} className="text-primary hover:underline">
          GitHub
        </a>
        .
      </p>
      <Link href="/" className="text-primary hover:underline">
        Back to the archive home
      </Link>
    </div>
  );
}
