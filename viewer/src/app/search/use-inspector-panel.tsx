"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { SidePanel } from "@/components/lean-ui/side-panel";
import type { ViewChoice } from "@/components/lean-ui/types";
import { useDefData } from "@/components/lean-ui/use-def-data";
import { useSelection } from "@/components/lean-ui/use-selection";

export interface InspectorPanel {
  /** Opens the side panel on a def (a result row's inspect affordance). */
  select: (defId: string) => void;
  /** The SidePanel for the LeanUIShell `panel` slot, or null when closed. */
  panel: React.ReactNode;
  /** The selection's URL-reading leaf; render it once. */
  urlReader: React.ReactNode;
}

/** The `?def=` side panel the /search views share, fed from `data/def`. */
export function useInspectorPanel(): InspectorPanel {
  const router = useRouter();
  const {
    selectedDefId,
    selectDef,
    back,
    forward,
    close,
    canBack,
    canForward,
    urlReader,
  } = useSelection();
  const { defData, state, errorStatus, retry } = useDefData(selectedDefId);
  const [view, setView] = React.useState<ViewChoice>({ kind: "author" });

  const onIdentifierClick = React.useCallback(
    (target: { def_id: string; qualified_name: string }) =>
      selectDef(target.def_id),
    [selectDef],
  );
  const onViewInFile = React.useCallback(
    (defId: string, fileId: string) =>
      router.push(
        `/f/${encodeURIComponent(fileId)}?def=${encodeURIComponent(defId)}`,
      ),
    [router],
  );

  const panel =
    selectedDefId !== null ? (
      <SidePanel
        def_id={selectedDefId}
        def_data={defData}
        view={view}
        state={state}
        errorStatus={errorStatus}
        // /search is never a def's home file.
        canViewInFile={defData !== null}
        history={{ can_back: canBack, can_forward: canForward }}
        onBack={back}
        onForward={forward}
        onClose={close}
        onRetry={retry}
        onIdentifierClick={onIdentifierClick}
        onViewChange={setView}
        onViewInFile={onViewInFile}
      />
    ) : null;

  return { select: selectDef, panel, urlReader };
}
