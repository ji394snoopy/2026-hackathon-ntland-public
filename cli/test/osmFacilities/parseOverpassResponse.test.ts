import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOverpassResponse } from "../../src/osmFacilities/parseOverpassResponse.js";

test("parseOverpassResponse: extracts a node element's direct lat/lon", () => {
  const response = {
    elements: [{ type: "node", id: 1, lat: 25.221, lon: 121.636, tags: { name: "金山地區農會" } }],
  };
  assert.deepEqual(parseOverpassResponse(response, "amenity=bank"), [
    { tag: "amenity=bank", name: "金山地區農會", lat: 25.221, lon: 121.636 },
  ]);
});

test("parseOverpassResponse: extracts a way/relation element's center.lat/lon", () => {
  const response = {
    elements: [
      { type: "way", id: 2, center: { lat: 25.222, lon: 121.637 }, tags: { name: "Some Store" } },
      { type: "relation", id: 3, center: { lat: 25.223, lon: 121.638 }, tags: {} },
    ],
  };
  const result = parseOverpassResponse(response, "shop=department_store");
  assert.deepEqual(result, [
    { tag: "shop=department_store", name: "Some Store", lat: 25.222, lon: 121.637 },
    { tag: "shop=department_store", name: null, lat: 25.223, lon: 121.638 },
  ]);
});

test("parseOverpassResponse: missing name tag becomes null, not omitted", () => {
  const response = { elements: [{ type: "node", id: 4, lat: 25.221, lon: 121.636, tags: {} }] };
  const result = parseOverpassResponse(response, "amenity=bank");
  assert.equal(result[0]!.name, null);
  assert.ok("name" in result[0]!);
});

test("parseOverpassResponse: skips an element with no usable coordinates instead of throwing", () => {
  const response = {
    elements: [
      { type: "way", id: 5, tags: { name: "No center" } },
      { type: "node", id: 6, lat: 25.221, lon: 121.636, tags: { name: "Has coords" } },
    ],
  };
  const result = parseOverpassResponse(response, "amenity=bank");
  assert.equal(result.length, 1);
  assert.equal(result[0]!.name, "Has coords");
});

test("parseOverpassResponse: throws when the response has no elements array at all", () => {
  assert.throws(() => parseOverpassResponse({}, "amenity=bank"));
  assert.throws(() => parseOverpassResponse({ elements: "not-an-array" }, "amenity=bank"));
});
