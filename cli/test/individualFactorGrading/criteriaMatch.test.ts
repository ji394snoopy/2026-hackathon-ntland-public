import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveEvidenceToGrade,
  pickClosestGrade,
} from "../../src/individualFactorGrading/criteriaMatch.js";
import type {
  FactorStandardItem,
  RangeCriteria,
  EnumCriteria,
  BooleanCriteria,
  Evidence,
} from "../../src/individualFactorGrading/criteriaMatch.js";

function rangeCriteria(
  raw: string,
  min: number | null,
  max: number | null,
  unit: string,
): RangeCriteria {
  return { type: "range", raw, min, max, unit };
}

function enumCriteria(raw: string, value: string): EnumCriteria {
  return { type: "enum", raw, value };
}

function booleanCriteria(raw: string, present: boolean): BooleanCriteria {
  return { type: "boolean", raw, present };
}

function grade(
  key: string,
  raw: string,
  value: number,
  criteria: RangeCriteria | EnumCriteria | BooleanCriteria,
) {
  return { key, raw, value, criteria };
}

function item(
  key: string,
  raw: string,
  grades: ReturnType<typeof grade>[],
): FactorStandardItem {
  return { key, raw, grades };
}

/** Mirrors factor-standard.json's individualFactors.lotCondition.area: pure range, bigger is better. */
const AREA: FactorStandardItem = item("area", "面積", [
  grade("superior", "優", 0, rangeCriteria("93m2以上", 93, null, "m2")),
  grade("slightlySuperior", "稍優", -2, rangeCriteria("83m2以上未滿93m2", 83, 93, "m2")),
  grade("average", "普通", -4, rangeCriteria("73m2以上未滿83m2", 73, 83, "m2")),
  grade("slightlyInferior", "稍劣", -6, rangeCriteria("63m2以上未滿73m2", 63, 73, "m2")),
  grade("inferior", "劣", -8, rangeCriteria("未滿63m2", null, 63, "m2")),
]);

/** Mirrors factor-standard.json's individualFactors.administrativeCondition.zoningDesignation. */
const ZONING_DESIGNATION: FactorStandardItem = item(
  "zoningDesignation",
  "使用分區或編定",
  [
    grade("superior", "優", 0, enumCriteria("商業區", "commercialZone")),
    grade("slightlySuperior", "稍優", -3.75, enumCriteria("住宅區", "residentialZone")),
    grade("average", "普通", -7.5, enumCriteria("甲建、乙建", "classABLand")),
  ],
);

/** Mirrors factor-standard.json's individualFactors.proximityCondition.proximityToSchool: pure range, closer is better. */
const PROXIMITY_TO_SCHOOL: FactorStandardItem = item(
  "proximityToSchool",
  "接近學校程度",
  [
    grade("superior", "優", 0, rangeCriteria("未滿200m", null, 200, "m")),
    grade("slightlySuperior", "稍優", -1, rangeCriteria("200m以上未滿600m", 200, 600, "m")),
    grade("average", "普通", -2, rangeCriteria("600m以上未滿1200m", 600, 1200, "m")),
    grade("slightlyInferior", "稍劣", -3, rangeCriteria("1200m以上未滿2000m", 1200, 2000, "m")),
    grade("inferior", "劣", -4, rangeCriteria("2000m以上或無", 2000, null, "m")),
  ],
);

/** Mirrors factor-standard.json's individualFactors.surroundingEnvironment.presenceOfNoxiousFacility: pure range, farther is better (hazard). */
const PRESENCE_OF_NOXIOUS_FACILITY: FactorStandardItem = item(
  "presenceOfNoxiousFacility",
  "嫌惡設施之有無",
  [
    grade("superior", "優", 0, rangeCriteria("500m以上或無", 500, null, "m")),
    grade("slightlySuperior", "稍優", -1.5, rangeCriteria("300m以上未滿500m", 300, 500, "m")),
    grade("average", "普通", -3, rangeCriteria("200m以上未滿300m", 200, 300, "m")),
    grade("slightlyInferior", "稍劣", -4.5, rangeCriteria("100m以上未滿200m", 100, 200, "m")),
    grade("inferior", "劣", -6, rangeCriteria("未滿100m", null, 100, "m")),
  ],
);

/**
 * Synthetic boolean-criteria fixture — individualFactors' real grading table has no
 * boolean-typed items at all (unlike regionalFactors' buildingProhibition/
 * buildingRestriction): its own buildingProhibitionOrRestriction item is enum-typed
 * (noBuildingRestriction/buildingProhibitedOrRestricted), since "無" there means "no
 * restriction exists" rather than a bare present/absent flag. This fixture only
 * exercises criteriaMatch.ts's generic boolean-handling code path, which the tool
 * schema still allows evidence to report even though this tree never triggers it.
 */
const BUILDING_PROHIBITION: FactorStandardItem = item(
  "buildingProhibition",
  "有無禁止建築",
  [
    grade("superior", "優", 0, booleanCriteria("無", false)),
    grade("inferior", "劣", -40, booleanCriteria("有", true)),
  ],
);

test("resolveEvidenceToGrade: range evidence matches the [min, max) bucket containing the value", () => {
  const evidence: Evidence = { type: "range", raw: "78m2", value: 78, unit: "m2" };
  const result = resolveEvidenceToGrade(AREA, evidence);
  assert.equal(result?.key, "average");
});

test("resolveEvidenceToGrade: range evidence matches open-ended buckets at the extremes", () => {
  const low = resolveEvidenceToGrade(AREA, { type: "range", raw: "50m2", value: 50, unit: "m2" });
  assert.equal(low?.key, "inferior");

  const high = resolveEvidenceToGrade(AREA, { type: "range", raw: "150m2", value: 150, unit: "m2" });
  assert.equal(high?.key, "superior");
});

test("resolveEvidenceToGrade: enum evidence matches the grade whose criteria.value equals enumValue", () => {
  const result = resolveEvidenceToGrade(ZONING_DESIGNATION, {
    type: "enum",
    raw: "第二種商業區",
    enumValue: "commercialZone",
  });
  assert.equal(result?.key, "superior");
});

test("resolveEvidenceToGrade: enum evidence with an unrecognized enumValue returns null", () => {
  const result = resolveEvidenceToGrade(ZONING_DESIGNATION, {
    type: "enum",
    raw: "不明",
    enumValue: "doesNotExist",
  });
  assert.equal(result, null);
});

test("resolveEvidenceToGrade: boolean evidence matches the grade whose criteria.present equals present", () => {
  const absent = resolveEvidenceToGrade(BUILDING_PROHIBITION, {
    type: "boolean",
    raw: "無",
    present: false,
  });
  assert.equal(absent?.key, "superior");

  const present = resolveEvidenceToGrade(BUILDING_PROHIBITION, {
    type: "boolean",
    raw: "有",
    present: true,
  });
  assert.equal(present?.key, "inferior");
});

test("resolveEvidenceToGrade: absent (present:false) evidence on a range-typed hazard item resolves via the open-ended (superior) bucket", () => {
  const result = resolveEvidenceToGrade(PRESENCE_OF_NOXIOUS_FACILITY, {
    type: "boolean",
    raw: "無",
    present: false,
  });
  assert.equal(result?.key, "superior");
});

test("pickClosestGrade: the evidence with the smallest effective distance wins", () => {
  const result = pickClosestGrade(PROXIMITY_TO_SCHOOL, [
    { type: "range", raw: "距1500M", value: 1500, unit: "m" },
    { type: "range", raw: "距150M", value: 150, unit: "m" },
  ]);
  assert.equal(result?.key, "superior");
});

test("pickClosestGrade: an in-section enum fact (distance 0) beats a farther range fact for the same item", () => {
  const result = pickClosestGrade(ZONING_DESIGNATION, [
    { type: "enum", raw: "商業區", enumValue: "commercialZone" },
  ]);
  assert.equal(result?.key, "superior");
});

test("pickClosestGrade: every contributing fact absent resolves to the open-ended (superior) bucket", () => {
  const result = pickClosestGrade(PRESENCE_OF_NOXIOUS_FACILITY, [
    { type: "boolean", raw: "無", present: false },
    { type: "boolean", raw: "無", present: false },
  ]);
  assert.equal(result?.key, "superior");
});
