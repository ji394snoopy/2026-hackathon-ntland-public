import { test } from "node:test";
import assert from "node:assert/strict";
import { haversineDistanceMeters, EARTH_RADIUS_METERS } from "../../src/osmFacilities/haversine.js";

test("haversineDistanceMeters: distance from a point to itself is 0", () => {
  assert.equal(haversineDistanceMeters(25.221, 121.636, 25.221, 121.636), 0);
});

test("haversineDistanceMeters: pole to equator is a quarter of Earth's circumference", () => {
  const expected = (Math.PI / 2) * EARTH_RADIUS_METERS;
  const actual = haversineDistanceMeters(90, 0, 0, 0);
  assert.ok(Math.abs(actual - expected) < 1, `expected ~${expected}, got ${actual}`);
});

test("haversineDistanceMeters: antipodal points along the equator are half Earth's circumference apart", () => {
  const expected = Math.PI * EARTH_RADIUS_METERS;
  const actual = haversineDistanceMeters(0, 0, 0, 180);
  assert.ok(Math.abs(actual - expected) < 1, `expected ~${expected}, got ${actual}`);
});
