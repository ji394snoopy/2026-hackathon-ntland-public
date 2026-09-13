import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMergedCoordinates } from "../../src/districtSurvey/generateCoordinates.js";

const ALL_CATEGORY_RESULTS = {
  landImprovement: { a: 1 },
  specialFacilities: { b: 2 },
  commercialActivity: { c: 3 },
  landUseRegulation: { d: 4 },
  trafficAndTransport: { e: 5 },
  publicInfrastructure: { f: 6 },
  environmentalPollution: { g: 7 },
  naturalConditions: { h: 8 },
};

test("buildMergedCoordinates: merges all 8 category results into one object, unchanged", () => {
  const merged = buildMergedCoordinates(ALL_CATEGORY_RESULTS);
  assert.deepEqual(Object.keys(merged), [
    "landImprovement",
    "specialFacilities",
    "commercialActivity",
    "landUseRegulation",
    "trafficAndTransport",
    "publicInfrastructure",
    "environmentalPollution",
    "naturalConditions",
  ]);
  assert.deepEqual(merged, ALL_CATEGORY_RESULTS);
});

test("buildMergedCoordinates: throws naming the missing category when one is absent", () => {
  const { naturalConditions, ...rest } = ALL_CATEGORY_RESULTS;
  assert.throws(
    () => buildMergedCoordinates(rest as typeof ALL_CATEGORY_RESULTS),
    /naturalConditions/,
  );
});

test("buildMergedCoordinates: throws listing all 8 categories when given an empty object", () => {
  assert.throws(() => buildMergedCoordinates({} as typeof ALL_CATEGORY_RESULTS), (err: Error) => {
    assert.match(err.message, /landImprovement/);
    assert.match(err.message, /naturalConditions/);
    return true;
  });
});
