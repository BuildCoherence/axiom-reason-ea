import type { FileRef } from "@/components/lean-ui/types";

const IMPORT_LINE = /^import\b[^\n]*/gm;
const CORPUS_MODULE = /\bA\.([A-Za-z0-9]+)\b/g;

const encoder = new TextEncoder();
const byteLength = (s: string) => encoder.encode(s).length;

/** Every `import A.<id>` module in `source`, as a file ref over `<id>`. */
export function localFileRefs(source: string): FileRef[] {
  const refs: FileRef[] = [];
  for (const line of source.matchAll(IMPORT_LINE)) {
    for (const mod of line[0].matchAll(CORPUS_MODULE)) {
      const id = mod[1];
      const charStart = line.index + mod.index + "A.".length;
      const byteStart = byteLength(source.slice(0, charStart));
      refs.push({
        byte_start: byteStart,
        byte_end: byteStart + byteLength(id),
        target_file_id: id,
        kind: "import",
      });
    }
  }
  return refs;
}
