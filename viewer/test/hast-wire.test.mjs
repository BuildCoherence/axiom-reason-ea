import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { decodeHast, encodeHast } from "../src/components/lean-ui/hast-wire.mjs";

const span = (properties, ...children) => ({
  type: "element",
  tagName: "span",
  properties,
  children,
});
const text = (value) => ({ type: "text", value });

// The shape Shiki's `codeToHast` emits with decorations: a `pre > code` of
// line spans holding grammar spans and decorated identifier spans.
const shikiShaped = () => ({
  type: "root",
  children: [
    {
      type: "element",
      tagName: "pre",
      properties: { class: "shiki", style: "background-color:var(--base01)", tabindex: "0" },
      children: [
        {
          type: "element",
          tagName: "code",
          properties: {},
          children: [
            span(
              { class: "line" },
              span({ style: "color:var(--base0E)" }, text("axiom")),
              span({ style: "color:var(--base05)" }, text(" ")),
              span(
                {
                  style: "color:var(--base05)",
                  "data-kind": "identifier",
                  "data-def-id": "p0000001",
                  "data-inlined-type-summary": "Person : Type <&> \"q\"",
                  tabindex: "0",
                  class: ["ce-identifier"],
                },
                text("Person"),
              ),
              span({ style: "color:var(--base05)" }, text(" : Type")),
            ),
            text("\n"),
            span({ class: "line" }),
          ],
        },
      ],
    },
  ],
});

describe("hast wire form", () => {
  test("decodes to the tree it encoded", () => {
    const hast = shikiShaped();
    assert.deepEqual(decodeHast(encodeHast(hast)), hast);
  });

  test("survives JSON serialisation, as an RSC prop does", () => {
    const hast = shikiShaped();
    const wire = JSON.parse(JSON.stringify(encodeHast(hast)));
    assert.deepEqual(decodeHast(wire), hast);
  });

  test("stores each distinct properties object once", () => {
    const wire = encodeHast(shikiShaped());
    const keys = wire.props.map((p) => JSON.stringify(p));
    assert.equal(new Set(keys).size, keys.length);
    // pre, code, line, two grammar styles, the identifier.
    assert.equal(wire.props.length, 6);
  });

  test("drops comment and doctype nodes, which render as nothing", () => {
    const hast = shikiShaped();
    const withComments = {
      type: "root",
      children: [
        { type: "doctype" },
        ...hast.children,
        { type: "comment", value: "x" },
      ],
    };
    assert.deepEqual(decodeHast(encodeHast(withComments)), hast);
  });

  test("is smaller than the hast JSON it replaces", () => {
    const hast = shikiShaped();
    assert.ok(
      JSON.stringify(encodeHast(hast)).length < JSON.stringify(hast).length / 2,
    );
  });
});
