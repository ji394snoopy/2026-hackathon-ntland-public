import { test } from "node:test";
import assert from "node:assert/strict";
import { toTwd97Tm2, fromTwd97Tm2 } from "../../src/drainageQuality/projection.js";

test("toTwd97Tm2/fromTwd97Tm2: round-trips a lon/lat within a tight tolerance", () => {
  const original = { lon: 121.4627, lat: 25.0111 };
  const [x, y] = toTwd97Tm2(original.lon, original.lat);
  const [lon, lat] = fromTwd97Tm2(x, y);
  assert.ok(Math.abs(lon - original.lon) < 1e-9);
  assert.ok(Math.abs(lat - original.lat) < 1e-9);
});

// Sanity bounds derived from real PUMP_DRAIN TM_X/TM_Y values for 新北市 features
// (e.g. 江子翠抽水站 at TM_X=298911.722, TM_Y=2768544.125) — not a hardcoded external
// reference, just a coarse "did this land in the right part of the plane" check.
test("toTwd97Tm2: a known New Taipei point projects into the expected numeric range", () => {
  const [x, y] = toTwd97Tm2(121.4627, 25.0111);
  assert.ok(x > 150000 && x < 350000, `x=${x} outside expected New Taipei range`);
  assert.ok(y > 2650000 && y < 2850000, `y=${y} outside expected New Taipei range`);
});
