"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

import { LeanUIShell } from "@/components/lean-ui/lean-ui-shell";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { loadSearchIndex } from "@/lib/panel-data";
import type { SearchIndex } from "@/lib/search-index.mjs";

import { FederatedSearch } from "./federated-search";
import { TypeHeadQuery } from "./type-head-query";
import { useInspectorPanel } from "./use-inspector-panel";

type IndexState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; index: SearchIndex };

// `?type_head=` selects the type-head query view; otherwise the federated
// search. Both open the same `?def=` side panel.
export function SearchApp() {
  const searchParams = useSearchParams();
  const typeHead = searchParams.get("type_head");
  const { select, panel, urlReader } = useInspectorPanel();
  const isMobile = useIsMobile();
  const [attempt, setAttempt] = React.useState(0);
  const [state, setState] = React.useState<IndexState>({ status: "loading" });

  React.useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    loadSearchIndex().then(
      (index) => live && setState({ status: "ready", index }),
      () => live && setState({ status: "error" }),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  let body: React.ReactNode;
  if (state.status === "loading") {
    body = <p className="px-6 py-8 text-sm text-muted-foreground">Loading the search index…</p>;
  } else if (state.status === "error") {
    body = (
      <div role="alert" className="px-6 py-8 text-sm text-destructive">
        The search index could not be loaded.{" "}
        <button type="button" className="underline" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </div>
    );
  } else if (typeHead !== null) {
    body = (
      <TypeHeadQuery
        key={typeHead}
        index={state.index}
        typeHead={typeHead}
        fromQ={searchParams.get("from_q")}
        onInspect={select}
      />
    );
  } else {
    body = <FederatedSearch index={state.index} onInspect={select} />;
  }

  return (
    <LeanUIShell panel={panel} isMobile={isMobile} id="lean-ui-side-panel-width">
      {urlReader}
      <div className="dot-grid h-full min-h-0 w-full overflow-y-auto">{body}</div>
    </LeanUIShell>
  );
}
