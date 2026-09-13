import { test } from "node:test";
import assert from "node:assert/strict";
import { pointInRing, polygonContainsPoint } from "../../src/soilQuality/geometry.js";
import type { Point } from "../../src/soilQuality/geometry.js";

// A 10x10 square ring, corners at the origin — used across the polygon tests below.
function squareRing(originX: number, originY: number, size: number): Point[] {
  return [
    [originX, originY],
    [originX + size, originY],
    [originX + size, originY + size],
    [originX, originY + size],
    [originX, originY],
  ];
}

test("pointInRing: a point clearly inside a simple square returns true, clearly outside returns false", () => {
  const ring = squareRing(0, 0, 10);
  assert.equal(pointInRing([5, 5], ring), true);
  assert.equal(pointInRing([50, 50], ring), false);
});

test("polygonContainsPoint: a point inside a polygon's hole is treated as outside (holes respected)", () => {
  const exterior = squareRing(0, 0, 10);
  const hole = squareRing(3, 3, 4); // hole spans x/y 3..7, well inside the exterior
  const geometry = { type: "Polygon" as const, coordinates: [exterior, hole] };
  assert.equal(polygonContainsPoint([5, 5], geometry), false); // center of the hole
});

test("polygonContainsPoint: MultiPolygon — a point inside one part (not the other) returns true", () => {
  const partA = [squareRing(0, 0, 10)];
  const partB = [squareRing(100, 100, 10)];
  const geometry = { type: "MultiPolygon" as const, coordinates: [partA, partB] };
  assert.equal(polygonContainsPoint([5, 5], geometry), true);
});

test("polygonContainsPoint: a point outside every part returns false", () => {
  const geometry = { type: "Polygon" as const, coordinates: [squareRing(0, 0, 10)] };
  assert.equal(polygonContainsPoint([50, 50], geometry), false);
});
