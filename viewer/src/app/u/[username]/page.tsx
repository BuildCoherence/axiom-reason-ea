import type { Metadata } from "next";

import { loadPageData, profileUsernames } from "@/lib/page-data";

import { ProfileBody } from "./profile-body";
import { ProfileStatusBar } from "./status-bar";

export const dynamicParams = false;

export function generateStaticParams(): { username: string }[] {
  return profileUsernames().map((username) => ({ username }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  return { title: `@${decodeURIComponent(username)} · Axiom` };
}

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const data = loadPageData("u", decodeURIComponent(username));

  // Workbench wrapper — same shape as the file page: the fixed box gives the
  // docked resizable panels a definite parent height.
  return (
    <div
      data-workbench="true"
      className="fixed inset-x-0 bottom-0 top-[var(--ce-nav-height)] flex flex-col overflow-hidden bg-background"
    >
      <ProfileBody data={data} />
      <ProfileStatusBar
        username={data.username}
        axiomCount={data.latest_user_axioms?.axioms.length ?? null}
        heldCount={data.held_propositions.total}
      />
    </div>
  );
}
