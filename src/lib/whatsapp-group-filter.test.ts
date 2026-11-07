import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterGroups } from "./whatsapp-group-filter";

const groups = [{ jid: "1@g.us", name: "Zeta Clientes" }, { jid: "2@g.us", name: "alfa marketing" }, { jid: "3@g.us", name: "Beta" }];
const byGroup = { "1@g.us": ["t1"], "2@g.us": ["t1", "t2"] };
const base = { q: "", tag: null, onlySelected: false, selected: new Set<string>(), byGroup };

describe("filterGroups", () => {
  it("orders alphabetically and searches by name", () => {
    assert.deepEqual(filterGroups(groups, base).map(g => g.jid), ["2@g.us", "3@g.us", "1@g.us"]);
    assert.deepEqual(filterGroups(groups, { ...base, q: "CLIENTES" }).map(g => g.jid), ["1@g.us"]);
  });
  it("filters by tag, untagged and selected only", () => {
    assert.deepEqual(filterGroups(groups, { ...base, tag: "t2" }).map(g => g.jid), ["2@g.us"]);
    assert.deepEqual(filterGroups(groups, { ...base, tag: "" }).map(g => g.jid), ["3@g.us"]);
    assert.deepEqual(filterGroups(groups, { ...base, onlySelected: true, selected: new Set(["1@g.us"]) }).map(g => g.jid), ["1@g.us"]);
  });
});
