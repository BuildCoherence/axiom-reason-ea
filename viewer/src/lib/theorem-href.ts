// The canonical surface of a projection-hinted def: its file page with the
// proposition panel open, or the def panel when the hint names no proposition.
export interface TheoremRedirect {
  file_id: string;
  proposition_id?: string;
}

// `theorem-redirects.json`, inlined at build by next.config.ts, so in-site
// links never depend on the archive Worker's 308.
function redirects(): Record<string, TheoremRedirect> {
  const raw = process.env.THEOREM_REDIRECTS;
  if (raw === undefined) {
    throw new Error("THEOREM_REDIRECTS is not set; build through next.config.ts");
  }
  return JSON.parse(raw) as Record<string, TheoremRedirect>;
}

const THEOREM_REDIRECTS = redirects();

export function theoremHref(defId: string): string {
  const target = THEOREM_REDIRECTS[defId];
  if (target === undefined) return `/theorem/${encodeURIComponent(defId)}`;
  const file = `/f/${encodeURIComponent(target.file_id)}`;
  return target.proposition_id
    ? `${file}?prop=${encodeURIComponent(target.proposition_id)}`
    : `${file}?def=${encodeURIComponent(defId)}`;
}
