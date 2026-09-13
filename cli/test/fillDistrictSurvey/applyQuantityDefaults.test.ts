import { test } from "node:test";
import assert from "node:assert/strict";
import { applyQuantityDefaults } from "../../src/fillDistrictSurvey/applyQuantityDefaults.js";

test("applyQuantityDefaults: defaults quantity to 1 when isExist is true and quantity is missing", () => {
  const commercialActivity = {
    financialInstitution: { value: { name: "新北市金山地區農會", isExist: true, inSection: false, distanceValue: 210 } },
  };
  const result = applyQuantityDefaults(commercialActivity);
  assert.equal(result.financialInstitution.value.quantity, 1);
});

test("applyQuantityDefaults: leaves an explicit quantity untouched", () => {
  const commercialActivity = {
    departmentStore: { value: { name: "遠東百貨", isExist: true, quantity: 2 } },
  };
  const result = applyQuantityDefaults(commercialActivity);
  assert.equal(result.departmentStore.value.quantity, 2);
});

test("applyQuantityDefaults: does not add quantity when isExist is false", () => {
  const commercialActivity = {
    entertainmentFacility: { value: { name: "", isExist: false } },
  };
  const result = applyQuantityDefaults(commercialActivity);
  assert.equal(result.entertainmentFacility.value.quantity, undefined);
});

test("applyQuantityDefaults: only touches the four facility-with-count fields", () => {
  const commercialActivity = {
    customerTraffic: { value: { text: "顧客通行量多" } },
  };
  const result = applyQuantityDefaults(commercialActivity);
  assert.deepEqual(result.customerTraffic, { value: { text: "顧客通行量多" } });
});
