import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTagList } from "../../src/osmFacilities/parseTags.js";

test("parseTagList: parses a single key=value tag", () => {
  assert.deepEqual(parseTagList("shop=department_store"), [{ key: "shop", value: "department_store" }]);
});

test("parseTagList: parses a comma-separated multi-tag list", () => {
  assert.deepEqual(parseTagList("amenity=bank,shop=department_store"), [
    { key: "amenity", value: "bank" },
    { key: "shop", value: "department_store" },
  ]);
});

test("parseTagList: throws on an entry missing '='", () => {
  assert.throws(() => parseTagList("amenity=bank,notatag"));
});
