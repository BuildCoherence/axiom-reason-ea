import type { Metadata } from "next";

import type { TokenTree } from "@/components/lean-ui/types";
import { loadCorpusIndex, loadPageData } from "@/lib/page-data";

import { TheoremPageBody } from "./theorem-page-body";

export const dynamicParams = false;

export function generateStaticParams(): { def_id: string }[] {
  return loadCorpusIndex().theorems.map((def_id) => ({ def_id }));
}

function flattenTokenTree(tree: TokenTree): string {
  if (tree.node === "text") return tree.text;
  if (tree.node === "append")
    return tree.children.map(flattenTokenTree).join("");
  return flattenTokenTree(tree.child);
}

const DESCRIPTION_MAX = 160;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ def_id: string }>;
}): Promise<Metadata> {
  const { def_id } = await params;
  const { decl } = loadPageData("theorem", def_id);
  const signatureText = flattenTokenTree(decl.type_tokens.empty).trim();
  const description =
    signatureText.length > DESCRIPTION_MAX
      ? signatureText.slice(0, DESCRIPTION_MAX - 1).trimEnd() + "…"
      : signatureText;
  return {
    title: `theorem ${decl.local_name} · Axiom`,
    description: description.length > 0 ? description : undefined,
  };
}

export default async function TheoremPage({
  params,
}: {
  params: Promise<{ def_id: string }>;
}) {
  const { def_id } = await params;
  const data = loadPageData("theorem", def_id);

  // Workbench wrapper — the IDE-style shell the file and profile pages use;
  // the status bar renders inside the body, which owns the view toggle.
  return (
    <div
      data-workbench="true"
      className="fixed inset-x-0 bottom-0 top-[var(--ce-nav-height)] flex flex-col overflow-hidden bg-background"
    >
      <TheoremPageBody data={data} />
    </div>
  );
}
