import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCoordinates } from "../../src/windCondition/main.js";

test("parseCoordinates: parses valid numeric lon/lat strings", () => {
  assert.deepEqual(parseCoordinates("121.4627", "25.0111"), { lon: 121.4627, lat: 25.0111 });
});

test("parseCoordinates: throws when args are missing", () => {
  assert.throws(() => parseCoordinates(undefined, undefined));
  assert.throws(() => parseCoordinates("121.4627", undefined));
});

test("parseCoordinates: throws when args are non-numeric", () => {
  assert.throws(() => parseCoordinates("not-a-number", "25.0111"));
});
