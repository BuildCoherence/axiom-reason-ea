import { REPO_URL } from "@/lib/site";

export function ArchiveBanner() {
  return (
    <div
      role="note"
      aria-label="Archive notice"
      className="flex h-[var(--ce-banner-height)] shrink-0 items-center justify-center bg-muted px-4 text-xs text-muted-foreground"
    >
      <span className="truncate">
        Read-only archive. Publishing has closed.{" "}
        <span className="hidden sm:inline">The toolkit lives on </span>
        <a
          href={REPO_URL}
          className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
        >
          GitHub
        </a>
      </span>
    </div>
  );
}
