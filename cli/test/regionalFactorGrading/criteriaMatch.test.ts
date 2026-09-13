import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveEvidenceToGrade,
  pickClosestGrade,
} from "../../src/regionalFactorGrading/criteriaMatch.js";
import type {
  FactorStandardItem,
  RangeCriteria,
  EnumCriteria,
  BooleanCriteria,
  Evidence,
} from "../../src/regionalFactorGrading/criteriaMatch.js";

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

/** Mirrors factor-standard.json's mainRoadWidth: pure range, closer is better. */
const MAIN_ROAD_WIDTH: FactorStandardItem = item("mainRoadWidth", "主要道路寬度", [
  grade("superior", "優", 0, rangeCriteria("30m以上", 30, null, "m")),
  grade(
    "slightlySuperior",
    "稍優",
    -3.75,
    rangeCriteria("20m以上未滿30m", 20, 30, "m"),
  ),
  grade("average", "普通", -7.5, rangeCriteria("15m以上未滿20m", 15, 20, "m")),
  grade(
    "slightlyInferior",
    "稍劣",
    -11.25,
    rangeCriteria("10m以上未滿15m", 10, 15, "m"),
  ),
  grade("inferior", "劣", -15, rangeCriteria("未滿10m或無", null, 10, "m")),
]);

/** Mirrors factor-standard.json's proximityToMarket: mixed enum+range, closer is better. */
const PROXIMITY_TO_MARKET: FactorStandardItem = item(
  "proximityToMarket",
  "接近市場之程度",
  [
    grade("superior", "優", 0, enumCriteria("區段內有", "presentInSection")),
    grade(
      "slightlySuperior",
      "稍優",
      -1.5,
      rangeCriteria("未滿500m", null, 500, "m"),
    ),
    grade(
      "average",
      "普通",
      -3,
      rangeCriteria("500m以上未滿1,000m", 500, 1000, "m"),
    ),
    grade(
      "slightlyInferior",
      "稍劣",
      -4.5,
      rangeCriteria("1,000m以上未滿1,800m", 1000, 1800, "m"),
    ),
    grade(
      "inferior",
      "劣",
      -6,
      rangeCriteria("1,800m以上或無", 1800, null, "m"),
    ),
  ],
);

/** Mirrors factor-standard.json's proximityToUtilityGasFacility: pure range, farther is better (hazard). */
const PROXIMITY_TO_GAS_FACILITY: FactorStandardItem = item(
  "proximityToUtilityGasFacility",
  "電業設施及公用氣體燃料設施之有無及接近程度",
  [
    grade("superior", "優", 0, rangeCriteria("3,000m以上", 3000, null, "m")),
    grade(
      "slightlySuperior",
      "稍優",
      -2,
      rangeCriteria("2,000m以上未滿3,000m", 2000, 3000, "m"),
    ),
    grade(
      "average",
      "普通",
      -4,
      rangeCriteria("1,000m以上未滿2,000m", 1000, 2000, "m"),
    ),
    grade(
      "slightlyInferior",
      "稍劣",
      -6,
      rangeCriteria("500m以上未滿1,000m", 500, 1000, "m"),
    ),
    grade("inferior", "劣", -8, rangeCriteria("未滿500m", null, 500, "m")),
  ],
);

/** Mirrors factor-standard.json's buildingProhibition: pure boolean, no aggregation. */
const BUILDING_PROHIBITION: FactorStandardItem = item(
  "buildingProhibition",
  "有無禁止建築",
  [
    grade("superior", "優", 0, booleanCriteria("無", false)),
    grade("inferior", "劣", -40, booleanCriteria("有", true)),
  ],
);

test("resolveEvidenceToGrade: range evidence matches the [min, max) bucket containing the value", () => {
  const evidence: Evidence = { type: "range", raw: "18M", value: 18, unit: "m" };
  const result = resolveEvidenceToGrade(MAIN_ROAD_WIDTH, evidence);
  assert.equal(result?.key, "average");
});

test("resolveEvidenceToGrade: range evidence matches open-ended buckets at the extremes", () => {
  const low = resolveEvidenceToGrade(MAIN_ROAD_WIDTH, {
    type: "range",
    raw: "5M",
    value: 5,
    unit: "m",
  });
  assert.equal(low?.key, "inferior");

  const high = resolveEvidenceToGrade(MAIN_ROAD_WIDTH, {
    type: "range",
    raw: "35M",
    value: 35,
    unit: "m",
  });
  assert.equal(high?.key, "superior");
});

test("resolveEvidenceToGrade: enum evidence matches the grade whose criteria.value equals enumValue", () => {
  const result = resolveEvidenceToGrade(PROXIMITY_TO_MARKET, {
    type: "enum",
    raw: "本區段內",
    enumValue: "presentInSection",
  });
  assert.equal(result?.key, "superior");
});

test("resolveEvidenceToGrade: enum evidence with an unrecognized enumValue returns null", () => {
  const result = resolveEvidenceToGrade(PROXIMITY_TO_MARKET, {
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
  const result = resolveEvidenceToGrade(PROXIMITY_TO_GAS_FACILITY, {
    type: "boolean",
    raw: "無",
    present: false,
  });
  assert.equal(result?.key, "superior");
});

test("pickClosestGrade: the evidence with the smallest effective distance wins", () => {
  const result = pickClosestGrade(PROXIMITY_TO_GAS_FACILITY, [
    { type: "range", raw: "距700M", value: 700, unit: "m" },
    { type: "range", raw: "距440M", value: 440, unit: "m" },
  ]);
  assert.equal(result?.key, "inferior");
});

test("pickClosestGrade: an in-section enum fact (distance 0) beats a farther range fact for the same item", () => {
  const result = pickClosestGrade(PROXIMITY_TO_MARKET, [
    { type: "range", raw: "距800M", value: 800, unit: "m" },
    { type: "enum", raw: "本區段內", enumValue: "presentInSection" },
  ]);
  assert.equal(result?.key, "superior");
});

test("pickClosestGrade: every contributing fact absent resolves to the open-ended (superior) bucket", () => {
  const result = pickClosestGrade(PROXIMITY_TO_GAS_FACILITY, [
    { type: "boolean", raw: "無", present: false },
    { type: "boolean", raw: "無", present: false },
  ]);
  assert.equal(result?.key, "superior");
});
