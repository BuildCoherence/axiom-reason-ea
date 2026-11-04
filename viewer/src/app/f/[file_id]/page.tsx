import type { Metadata } from "next";

import { CeFileBody } from "@/components/lean-ui/ce-file-body";
import {
  buildByteToCharMap,
  highlightSourceToHast,
} from "@/components/lean-ui/lean-code";
import { buildDecorations } from "@/components/lean-ui/ce-file-decorations";
import { encodeHast } from "@/components/lean-ui/hast-wire.mjs";
import { loadCorpusIndex, loadPageData } from "@/lib/page-data";

import { CeFileHeader } from "./ce-file-header";
import { StatusBar } from "./status-bar";

export const dynamicParams = false;

export function generateStaticParams(): { file_id: string }[] {
  return loadCorpusIndex().files.map((f) => ({ file_id: f.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ file_id: string }>;
}): Promise<Metadata> {
  const { file_id } = await params;
  return { title: `${file_id} · Axiom` };
}

export default async function CeFilePage({
  params,
}: {
  params: Promise<{ file_id: string }>;
}) {
  const { file_id } = await params;
  const { file: data } = loadPageData("f", file_id);
  const decls = data.decls;

  // `source_tokens` are UTF-8 byte offsets; Shiki decorations take character
  // offsets into the exact string highlighted, and Lean source is
  // Unicode-heavy, so every offset resolves through one byte→char map.
  const toChar = buildByteToCharMap(data.content);
  const decorations = buildDecorations(
    decls,
    data.file_refs,
    data.content,
    toChar,
  );

  // The highlighted source crosses to the client body as a hast tree, which
  // `renderHast` renders as React elements (attributes as escaped props, the
  // source as text children) — never as raw HTML.
  const sourceHast = await highlightSourceToHast(data.content, { decorations });

  // Client props are serialised into the page's RSC payload, so the hast
  // crosses in its compact wire form and the body gets only the decl labels
  // it reads; the token trees stay on the server.
  const declLabels = decls.map((d) => ({
    def_id: d.def_id,
    local_name: d.local_name,
    qualified_name: d.qualified_name,
  }));

  // The workbench wrapper covers the viewport below the nav; `CeFileBody`
  // flex-grows inside it and the status bar pins to the bottom edge.
  return (
    <div
      data-workbench="true"
      className="fixed inset-x-0 bottom-0 top-[var(--ce-nav-height)] flex flex-col overflow-hidden bg-background"
    >
      <CeFileBody
        fileId={data.id}
        hast={encodeHast(sourceHast)}
        decls={declLabels}
        header={
          <CeFileHeader
            fileId={data.id}
            publisher={data.publisher}
            createdAt={data.created_at}
            forkedFrom={data.forked_from}
          />
        }
      />
      <StatusBar
        fileId={data.id}
        publisher={data.publisher}
        declCount={decls.length}
      />
    </div>
  );
}
