"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";

import {
  IdentifierPopoverHost,
  IDENTIFIER_POPOVER_CONTENT_ID,
  type PopoverTarget,
} from "@/components/lean-ui/identifier-popover";
import { SidePanel } from "@/components/lean-ui/side-panel";
import { PropositionPanel } from "@/components/lean-ui/proposition-panel";
import { LeanUIShell } from "@/components/lean-ui/lean-ui-shell";
import { TokenTreeView } from "@/components/lean-ui/token-tree";
import { RenderViewToggle } from "@/components/lean-ui/render-view-toggle";
import inTextLinkStyles from "@/components/lean-ui/in-text-link.module.css";
import { useSelection } from "@/components/lean-ui/use-selection";
import { useDefData } from "@/components/lean-ui/use-def-data";
import { usePropData } from "@/components/lean-ui/use-prop-data";
import { useIsMobile } from "@/hooks/use-is-mobile";
import type {
  Decl,
  TokenTag,
  ViewChoice,
} from "@/components/lean-ui/types";
import { PublisherName } from "@/components/publisher-name";
import { Timestamp } from "@/components/ui/timestamp";

import { TheoremFlowchartRf } from "@/components/theorem-flowchart-rf/theorem-flowchart-rf";
import type { RfFlowchartNode } from "@/components/theorem-flowchart-rf/types";
import { HoldersModal } from "@/components/theorem-flowchart/holders-modal";
import type {
  TheoremPageResponse,
  DrillInRequest,
} from "@/components/theorem-flowchart/types";

import { TheoremSyntax } from "./theorem-syntax";
import { TheoremSplit } from "./theorem-split";
import { TheoremStatusBar } from "./status-bar";
import styles from "./page.module.css";

// Theorem Page body — the Client Component island that owns the page's URL
// state (`?def=`), the page-level author/empty view toggle, the side-panel
// fetch, the hover popover, and the provenance drill-in. Mirrors the file and
// profile bodies (ce-file-body.tsx / profile-body.tsx) for the shared machinery
// (panel fetch + AbortController guard, native-history `?def=`, single
// page-level popover anchored to a captured rect). The Server Component
// upstream does the page fetch + fallback decision and passes the parsed
// payload down.

// Page-level author/empty toggle, compact for the status-bar footer (the design
// moves it out of the content area into the workbench footer). The shared
// RenderViewToggle now bakes in its own visible "Syntax" axis label, so the
// footer no longer renders its own label (or wires `aria-labelledby`) — doing
// so would double-label the group. `ariaLabel="Page syntax"` is the scope-
// qualified accessible name so this page-level toggle stays distinguishable
// from the side panel's independent local toggle. Governs the header signature
// AND every node tree together.
function FooterViewToggle({
  view,
  onViewChange,
}: {
  view: ViewChoice;
  onViewChange: (next: ViewChoice) => void;
}) {
  return (
    <RenderViewToggle
      view={view}
      onViewChange={onViewChange}
      ariaLabel="Page syntax"
      className={styles.footerToggle}
    />
  );
}

// Header signature: the theorem's full type rendered from `decl.type_tokens`
// under the page view, identifiers clickable into the side panel + hoverable.
function HeaderSignature({
  decl,
  view,
  onIdentifierClick,
  onIdentifierHover,
  onIdentifierLeave,
}: {
  decl: Decl;
  view: ViewChoice;
  onIdentifierClick: (target: {
    def_id: string;
    qualified_name: string;
  }) => void;
  onIdentifierHover: (target: PopoverTarget) => void;
  onIdentifierLeave: () => void;
}) {
  const handleHover = React.useCallback(
    ({ tag, element }: { tag: TokenTag; element: HTMLElement }) => {
      const r = element.getBoundingClientRect();
      onIdentifierHover({
        tag,
        element,
        rect: { top: r.top, left: r.left, width: r.width, height: r.height },
      });
    },
    [onIdentifierHover],
  );

  // The signature renders from `decl.type_tokens` under the page view (design §
  // "Page composition" 1 — "the signature as a TokenTreeView over
  // decl.type_tokens"). The page payload's `decl` is the read-envelope without
  // the home-file source, so there is no source-bytes path here (unlike the side
  // panel's TypeSection); author view falls back to the empty tree when the
  // delab `author` tree is null.
  const tree =
    view.kind === "author"
      ? (decl.type_tokens.author ?? decl.type_tokens.empty)
      : decl.type_tokens.empty;
  return (
    <div className={styles.signature}>
      <TokenTreeView
        tree={tree}
        onIdentifierClick={onIdentifierClick}
        onIdentifierHover={handleHover}
        onIdentifierLeave={onIdentifierLeave}
      />
    </div>
  );
}

// Left info panel — the theorem's identity, moved off the top of the page into
// a resizable left pane (design redesign). Renders the synthetic Lean signature
// (`TheoremSyntax`) when the premise DAG is present, falling back to the flat
// `decl.type_tokens` signature otherwise; below it the publish attribution,
// date, and source-file link.
function TheoremInfoPanel({
  decl,
  premises,
  conclusion,
  dagPresent,
  premiseFree,
  createdAt,
  view,
  isMobile,
  fileContent,
  onIdentifierClick,
  onSelectProp,
  onIdentifierHover,
  onIdentifierLeave,
}: {
  decl: Decl;
  premises: RfFlowchartNode[];
  conclusion: RfFlowchartNode | null;
  dagPresent: boolean;
  premiseFree: boolean;
  createdAt: string;
  view: ViewChoice;
  isMobile: boolean;
  /** Source file text — threads through to `TheoremSyntax`'s author-view bytes. */
  fileContent?: string;
  onIdentifierClick: (target: {
    def_id: string;
    qualified_name: string;
  }) => void;
  onSelectProp: (proposition_id: string) => void;
  onIdentifierHover: (target: PopoverTarget) => void;
  onIdentifierLeave: () => void;
}) {
  // Publish date guarded by a parseable-timestamp check so an unparseable value
  // omits the whole line rather than rendering "Invalid Date" or a raw string.
  const hasPublishDate = !Number.isNaN(Date.parse(createdAt));
  // Mobile: collapsed to just the syntax `theorem <name>` line by default,
  // expanding into the full panel on tap (it otherwise eats the screen).
  const [open, setOpen] = React.useState(false);

  // The flat fallback signature (no DAG: open-binder / pre-backfill) — we can't
  // break the type into per-premise lines, so render decl.type_tokens.
  const flatSignature = (
    <HeaderSignature
      decl={decl}
      view={view}
      onIdentifierClick={onIdentifierClick}
      onIdentifierHover={onIdentifierHover}
      onIdentifierLeave={onIdentifierLeave}
    />
  );

  const metaContent = (
    <div className={styles.meta}>
      <p className={styles.metaLine}>
        Published by{" "}
        <PublisherName
          publisher={decl.publisher}
          className={inTextLinkStyles.link}
        />
        {hasPublishDate ? (
          <>
            {" · "}
            <Timestamp iso={createdAt} />
          </>
        ) : null}
      </p>

      <p className={styles.metaLine}>
        <Link
          href={`/f/${encodeURIComponent(decl.file_id)}?def=${encodeURIComponent(decl.def_id)}`}
          className={inTextLinkStyles.link}
        >
          View source in <code className={styles.fileChip}>{decl.file_id}</code>
        </Link>
      </p>

      {premiseFree ? (
        <p className={styles.premiseFree}>
          Definitional, with no premises to accept.
        </p>
      ) : null}
    </div>
  );

  if (isMobile) {
    // The collapsed bar IS the syntax's first line (`theorem <name>`, truncated)
    // with the chevron on it — no separate summary that duplicates the head. The
    // full signature (premises/conclusion + flat-fallback type + meta) pulls down
    // on tap. `TheoremSyntax` renders just `theorem <name>` for the no-DAG case
    // (empty premises / null conclusion), with the flat type appended below.
    const chevron = (
      <button
        type="button"
        className={styles.mobileChevron}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={
          open ? "Collapse theorem details" : "Expand theorem details"
        }
      >
        {open ? (
          <ChevronUp size={18} strokeWidth={2.5} aria-hidden="true" />
        ) : (
          <ChevronDown size={18} strokeWidth={2.5} aria-hidden="true" />
        )}
      </button>
    );
    return (
      <div className={styles.infoPanelMobile}>
        <TheoremSyntax
          decl={decl}
          premises={dagPresent ? premises : []}
          conclusion={dagPresent ? conclusion : null}
          view={view}
          fileContent={fileContent}
          sourceTokens={decl.source_tokens}
          collapsed={!open}
          toggleSlot={chevron}
          onIdentifierClick={onIdentifierClick}
          onSelectProp={onSelectProp}
          onIdentifierHover={onIdentifierHover}
          onIdentifierLeave={onIdentifierLeave}
        />
        {open && !dagPresent ? flatSignature : null}
        {open ? metaContent : null}
      </div>
    );
  }

  return (
    <div className={styles.infoPanel}>
      {/* `TheoremSyntax` ALWAYS renders so its sr-only `theorem <name>` <h1>
          anchors the page identity in BOTH the DAG and the no-DAG fallback
          cases (mirrors the mobile branch above). For the fallback it emits
          just `theorem <name>` (empty premises / null conclusion); the flat
          `decl.type_tokens` signature is appended below. */}
      <TheoremSyntax
        decl={decl}
        premises={dagPresent ? premises : []}
        conclusion={dagPresent ? conclusion : null}
        view={view}
        fileContent={fileContent}
        sourceTokens={decl.source_tokens}
        onIdentifierClick={onIdentifierClick}
        onSelectProp={onSelectProp}
        onIdentifierHover={onIdentifierHover}
        onIdentifierLeave={onIdentifierLeave}
      />
      {!dagPresent ? flatSignature : null}
      {metaContent}
    </div>
  );
}

export interface TheoremPageBodyProps {
  data: TheoremPageResponse;
}

export function TheoremPageBody({ data }: TheoremPageBodyProps) {
  const router = useRouter();
  const {
    selectedDefId,
    selectedPropId,
    selectDef,
    selectProp,
    back,
    forward,
    close,
    canBack,
    canForward,
    urlReader,
  } = useSelection();
  // The host owns the viewport reading so the shell and the SidePanel pick the
  // SAME branch in one render (docked pane on tablet/desktop, bottom Sheet on
  // mobile).
  const isMobile = useIsMobile();
  const {
    decl,
    adoption,
    dag,
    created_at: createdAt,
    file_content: fileContent,
  } = data;

  // ---- Side panel data ---------------------------------------------------
  const {
    defData,
    state: panelState,
    retry: retryFetch,
  } = useDefData(selectedDefId);
  const {
    propData,
    state: propState,
    errorStatus: propErrorStatus,
    retry: retryProp,
  } = usePropData(selectedPropId);


  // ---- View state. Page-level toggle (author/empty) governs header +
  // every node tree; the side panel keeps its own independent toggle. ----
  const [pageView, setPageView] = React.useState<ViewChoice>({
    kind: "author",
  });
  const [panelView, setPanelView] = React.useState<ViewChoice>({
    kind: "author",
  });

  const onIdentifierClick = React.useCallback(
    (target: { def_id: string; qualified_name: string }) =>
      selectDef(target.def_id),
    [selectDef],
  );

  // ---- Hover popover (single page-level instance, captured-rect anchor) --
  const [popoverTarget, setPopoverTarget] =
    React.useState<PopoverTarget | null>(null);
  const clearDescribedBy = React.useCallback(() => {
    if (typeof document === "undefined") return;
    document
      .querySelectorAll<HTMLElement>(
        `[aria-describedby="${IDENTIFIER_POPOVER_CONTENT_ID}"]`,
      )
      .forEach((el) => el.removeAttribute("aria-describedby"));
  }, []);
  const clearPopoverTarget = React.useCallback(() => {
    clearDescribedBy();
    setPopoverTarget(null);
  }, [clearDescribedBy]);

  const CLOSE_GRACE_MS = 120;
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const cancelScheduledClose = React.useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);
  const scheduleClose = React.useCallback(() => {
    cancelScheduledClose();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      clearDescribedBy();
      setPopoverTarget(null);
    }, CLOSE_GRACE_MS);
  }, [cancelScheduledClose, clearDescribedBy]);
  const onPopoverContentPointerEnter = React.useCallback(
    () => cancelScheduledClose(),
    [cancelScheduledClose],
  );
  const onPopoverContentPointerLeave = React.useCallback(
    () => scheduleClose(),
    [scheduleClose],
  );
  React.useEffect(() => cancelScheduledClose, [cancelScheduledClose]);

  const onIdentifierHover = React.useCallback(
    (target: PopoverTarget) => {
      cancelScheduledClose();
      clearDescribedBy();
      target.element.setAttribute(
        "aria-describedby",
        IDENTIFIER_POPOVER_CONTENT_ID,
      );
      setPopoverTarget(target);
    },
    [cancelScheduledClose, clearDescribedBy],
  );
  const onIdentifierLeave = React.useCallback(
    () => scheduleClose(),
    [scheduleClose],
  );

  // ---- Provenance drill-in (badge / adopter chip) -----------------------
  const [drillIn, setDrillIn] = React.useState<DrillInRequest | null>(null);
  const onBadgeActivate = React.useCallback(
    (args: {
      side: "pro" | "con";
      proposition_id: string;
      count: number;
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
  // The theorem-level adopter count now lives INSIDE the theorem (proof-fold)
  // node as a turnstile chip; activating it opens the same adopters drill-in,
  // anchored to the chip element the node hands up.
  const onAdoptersActivate = React.useCallback(
    (element: HTMLElement) => {
      setDrillIn({ kind: "adopters", def_id: decl.def_id, element });
    },
    [decl.def_id],
  );
  const closeDrillIn = React.useCallback(() => setDrillIn(null), []);

  // Premise nodes carry their snake_case binder `name` straight from the wire so
  // the cards read "moral_duty" rather than the bare "Premise"; the nodes pass
  // through unmodified.
  const flowchartNodes = React.useMemo(
    () => (dag !== null ? dag.nodes : []),
    [dag],
  );

  // ---- Cross-file "View in file" navigation -----------------------------
  const navigateToFile = React.useCallback(
    (def_id: string, target_file_id: string) => {
      router.push(
        `/f/${encodeURIComponent(target_file_id)}?def=${encodeURIComponent(def_id)}`,
      );
    },
    [router],
  );
  // The theorem page never IS a file page, so the panel's def is always in a
  // different file — "View in file" is useful once data lands.
  const canViewInFile = defData !== null;

  // ---- Adoption + signature derivation ----------------------------------
  // The theorem-level adopter count now rides INSIDE the theorem (proof-fold)
  // node as a turnstile chip; the premise/conclusion breakdown drives the left
  // panel's synthetic signature (`TheoremSyntax`). Both read off the same
  // name-zipped `flowchartNodes`.
  const premiseNodes = React.useMemo(
    () => flowchartNodes.filter((n) => n.kind === "premise"),
    [flowchartNodes],
  );
  const conclusionNode = React.useMemo(
    () => flowchartNodes.find((n) => n.kind === "conclusion") ?? null,
    [flowchartNodes],
  );
  // Adopter count is shown only for a premise-bearing theorem; premise-free or
  // pre-backfill (adoption === null) → undefined, so the node shows no turnstile
  // and the panel shows the "definitional" note instead.
  const adopterCount =
    adoption !== null && adoption.premise_count > 0
      ? (adoption.adopter_count ?? 0)
      : undefined;
  const premiseFree = adoption !== null && adoption.premise_count === 0;

  // The side panel, lifted to the shell's `panel` slot so it docks right on
  // tablet/desktop (a resizable pane) and renders its own bottom Sheet on
  // mobile — instead of stacking below the flowchart in the reading column.
  const panel =
    selectedDefId !== null ? (
      <SidePanel
        def_id={selectedDefId}
        def_data={defData}
        view={panelView}
        state={panelState}
        canViewInFile={canViewInFile}
        history={{ can_back: canBack, can_forward: canForward }}
        onBack={back}
        onForward={forward}
        currentTheoremDefId={decl.def_id}
        // This page IS the theorem's statement surface (TheoremSyntax renders
        // premises + conclusion beside the flowchart), so the panel's own
        // Conclusion / Premises sections are suppressed here.
        showTheoremStatement={false}
        onClose={close}
        onRetry={retryFetch}
        onIdentifierClick={onIdentifierClick}
        onViewChange={setPanelView}
        onViewInFile={navigateToFile}
        onSelectProp={selectProp}
        onHoldersDrillIn={onHoldersDrillIn}
      />
    ) : selectedPropId !== null ? (
      <PropositionPanel
        prop_id={selectedPropId}
        prop_data={propData}
        view={panelView}
        state={propState}
        errorStatus={propErrorStatus}
        history={{ can_back: canBack, can_forward: canForward }}
        onBack={back}
        onForward={forward}
        onClose={close}
        onRetry={retryProp}
        onViewChange={setPanelView}
        onSelectDef={onIdentifierClick}
        onSelectProp={selectProp}
        onHoldersDrillIn={onHoldersDrillIn}
      />
    ) : null;

  // Left pane — the theorem identity, lifted off the page top into the panel.
  const infoPanel = (
    <TheoremInfoPanel
      decl={decl}
      premises={premiseNodes}
      conclusion={conclusionNode}
      dagPresent={dag !== null}
      premiseFree={premiseFree}
      createdAt={createdAt}
      view={pageView}
      isMobile={isMobile}
      fileContent={fileContent}
      onIdentifierClick={onIdentifierClick}
      onSelectProp={selectProp}
      onIdentifierHover={onIdentifierHover}
      onIdentifierLeave={onIdentifierLeave}
    />
  );

  // Right pane — the full-bleed flowchart canvas (or the dag-absent fallback).
  const canvas =
    dag !== null ? (
      <div className={styles.canvasFull}>
        <TheoremFlowchartRf
          nodes={flowchartNodes}
          edges={dag.edges}
          view={pageView}
          /* AUTHOR-view source-bytes rendering: the whole home-file source +
           * the theorem decl's source tokens let each aligned premise/conclusion
           * card render its proposition from VERBATIM source bytes (preserving
           * the authored surface syntax) instead of delaborating the token tree.
           * Mirrors how profile-body threads `file_content_by_file` to AxiomRow. */
          fileContent={fileContent}
          sourceTokens={decl.source_tokens}
          theoremName={decl.local_name}
          theoremDefId={decl.def_id}
          theoremQualifiedName={decl.qualified_name}
          premiseColumns={isMobile ? 2 : "auto"}
          adopterCount={adopterCount}
          onAdoptersActivate={onAdoptersActivate}
          onIdentifierClick={onIdentifierClick}
          onSelectProp={selectProp}
          onIdentifierHover={onIdentifierHover}
          onIdentifierLeave={onIdentifierLeave}
          onBadgeActivate={onBadgeActivate}
        />
      </div>
    ) : (
      <div className={styles.canvasFull}>
        <FallbackNote hasAdoption={adoption !== null} />
      </div>
    );

  return (
    <>
      {/* `.shellWrapper` grows inside the workbench column (page.tsx) so the
       * footer status bar sits at the bottom edge while the shell fills the
       * rest. `LeanUIShell` docks the lean side panel as the OUTER right-side
       * resizable pane; the INNER `TheoremSplit` is the theorem info panel +
       * full-bleed canvas. */}
      <div className={styles.shellWrapper}>
        <LeanUIShell
          panel={panel}
          isMobile={isMobile}
          id="lean-ui-side-panel-width"
        >
          <TheoremSplit info={infoPanel} canvas={canvas} isMobile={isMobile} />
        </LeanUIShell>
      </div>

      {/* Footer status bar — carries the page-level author/empty view toggle
       * (moved here out of the content area) alongside the workbench chrome. */}
      <TheoremStatusBar
        localName={decl.local_name}
        premiseCount={adoption?.premise_count ?? null}
        viewToggle={
          <FooterViewToggle view={pageView} onViewChange={setPageView} />
        }
      />

      {/* Page-level overlays — portaled; kept outside the shell so they are
       * neither clipped by the workbench's overflow nor scrolled with the
       * reading column. */}
      <IdentifierPopoverHost
        target={popoverTarget}
        onClose={clearPopoverTarget}
        onContentPointerEnter={onPopoverContentPointerEnter}
        onContentPointerLeave={onPopoverContentPointerLeave}
      />
      {/* Both drill-ins — the per-proposition Holding bar (kind "holders") and
          the theorem-level adopter chip (kind "adopters") — open the same
          searchable Dialog modal, which lists locked-out accounts flagged
          inconsistent. The modal switches view by `request.kind`. */}
      <HoldersModal request={drillIn} onClose={closeDrillIn} />
      {urlReader}
    </>
  );
}

// Fallback note in the flowchart slot when `dag === null`. With the Prop-only
// telescope rule plus proof-irrelevance coarsening the no-adoption case is now
// rare: a closed-Π conclusion emits a certificate, and a theorem open only over
// proof binders (e.g. a coercion-bundled instance) also certifies — its proofs
// coarsen away at keying. What remains is a genuinely unrepresentable premise
// structure (open over a data parameter the conclusion depends on, or a
// derivation the substrate can't ground). Distinguishes that case (no
// certificate — adoption null) from the un-backfilled case (certificate present,
// DAG still pending). The page NEVER 404s for a real published theorem.
function FallbackNote({ hasAdoption }: { hasAdoption: boolean }) {
  return (
    <section
      className={styles.fallback}
      aria-label="Premise flowchart unavailable"
    >
      {hasAdoption ? (
        <p>
          This theorem hasn&apos;t been indexed yet. Its premise flowchart and
          adoption summary will appear once the substrate backfill reaches it.
        </p>
      ) : (
        <p>
          This theorem&apos;s premise structure can&apos;t be represented as a
          flowchart: its conclusion depends on a parameter the substrate
          can&apos;t pin down, so there&apos;s no adoption summary. This is
          rare.
        </p>
      )}
    </section>
  );
}
