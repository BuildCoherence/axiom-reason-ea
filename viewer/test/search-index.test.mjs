// The viewer's search over `search-index.json` must return what `axm search`
// and `axm query` return. These cases and the index are the CLI's own
// (axiom/cli/cmd/search_test.go `searchFixture`, query_test.go).
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_SORT,
  paginate,
  parseDateBound,
  parseSort,
  queryTypeHead,
  searchConstants,
  searchTypes,
  searchUsers,
} from "../src/lib/search-index.mjs";

const constant = (def_id, name, kind, type_head, file_id, created_at, publisher) => ({
  def_id,
  name,
  kind,
  type_head,
  file_id,
  created_at,
  publisher,
  decl_byte_start: 0,
  signature_byte_end: 0,
  declaration_role: null,
});

const INDEX = {
  constants: [
    constant("k1", "Foo.carrierAlpha", "def", "Axiom.Statement", "a1111111", "2026-01-10T00:00:00Z", "alice"),
    constant("k2", "Bar.beta", "theorem", "Axiom.Statement", "b2222222", "2026-03-05T00:00:00Z", "bob"),
    constant("k3", "Baz.gamma", "theorem", null, "c3333333", "2026-02-01T00:00:00Z", null),
    constant("k4", "Foo.delta", "axiom", "Axiom.Other", "d4444444", "2026-04-01T00:00:00Z", "alice"),
  ],
  types: [
    {
      type_head: "Nat",
      searchable_name: "Nat",
      arity: 0,
      params: [],
      file_id: null,
      def_id: null,
      kind: null,
      publisher: null,
      created_at: null,
    },
    {
      type_head: "Axiom.Statement",
      searchable_name: "Statement",
      arity: 1,
      params: [{ index: 0, name: "p", type: "Prop", binder: "default" }],
      file_id: "a1111111",
      def_id: "k1",
      kind: "def",
      publisher: "alice",
      created_at: "2026-01-10T00:00:00Z",
    },
    {
      type_head: "Axiom.Empty",
      searchable_name: "EmptyHead",
      arity: 0,
      params: [],
      file_id: "b2222222",
      def_id: "k2",
      kind: "def",
      publisher: "bob",
      created_at: "2026-03-05T00:00:00Z",
    },
  ],
  users: [
    { username: "alice", first_published_at: "2026-01-10T00:00:00Z" },
    { username: "bob", first_published_at: "2026-03-05T00:00:00Z" },
    { username: "carol", first_published_at: null },
  ],
};

// Mirrors the CLI flags: [query, {sort, author, after, before, kinds}].
function filtersOf(opts) {
  return {
    kinds: opts.kinds ?? [],
    author: opts.author ?? "",
    after: opts.after ? parseDateBound(opts.after) : null,
    before: opts.before ? parseDateBound(opts.before) : null,
  };
}
const sortOf = (opts) => parseSort(opts.sort ?? DEFAULT_SORT);

describe("search types", () => {
  const cases = [
    ["", {}, ["Axiom.Empty", "Axiom.Statement", "Nat"]],
    ["", { sort: "created_at:asc" }, ["Nat", "Axiom.Statement", "Axiom.Empty"]],
    ["", { sort: "name:asc" }, ["Axiom.Empty", "Nat", "Axiom.Statement"]],
    ["", { sort: "name:desc" }, ["Axiom.Statement", "Nat", "Axiom.Empty"]],
    ["stat", {}, ["Axiom.Statement"]],
    ["AXIOM.EMP", {}, ["Axiom.Empty"]],
    ["", { author: "@Alice" }, ["Axiom.Statement"]],
    ["", { after: "2026-01-10" }, ["Axiom.Empty", "Axiom.Statement"]],
    ["", { after: "2026-01-10T00:00:01Z" }, ["Axiom.Empty"]],
    ["", { before: "2026-03-05" }, ["Axiom.Statement"]],
    ["zzz", {}, []],
  ];
  for (const [q, opts, want] of cases) {
    test(`${JSON.stringify(q)} ${JSON.stringify(opts)}`, () => {
      const rows = searchTypes(INDEX, q, filtersOf(opts), sortOf(opts));
      assert.deepEqual(rows.map((r) => r.type_head), want);
    });
  }
});

describe("search constants", () => {
  const cases = [
    ["", {}, ["Foo.delta", "Bar.beta", "Baz.gamma", "Foo.carrierAlpha"]],
    ["", { sort: "created_at:asc" }, ["Foo.carrierAlpha", "Baz.gamma", "Bar.beta", "Foo.delta"]],
    ["", { sort: "name:asc" }, ["Bar.beta", "Baz.gamma", "Foo.carrierAlpha", "Foo.delta"]],
    ["", { sort: "name:desc" }, ["Foo.delta", "Foo.carrierAlpha", "Baz.gamma", "Bar.beta"]],
    ["foo.", {}, ["Foo.delta", "Foo.carrierAlpha"]],
    ["", { kinds: ["theorem"] }, ["Bar.beta", "Baz.gamma"]],
    ["", { kinds: ["def", "axiom"] }, ["Foo.delta", "Foo.carrierAlpha"]],
    ["", { author: "ALICE" }, ["Foo.delta", "Foo.carrierAlpha"]],
    ["", { author: "@bob" }, ["Bar.beta"]],
    ["", { after: "2026-03-05" }, ["Foo.delta", "Bar.beta"]],
    ["", { before: "2026-03-05" }, ["Baz.gamma", "Foo.carrierAlpha"]],
    ["", { after: "2026-02-01", before: "2026-04-01" }, ["Bar.beta", "Baz.gamma"]],
  ];
  for (const [q, opts, want] of cases) {
    test(`${JSON.stringify(q)} ${JSON.stringify(opts)}`, () => {
      const rows = searchConstants(INDEX, q, filtersOf(opts), sortOf(opts));
      assert.deepEqual(rows.map((r) => r.name), want);
    });
  }

  test("does not reorder the index it searches", () => {
    searchConstants(INDEX, "", filtersOf({}), sortOf({ sort: "name:asc" }));
    assert.deepEqual(
      INDEX.constants.map((r) => r.def_id),
      ["k1", "k2", "k3", "k4"],
    );
  });
});

describe("search users", () => {
  const cases = [
    ["", {}, ["bob", "alice", "carol"]],
    ["", { sort: "created_at:asc" }, ["carol", "alice", "bob"]],
    ["", { sort: "name:asc" }, ["alice", "bob", "carol"]],
    ["", { sort: "name:desc" }, ["carol", "bob", "alice"]],
    ["AL", {}, ["alice"]],
  ];
  for (const [q, opts, want] of cases) {
    test(`${JSON.stringify(q)} ${JSON.stringify(opts)}`, () => {
      assert.deepEqual(searchUsers(INDEX, q, sortOf(opts)).map((r) => r.username), want);
    });
  }
});

describe("query type head", () => {
  test("lists the exact type head's declarations newest first", () => {
    const { schema, rows, known } = queryTypeHead(INDEX, "Axiom.Statement");
    assert.equal(known, true);
    assert.equal(schema?.def_id, "k1");
    assert.deepEqual(rows.map((r) => r.def_id), ["k2", "k1"]);
  });

  test("a prefix of a type head matches nothing and is unknown", () => {
    const { schema, rows, known } = queryTypeHead(INDEX, "Axiom.Stat");
    assert.equal(schema, null);
    assert.deepEqual(rows, []);
    assert.equal(known, false);
  });

  test("a known type head with no declarations is an empty result", () => {
    const { rows, known } = queryTypeHead(INDEX, "Axiom.Empty");
    assert.deepEqual(rows, []);
    assert.equal(known, true);
  });

  test("a type head with declarations but no schema row is known", () => {
    const { schema, rows, known } = queryTypeHead(INDEX, "Axiom.Other");
    assert.equal(schema, null);
    assert.deepEqual(rows.map((r) => r.def_id), ["k4"]);
    assert.equal(known, true);
  });
});

describe("paging and parsing", () => {
  test("pages like --limit/--offset", () => {
    const rows = searchConstants(INDEX, "", filtersOf({}), sortOf({ sort: "created_at:asc" }));
    const p = paginate(rows, 2, 1);
    assert.deepEqual(p.results.map((r) => r.name), ["Baz.gamma", "Bar.beta"]);
    assert.equal(p.total, 4);
    assert.equal(p.has_more, true);
    assert.deepEqual(paginate(rows, 3, 1).has_more, false);
    const past = paginate(rows, 20, 4);
    assert.deepEqual(past.results, []);
    assert.equal(past.total, 4);
    assert.equal(past.has_more, false);
  });

  test("sort and date values the CLI rejects are rejected", () => {
    for (const bad of ["created_at", "popularity:desc", "name:up", "name:asc:x"]) {
      assert.equal(parseSort(bad), null, bad);
    }
    for (const bad of ["", "yesterday", "2026/01/01", "2026-13-01"]) {
      assert.equal(parseDateBound(bad), null, bad);
    }
    assert.equal(parseDateBound("2026-03-05"), Date.UTC(2026, 2, 5));
    assert.equal(parseDateBound("2026-03-05T01:00:00+01:00"), Date.UTC(2026, 2, 5));
  });
});
