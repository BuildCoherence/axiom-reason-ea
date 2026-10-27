"use client";

// This component renders a panel and never routes: the selection and its
// `replaceState` write live in `graph-explorer.tsx`.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Drawer } from "vaul";

import { IslandErrorBoundary } from "@/components/island-error-boundary";
import { Button } from "@/components/ui/button";
import { PropositionPanel } from "@/components/lean-ui/proposition-panel";
import { SidePanel } from "@/components/lean-ui/side-panel";
import {
  PROP_PANEL_ID,
  SIDE_PANEL_ID,
  type ViewChoice,
} from "@/components/lean-ui/types";
import { HoldersModal } from "@/components/theorem-flowchart/holders-modal";
import type { DrillInRequest } from "@/components/theorem-flowchart/types";
import { useDefData } from "@/components/lean-ui/use-def-data";
import { usePropData } from "@/components/lean-ui/use-prop-data";

import {
  graphCanonicalPropId,
  graphConnectedCountText,
  type GraphConnectedRow,
  type GraphPanelSelection,
} from "./graph-panel-model";
import styles from "./graph-panel.module.css";

/** The profile workbench's convention: a visitor who has met one bottom sheet here should not learn a second set of stops. */
export const GRAPH_DRAWER_SNAP_POINTS: readonly number[] = [0.27, 0.55, 0.95];
/** Where it OPENS. A tap on a node is a glance, not a commitment. */
export const GRAPH_DRAWER_PEEK_SNAP = GRAPH_DRAWER_SNAP_POINTS[0];

export type GraphPanelProps = {
  /** NEVER null: the shell mounts this component only while something is selected. */
  selection: GraphPanelSelection;
  /** Bumped on EVERY select, including a re-select of the node already open. */
  openNonce: number;
  /** The HOST's viewport reading, forwarded rather than read again here, so the
   *  shell's choice of container and this component's choice of chrome cannot
   *  disagree for a render. The host is also what owns the docked pane's width
   *  (its `ResizablePanel`), which only exists on the desktop branch. */
  isMobile: boolean;
  history: { can_back: boolean; can_forward: boolean };
  onBack: () => void;
  onForward: () => void;
  onClose: () => void;
  /** Re-point the panel at another node id; the shell resolves the axis. */
  onSelectId: (id: string) => void;
  onSelectSelection: (selection: GraphPanelSelection) => void;
  /** The requested id resolved through the merged-proposition aliases. */
  onCanonicalId: (id: string) => void;
  /** The Connected section's rows. EMPTY suppresses the section entirely. */
  connected: readonly GraphConnectedRow[];
};

/** Collapsed at rest — the count is the whole answer at a glance, and no rung
 *  pays for a list nobody opened. Rows are buttons: a click never navigates. */
function GraphConnectedSection({
  rows,
  onSelect,
}: {
  rows: readonly GraphConnectedRow[];
  onSelect: (selection: GraphPanelSelection) => void;
}) {
  const [open, setOpen] = React.useState(false);
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-1.5" aria-label="Graph Connections">
      {/* Mirrors side-panel.module.css `.sectionTitle` (0.85rem/600/-0.01em,
       * foreground at 90%) — replicated in utilities rather than importing the
       * module: a cross-module CSS import reorders the page's css chunks and
       * broke the panel's scroll flex on /graph. */}
      <h3 className="m-0 text-[0.85rem] font-semibold tracking-[-0.01em] text-foreground/90">
        Graph Connections
      </h3>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto justify-start px-2 py-1 text-xs text-muted-foreground"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "▾" : "▸"} {graphConnectedCountText(rows.length)}
      </Button>
      {open ? (
        <ul className="m-0 flex list-none flex-col rounded-md border border-border p-0 [&>li+li]:border-t [&>li+li]:border-border">
          {rows.map((row) => (
            <li key={`${row.selection.kind}:${row.selection.id}`}>
              <button
                type="button"
                onClick={() => onSelect(row.selection)}
                className="flex w-full items-baseline gap-2.5 px-3 py-2 text-left font-serif text-sm leading-snug hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span
                  aria-hidden="true"
                  className="mt-1 inline-block size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: `var(${row.token})` }}
                />
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {row.label}
                </span>
                <span className="shrink-0 font-mono text-[0.625rem] text-muted-foreground">
                  {row.kindLabel}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function GraphPanel(props: GraphPanelProps) {
  return (
    // A render throw inside the panel must not blank /graph. Fetch failures
    // never reach here — the hooks turn those into the shell's error surface.
    <IslandErrorBoundary logLabel="graph-panel" fallback={null}>
      <GraphPanelBody {...props} />
    </IslandErrorBoundary>
  );
}

function GraphPanelBody({
  selection,
  openNonce,
  isMobile,
  history,
  onBack,
  onForward,
  onClose,
  onSelectId,
  onSelectSelection,
  onCanonicalId,
  connected,
}: GraphPanelProps) {
  const router = useRouter();
  const [view, setView] = React.useState<ViewChoice>({ kind: "author" });
  const [drillIn, setDrillIn] = React.useState<DrillInRequest | null>(null);
  const closeDrillIn = React.useCallback(() => setDrillIn(null), []);

  // Exactly one read is ever live: the other hook is handed `null` and sits in
  // `idle`.
  const propId = selection.kind === "prop" ? selection.id : null;
  const defId = selection.kind === "def" ? selection.id : null;

  const {
    propData,
    state: propState,
    errorStatus: propErrorStatus,
    retry: retryProp,
  } = usePropData(propId);
  const {
    defData,
    state: defState,
    errorStatus: defErrorStatus,
    retry: retryDef,
  } = useDefData(defId);

  // Safe only because the shell REMOUNTS this component per selection: without
  // that key, the render which first sees a new id still holds the previous
  // node's payload, and resolving that pair snaps the selection back.
  const canonicalId =
    propId === null ? null : graphCanonicalPropId(propId, propData);
  React.useEffect(() => {
    if (canonicalId !== null) {
      onCanonicalId(canonicalId);
    }
  }, [canonicalId, onCanonicalId]);

  const onHoldersDrillIn = React.useCallback(
    (args: {
      side: "pro" | "con";
      proposition_id: string;
      element: HTMLElement;
    }) => {
      setDrillIn({
        kind: "holders",
        side: args.side,
        proposition_id: args.proposition_id,
        element: args.element,
      });
    },
    [],
  );

  // Declared unconditionally (hooks may not be conditional) and consumed only on
  // the mobile path — `PanelShell` never invokes `renderMobileContainer` while
  // `useIsMobile()` is false.
  const [snap, setSnap] = React.useState<number | string | null>(
    GRAPH_DRAWER_PEEK_SNAP,
  );
  // Keyed on `openNonce`, NOT on the id: tapping the node that is already
  // selected must bring a dragged-away drawer back.
  React.useEffect(() => {
    setSnap(GRAPH_DRAWER_PEEK_SNAP);
  }, [openNonce]);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      // The ONLY dismissal path vaul reports: drag below the first snap, the
      // drawer's own Close, and Esc all arrive here.
      if (!next) onClose();
    },
    [onClose],
  );

  const renderMobileContainer = React.useCallback(
    ({
      children,
      panelRootRef,
    }: {
      children: React.ReactNode;
      // A ref CALLBACK: on this path the container mounts through a portal
      // AFTER the shell's effects have run. See `attachPanelRoot`.
      panelRootRef: React.RefCallback<HTMLDivElement>;
    }) => (
      <Drawer.Root
        open
        onOpenChange={handleOpenChange}
        snapPoints={[...GRAPH_DRAWER_SNAP_POINTS]}
        activeSnapPoint={snap}
        setActiveSnapPoint={setSnap}
        // No overlay, so the canvas behind stays interactive — and so the
        // background tap belongs to the hit test, not to this drawer.
        modal={false}
        // Unlike the profile's furniture drawer, this one is a response to a
        // selection, so dragging it away must be able to end it.
        dismissible
      >
        <Drawer.Portal>
          <Drawer.Content
            // On the OUTERMOST node: it is the root the shell queries for the
            // focus marker and the root its Esc containment check uses.
            ref={panelRootRef}
            id={selection.kind === "def" ? SIDE_PANEL_ID : PROP_PANEL_ID}
            role="region"
            aria-label={panelAriaLabel(selection)}
            // Radix would otherwise warn about a missing description on every
            // open; the panel's own body is the description.
            aria-describedby={undefined}
            className={styles.drawer}
          >
            <div className="flex items-center justify-center py-1">
              <Drawer.Handle className="!bg-border" />
            </div>
            {/* Required by Radix `Dialog` for AT announcement. Same string as
             *  the region label so the two cannot disagree. */}
            <Drawer.Title className="sr-only">
              {panelAriaLabel(selection)}
            </Drawer.Title>
            {/* No close row of its own: `hostSuppliesFocusMarker={false}` is
             *  what keeps the shell's Close AND its focus markers, so this
             *  container must not add either. */}
            <div className={styles.drawerPane}>{children}</div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    ),
    [handleOpenChange, snap, selection],
  );

  // Passed as a body slot rather than rendered beside the panel: the shell's
  // `hasData` gate is what keeps the section off a failed read, where the
  // neighbour walk has nothing to say either.
  const connectedSection = (
    <GraphConnectedSection rows={connected} onSelect={onSelectSelection} />
  );

  const panel =
    selection.kind === "prop" ? (
      <PropositionPanel
        prop_id={selection.id}
        prop_data={propData}
        view={view}
        state={propState}
        errorStatus={propErrorStatus}
        history={history}
        onBack={onBack}
        onForward={onForward}
        onClose={onClose}
        onRetry={retryProp}
        onViewChange={setView}
        // An identifier inside `p` is a DEF reference — a cross-type pivot.
        onSelectDef={(t) => onSelectSelection({ kind: "def", id: t.def_id })}
        onSelectProp={(id) => onSelectSelection({ kind: "prop", id })}
        onHoldersDrillIn={onHoldersDrillIn}
        renderMobileContainer={renderMobileContainer}
        hostSuppliesFocusMarker={false}
        bodyExtras={connectedSection}
      />
    ) : (
      <SidePanel
        def_id={selection.id}
        def_data={defData}
        view={view}
        state={defState}
        errorStatus={defErrorStatus}
        // /graph is never a def's home file, so the affordance is offered as
        // soon as there is a file to offer.
        canViewInFile={defData !== null}
        history={history}
        onBack={onBack}
        onForward={onForward}
        onClose={onClose}
        onRetry={retryDef}
        onIdentifierClick={(t) =>
          onSelectSelection({ kind: "def", id: t.def_id })
        }
        onViewChange={setView}
        // "A click never navigates" is about NODES, not link-outs: the visitor
        // asked for the file.
        onViewInFile={(def_id, file_id) =>
          router.push(
            `/f/${encodeURIComponent(file_id)}?def=${encodeURIComponent(def_id)}`,
          )
        }
        onSelectProp={(id) => onSelectSelection({ kind: "prop", id })}
        onHoldersDrillIn={onHoldersDrillIn}
        renderMobileContainer={renderMobileContainer}
        hostSuppliesFocusMarker={false}
        bodyExtras={connectedSection}
      />
    );

  return (
    <>
      {/* The docked pane fills the width its `ResizablePanel` was dragged to
          — no width of its own, and NO `border-l`: the resize handle beside it
          is the 1px divider, exactly as on the Theorem Page. The host mounts
          this branch only on the desktop side of the same breakpoint
          `useIsMobile` reads, so no media-query guard is duplicated here. */}
      {isMobile ? (
        panel
      ) : (
        <aside className="flex size-full flex-col overflow-hidden bg-background">
          <div className={styles.pane}>{panel}</div>
        </aside>
      )}
      {/* HOST-MOUNTED: the modal must outlive the panel that opened it. */}
      <HoldersModal request={drillIn} onClose={closeDrillIn} />
    </>
  );
}

function panelAriaLabel(selection: GraphPanelSelection): string {
  return selection.kind === "def"
    ? "Declaration inspection"
    : "Proposition inspection";
}

export default GraphPanel;
