// A labelled, selectable shell command for the static install pages.
export function CommandBlock({
  label,
  command,
}: {
  label: string;
  command: string;
}) {
  return (
    <figure className="space-y-1.5">
      <figcaption className="text-sm font-medium text-foreground">
        {label}
      </figcaption>
      <pre className="overflow-x-auto rounded-md border border-border bg-muted px-4 py-3 font-mono text-sm text-foreground">
        <code>{command}</code>
      </pre>
    </figure>
  );
}
