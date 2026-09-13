import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPipeline } from "../../src/regionalFactorGrading/pipeline.js";

const SAMPLE_DATA_PATH = "./src/regionalFactorGrading/input/sample-data.json";

test("buildPipeline: returns meta deep-equal to sample-data.json's meta object", () => {
  const fixture = JSON.parse(readFileSync(SAMPLE_DATA_PATH, "utf-8"));
  const { meta } = buildPipeline(SAMPLE_DATA_PATH);
  assert.deepEqual(meta, fixture.meta);
});

test("buildPipeline: returns benchmark deep-equal to sample-data.json's benchmark object", () => {
  const fixture = JSON.parse(readFileSync(SAMPLE_DATA_PATH, "utf-8"));
  const { benchmark } = buildPipeline(SAMPLE_DATA_PATH);
  assert.deepEqual(benchmark, fixture.benchmark);
});
