// The AUTHOR-view source-bytes predicate, shared by the proposition card (which
// mounts the `ShikiSlice`) and the shell (whose measurement gate counts the
// cards that will mount one). A second copy that drifts would deadlock the gate.

import type { SourceToken } from "@/components/lean-ui/types";

import type { RfFlowchartNode } from "../types";

export interface SourceBytesInputs {
  node: RfFlowchartNode;
  view: "author" | "empty";
  fileContent?: string;
  sourceTokens?: SourceToken[];
  /** UTF-8 length of `fileContent`, hoisted so callers can memoise it. */
  fileContentByteLen: number;
}

/**
 * True iff the card renders its proposition from verbatim source bytes rather
 * than the delaborated token tree. A range past the end of the file (a fixture
 * whose byte offsets don't match its seeded content) keeps the delab tree rather
 * than rendering blank.
 */
export function usesSourceBytes({
  node,
  view,
  fileContent,
  sourceTokens,
  fileContentByteLen,
}: SourceBytesInputs): boolean {
  return (
    view === "author" &&
    node.author_byte_range != null &&
    fileContent != null &&
    sourceTokens !== undefined &&
    node.author_byte_range.start >= 0 &&
    node.author_byte_range.end > node.author_byte_range.start &&
    node.author_byte_range.end <= fileContentByteLen
  );
}
