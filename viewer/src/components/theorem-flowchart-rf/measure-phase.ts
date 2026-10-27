// Two-phase measure/commit vocabulary for the theorem shell: the phase names,
// the phase-1 grid pitch, and the pure box-table operations the shell's effects
// run on. Kept out of the `"use client"` shell so the unit runner imports them
// without React, `@xyflow/react`, or a CSS Module.

import { NODE_HEIGHT, PREMISE_ROW_GAP } from "./layout";
import type { BoxSize, BoxTable } from "./layout-model";

/**
 * The shell's layout phase, mirrored onto the wrapper as `data-layout`.
 * `seeding` paints the seed grid with cards clamped to one phase-1 cell;
 * `measuring` drops the clamp so the observer reports true card sizes;
 * `settled` is the committed arrangement.
 */
export type LayoutPhase = "seeding" | "measuring" | "settled";

/**
 * Height of one phase-1 grid cell (px): three fixed cards' worth of room, which
 * is what the `seeding` clamp holds every card to. A card clamped to the cell can
 * at most reach the next row's top edge, so no card can overlap the row below
 * before the box table is committed.
 */
export const PHASE1_ROW_PITCH = 3 * NODE_HEIGHT;

/**
 * The box the phase-1 seed grid reserves per card: as wide as the active Measure
 * Rung (the widest a card may measure), and one CELL tall LESS the grid's own row
 * gap — the grid adds that gap back, so box + gap is exactly
 * {@link PHASE1_ROW_PITCH}.
 */
export function phase1Box(rung: number): BoxSize {
  return { width: rung, height: PHASE1_ROW_PITCH - PREMISE_ROW_GAP };
}

/** The phase-1 seed table: every card at {@link phase1Box}, keyed by node id. */
export function phase1Boxes(ids: Iterable<string>, rung: number): BoxTable {
  const box = phase1Box(rung);
  const boxes: BoxTable = {};
  for (const id of ids) boxes[id] = box;
  return boxes;
}

/** The only field the shell reads off a React Flow internal node. */
export interface MeasuredNode {
  measured?: { width?: number; height?: number };
}

/** The committed box table plus the content identity it was measured for. */
export interface BoxCommit {
  key: string;
  boxes: BoxTable;
}

/** Pre-commit value; also the empty table a stale-key read falls back to. */
export const NO_BOXES: BoxCommit = { key: "", boxes: {} };

/** Both extents finite and positive — anything else is a degenerate measure. */
function usable(box: BoxSize): boolean {
  return (
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.width > 0 &&
    box.height > 0
  );
}

/**
 * Measured boxes per node id, read from React Flow's internal node lookup — the
 * only place they exist, since this flow is controlled with no `onNodesChange`
 * and measurements never reach the user nodes. Nodes React Flow has not sized
 * yet, and nodes it sized degenerately, are OMITTED: comparing the table's size
 * against the lookup's is then the "everything measured" gate, and a degenerate
 * box holds the shell in `seeding` instead of committing a collapsed layout.
 */
export function boxesFromLookup(
  lookup: Iterable<[string, MeasuredNode]>,
): BoxTable {
  const boxes: BoxTable = {};
  for (const [id, node] of lookup) {
    const { width, height } = node.measured ?? {};
    if (width === undefined || height === undefined) continue;
    const box = { width, height };
    if (!usable(box)) continue;
    boxes[id] = box;
  }
  return boxes;
}

/** Same ids, same extents. */
export function sameBoxes(a: BoxTable, b: BoxTable): boolean {
  const ids = Object.keys(a);
  if (ids.length !== Object.keys(b).length) return false;
  return ids.every((id) => {
    const mine = a[id];
    const theirs = b[id];
    return (
      theirs !== undefined &&
      mine.width === theirs.width &&
      mine.height === theirs.height
    );
  });
}

/** A measurement the solver can consume: non-empty, every box usable. */
export function committable(boxes: BoxTable): boolean {
  const ids = Object.keys(boxes);
  return ids.length > 0 && ids.every((id) => usable(boxes[id]));
}

/**
 * Commit a measurement under its content identity. Returns `prev` UNCHANGED
 * when that identity already holds these boxes, so the React state write bails
 * out: one content identity costs at most two writes — the phase-1 read and the
 * unclamped re-read — however many times the observer reports.
 */
export function commitBoxes(
  prev: BoxCommit,
  key: string,
  boxes: BoxTable,
): BoxCommit {
  if (prev.key === key && sameBoxes(prev.boxes, boxes)) return prev;
  return { key, boxes };
}

/** The boxes committed for `key`; empty when the commit belongs to another. */
export function boxesFor(commit: BoxCommit, key: string): BoxTable {
  return commit.key === key ? commit.boxes : NO_BOXES.boxes;
}

/**
 * Stamp measured dimensions back onto an emitted node. Without the echo
 * `adoptUserNodes` resets `handleBounds` on every render that rebuilds the node
 * objects — a stance re-colour — re-arming measurement from scratch.
 */
export function echoMeasured<T extends { id: string }>(
  node: T,
  boxes: BoxTable,
): T {
  const box = boxes[node.id];
  if (box === undefined) return node;
  return { ...node, measured: { width: box.width, height: box.height } };
}
