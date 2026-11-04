import type { Properties, Root } from "hast";

export type HastWireNode = string | [string, number, ...HastWireNode[]];

export interface HastWire {
  props: Properties[];
  children: HastWireNode[];
}

export function encodeHast(root: Root): HastWire;
export function decodeHast(wire: HastWire): Root;
