// Mapped to 127.0.0.1 by the browser (playwright.config.ts).
export const OFF_LOOPBACK_HOST = "archive.test";

/** The archive server: a static export with no `/local/api`. */
export function archiveUrl(): URL {
  return new URL(required("VIEWER_ARCHIVE_URL"));
}

/** The `axm viewer` stand-in: the same export plus a Workspace's `/local/api`. */
export function workspaceUrl(): URL {
  return new URL(required("VIEWER_WORKSPACE_URL"));
}

/** `url` reached through a non-loopback host name. */
export function offLoopback(url: URL): URL {
  const u = new URL(url);
  u.hostname = OFF_LOOPBACK_HOST;
  return u;
}

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined) throw new Error(`${name} is unset; run through playwright.config.ts`);
  return v;
}
