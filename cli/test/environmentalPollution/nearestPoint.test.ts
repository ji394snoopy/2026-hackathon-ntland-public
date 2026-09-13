import { test } from "node:test";
import assert from "node:assert/strict";
import { findNearestPoint } from "../../src/environmentalPollution/nearestPoint.js";

interface Station {
  name: string;
}

test("findNearestPoint: returns the closer of two candidates", () => {
  const candidates = [
    { lon: 121.7, lat: 25.2, record: { name: "far" } },
    { lon: 121.61, lat: 25.2, record: { name: "near" } },
  ];
  const result = findNearestPoint<Station>(candidates, 121.6, 25.2);
  assert.equal(result?.record.name, "near");
});

test("findNearestPoint: reports the distance in meters, rounded", () => {
  // 0.01 deg longitude at lat=0 is ~1113.2m
  const candidates = [{ lon: 0.01, lat: 0, record: { name: "x" } }];
  const result = findNearestPoint<Station>(candidates, 0, 0);
  assert.ok(result);
  assert.ok(Math.abs(result!.metersToCenter - 1113) < 5, `expected ~1113m, got ${result!.metersToCenter}`);
});

test("findNearestPoint: returns null for an empty candidate list", () => {
  assert.equal(findNearestPoint<Station>([], 121.6, 25.2), null);
});
