// Compact wire form of a Shiki hast tree, for crossing the RSC → client
// boundary. The file page's hast is serialised into the page twice over (the
// HTML and its RSC payload), and per-node hast boilerplate
// (`{"type":"element","tagName":…,"properties":…,"children":[…]}`) dominates a
// token-dense file. The wire form drops it:
//
//   text node    → its string value
//   element node → [tagName, propsIndex, ...children]
//
// with every distinct `properties` object stored once in `props` (Shiki's
// grammar spans repeat a handful of `style`s thousands of times). Comment and
// doctype nodes are dropped; `renderHast` renders them as nothing.

/**
 * @param {import("hast").Root} root
 * @returns {import("./hast-wire.d.mts").HastWire}
 */
export function encodeHast(root) {
  /** @type {import("hast").Properties[]} */
  const props = [];
  /** @type {Map<string, number>} */
  const propsIndex = new Map();
  /** @param {import("hast").RootContent} node */
  const encode = (node) => {
    if (node.type === "text") return node.value;
    if (node.type !== "element") return null;
    const properties = node.properties ?? {};
    const key = JSON.stringify(properties);
    let index = propsIndex.get(key);
    if (index === undefined) {
      index = props.length;
      props.push(properties);
      propsIndex.set(key, index);
    }
    return [node.tagName, index, ...encodeChildren(node.children)];
  };
  /** @param {import("hast").RootContent[]} children */
  const encodeChildren = (children) =>
    children.map(encode).filter((n) => n !== null);
  return { props, children: encodeChildren(root.children) };
}

/**
 * @param {import("./hast-wire.d.mts").HastWire} wire
 * @returns {import("hast").Root}
 */
export function decodeHast(wire) {
  /**
   * @param {import("./hast-wire.d.mts").HastWireNode} node
   * @returns {import("hast").ElementContent}
   */
  const decode = (node) => {
    if (typeof node === "string") return { type: "text", value: node };
    const [tagName, index, ...children] = node;
    return {
      type: "element",
      tagName,
      properties: wire.props[index],
      children: children.map(decode),
    };
  };
  return { type: "root", children: wire.children.map(decode) };
}
