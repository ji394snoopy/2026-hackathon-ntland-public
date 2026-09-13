import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOverpassQuery } from "../../src/osmFacilities/buildOverpassQuery.js";

test("buildOverpassQuery: builds the expected Overpass QL for a tag/lat/lon/radius", () => {
  const query = buildOverpassQuery({ key: "shop", value: "department_store" }, 25.221, 121.636, 500);
  assert.equal(
    query,
    '[out:json][timeout:25];\nnwr["shop"="department_store"](around:500,25.221,121.636);\nout center;',
  );
});
