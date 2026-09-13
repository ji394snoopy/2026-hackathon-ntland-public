import { test } from "node:test";
import assert from "node:assert/strict";
import { roundDistanceValues } from "../../src/fillDistrictSurvey/roundDistanceValues.js";

test("roundDistanceValues: rounds a float distanceValue with precision artifacts to the nearest integer", () => {
  const content = {
    commercialActivity: {
      departmentStore: { value: { name: "金山百貨廣場", isExist: true, distanceValue: 600.0000000000001 } },
    },
  };
  const result = roundDistanceValues(content);
  assert.equal(result.commercialActivity.departmentStore.value.distanceValue, 600);
});

test("roundDistanceValues: leaves an already-integer distanceValue unchanged", () => {
  const content = {
    commercialActivity: {
      financialInstitution: { value: { name: "新北市金山地區農會", isExist: true, distanceValue: 210 } },
    },
  };
  const result = roundDistanceValues(content);
  assert.equal(result.commercialActivity.financialInstitution.value.distanceValue, 210);
});

test("roundDistanceValues: finds and rounds distanceValue nested inside arrays", () => {
  const content = {
    environmentalPollution: {
      items: [
        { value: { name: "鄰近工廠廢氣排放", isExist: true, distanceValue: 200.0000000000001 } },
        { value: { name: "鄰近資源回收場", isExist: true, distanceValue: 150 } },
      ],
    },
  };
  const result = roundDistanceValues(content);
  assert.equal(result.environmentalPollution.items[0]!.value.distanceValue, 200);
  assert.equal(result.environmentalPollution.items[1]!.value.distanceValue, 150);
});

test("roundDistanceValues: rounds every occurrence across different branches of the tree", () => {
  const content = {
    commercialActivity: {
      departmentStore: { value: { distanceValue: 600.0000000000001 } },
    },
    environmentalPollution: {
      items: [{ value: { distanceValue: 300.0000000000001 } }],
    },
  };
  const result = roundDistanceValues(content);
  assert.equal(result.commercialActivity.departmentStore.value.distanceValue, 600);
  assert.equal(result.environmentalPollution.items[0]!.value.distanceValue, 300);
});

test("roundDistanceValues: leaves a tree with no distanceValue field unchanged", () => {
  const content = {
    commercialActivity: {
      customerTraffic: { value: { text: "顧客通行量多" } },
    },
  };
  const result = roundDistanceValues(content);
  assert.deepEqual(result, content);
});

test("roundDistanceValues: ignores a distanceValue key whose value isn't a number", () => {
  const content = {
    commercialActivity: {
      departmentStore: { value: { name: "遠東百貨", isExist: false, distanceValue: undefined } },
    },
  };
  const result = roundDistanceValues(content);
  assert.equal(result.commercialActivity.departmentStore.value.distanceValue, undefined);
});
