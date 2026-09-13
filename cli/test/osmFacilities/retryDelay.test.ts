import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBackoffDelayMs, BASE_DELAY_MS } from "../../src/osmFacilities/retryDelay.js";

test("computeBackoffDelayMs: doubles the base delay each attempt", () => {
  assert.equal(computeBackoffDelayMs(0), BASE_DELAY_MS);
  assert.equal(computeBackoffDelayMs(1), BASE_DELAY_MS * 2);
  assert.equal(computeBackoffDelayMs(2), BASE_DELAY_MS * 4);
});
