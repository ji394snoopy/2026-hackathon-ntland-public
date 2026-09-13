import { test } from "node:test";
import assert from "node:assert/strict";
import { meanWindSpeed, circularMeanDirectionDeg, compassBucket } from "../../src/windCondition/windStats.js";

test("meanWindSpeed: averages a plain numeric array correctly", () => {
  assert.equal(meanWindSpeed([10, 20, 30]), 20);
});

test("meanWindSpeed: skips null entries when averaging", () => {
  assert.equal(meanWindSpeed([10, null, 30]), 20);
});

test("meanWindSpeed: throws when every entry is null", () => {
  assert.throws(() => meanWindSpeed([null, null]));
});

test("circularMeanDirectionDeg: mean of [350, 10] is ~0, not 180", () => {
  const mean = circularMeanDirectionDeg([350, 10]);
  assert.ok(mean < 1 || mean > 359, `expected ~0, got ${mean}`);
});

test("circularMeanDirectionDeg: skips null entries", () => {
  const mean = circularMeanDirectionDeg([90, null, 90]);
  assert.ok(Math.abs(mean - 90) < 0.001, `expected ~90, got ${mean}`);
});

test("compassBucket: maps cardinal/intercardinal degrees to the right bucket", () => {
  assert.equal(compassBucket(0).key, "N");
  assert.equal(compassBucket(45).key, "NE");
  assert.equal(compassBucket(90).key, "E");
  assert.equal(compassBucket(315).key, "NW");
  assert.equal(compassBucket(359).key, "N");
});
