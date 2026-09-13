import { test } from "node:test";
import assert from "node:assert/strict";
import {
  distancePointToPoint,
  distancePointToSegment,
  pointInRing,
  distanceToPolygonGeometry,
  distanceToLineGeometry,
} from "../../src/drainageQuality/geometry.js";
import type { Point } from "../../src/drainageQuality/geometry.js";

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

test("distancePointToPoint: returns the correct Euclidean distance for a 3-4-5 triangle", () => {
  assert.equal(distancePointToPoint([0, 0], [3, 4]), 5);
});

test("distancePointToSegment: perpendicular distance when the point projects onto the segment's interior", () => {
  const distance = distancePointToSegment([5, 5], [0, 0], [10, 0]);
  assert.equal(distance, 5);
});

test("distancePointToSegment: distance to nearest endpoint when the point projects beyond either end", () => {
  const distance = distancePointToSegment([-3, 4], [0, 0], [10, 0]);
  assert.equal(distance, 5); // nearest endpoint is (0, 0)
});

test("pointInRing: a point clearly inside a simple square returns true, clearly outside returns false", () => {
  const ring = squareRing(0, 0, 10);
  assert.equal(pointInRing([5, 5], ring), true);
  assert.equal(pointInRing([50, 50], ring), false);
});

test("distanceToPolygonGeometry: a point inside a polygon's hole is treated as outside (holes respected)", () => {
  const exterior = squareRing(0, 0, 10);
  const hole = squareRing(3, 3, 4); // hole spans x/y 3..7, well inside the exterior
  const geometry = { type: "Polygon" as const, coordinates: [exterior, hole] };
  const result = distanceToPolygonGeometry([5, 5], geometry); // center of the hole
  assert.equal(result.inside, false);
});

test("distanceToPolygonGeometry: MultiPolygon — a point inside one part (not the other) is inside with zero distance", () => {
  const partA = [squareRing(0, 0, 10)];
  const partB = [squareRing(100, 100, 10)];
  const geometry = { type: "MultiPolygon" as const, coordinates: [partA, partB] };
  const result = distanceToPolygonGeometry([5, 5], geometry);
  assert.deepEqual(result, { inside: true, distanceMeters: 0 });
});

test("distanceToPolygonGeometry: a point outside every polygon returns the distance to the nearest exterior edge", () => {
  const geometry = { type: "Polygon" as const, coordinates: [squareRing(0, 0, 10)] };
  const result = distanceToPolygonGeometry([15, 5], geometry); // 5 units right of the right edge
  assert.equal(result.inside, false);
  assert.equal(result.distanceMeters, 5);
});

test("distanceToLineGeometry: MultiLineString returns the distance to the nearer of two parts", () => {
  const nearPart = [
    [0, 0],
    [10, 0],
  ] as Point[];
  const farPart = [
    [0, 100],
    [10, 100],
  ] as Point[];
  const geometry = { type: "MultiLineString" as const, coordinates: [nearPart, farPart] };
  const distance = distanceToLineGeometry([5, 5], geometry);
  assert.equal(distance, 5);
});
