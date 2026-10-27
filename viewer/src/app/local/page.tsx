import type { Metadata } from "next";

import { LocalWorkspace } from "./local-workspace";

export const metadata: Metadata = {
  title: "Your workspace · Axiom",
  robots: { index: false },
};

export default function LocalPage() {
  return <LocalWorkspace />;
}
