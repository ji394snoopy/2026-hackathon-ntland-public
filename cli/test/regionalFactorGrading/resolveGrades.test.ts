import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveGrades } from "../../src/regionalFactorGrading/resolveGrades.js";
import type {
  RegionalFactorsTree,
  RangeCriteria,
  EnumCriteria,
} from "../../src/regionalFactorGrading/resolveGrades.js";

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

function grade(
  key: string,
  raw: string,
  value: number,
  criteria: RangeCriteria | EnumCriteria,
) {
  return { key, raw, value, criteria };
}

function item(key: string, raw: string, grades: ReturnType<typeof grade>[]) {
  return { key, raw, grades };
}

function category(key: string, raw: string, items: ReturnType<typeof item>[]) {
  return { key, raw, items };
}

/** A trimmed slice of references/factor-standard.json's regionalFactors tree. */
const SAMPLE_TREE: RegionalFactorsTree = {
  raw: "區域因素",
  categories: [
    category("landUseRegulation", "土地使用管制", [
      item("insideOutsideUrbanPlan", "都市計畫內外", [
        grade("superior", "優", 0, enumCriteria("都市計畫內", "insideUrbanPlan")),
        grade("inferior", "劣", -20, enumCriteria("都市計畫外", "outsideUrbanPlan")),
      ]),
    ]),
    category("trafficAndTransport", "交通運輸", [
      item("mainRoadWidth", "主要道路寬度", [
        grade("superior", "優", 0, rangeCriteria("30m以上", 30, null, "m")),
        grade("average", "普通", -7.5, rangeCriteria("15m以上未滿20m", 15, 20, "m")),
        grade("inferior", "劣", -15, rangeCriteria("未滿10m", null, 10, "m")),
      ]),
    ]),
    category("specialFacilities", "特殊設施", [
      item("proximityToUtilityGasFacility", "電業設施及公用氣體燃料設施之有無及接近程度", [
        grade("superior", "優", 0, rangeCriteria("3,000m以上", 3000, null, "m")),
        grade("inferior", "劣", -8, rangeCriteria("未滿500m", null, 500, "m")),
      ]),
    ]),
  ],
};

test("resolveGrades: happy path resolves raw/value and sums totalScore", () => {
  const result = resolveGrades(SAMPLE_TREE, [
    {
      categoryKey: "landUseRegulation",
      itemKey: "insideOutsideUrbanPlan",
      evidence: { type: "enum", raw: "都市計畫內", enumValue: "insideUrbanPlan" },
    },
    {
      categoryKey: "trafficAndTransport",
      itemKey: "mainRoadWidth",
      evidence: { type: "range", raw: "18M", value: 18, unit: "m" },
    },
  ]);

  assert.equal(result.totalScore, -7.5);
  assert.equal(result.regionalFactors.categories.length, 2);
  assert.deepEqual(result.regionalFactors.categories[0], {
    key: "landUseRegulation",
    raw: "土地使用管制",
    items: [
      {
        key: "insideOutsideUrbanPlan",
        raw: "都市計畫內外",
        selectedGrade: { key: "superior", raw: "優", value: 0, rate: 1 },
      },
    ],
  });
  assert.deepEqual(result.regionalFactors.categories[1], {
    key: "trafficAndTransport",
    raw: "交通運輸",
    items: [
      {
        key: "mainRoadWidth",
        raw: "主要道路寬度",
        selectedGrade: { key: "average", raw: "普通", value: -7.5, rate: 2 },
      },
    ],
  });
});

test("resolveGrades: rate reflects 1-based position among more than two grades", () => {
  const FIVE_GRADE_TREE: RegionalFactorsTree = {
    raw: "區域因素",
    categories: [
      category("commercialActivity", "工商活動", [
        item("customerTrafficVolume", "顧客通行量之多寡", [
          grade("superior", "優", 0, enumCriteria("顧客通行量多", "highCustomerTraffic")),
          grade(
            "slightlySuperior",
            "稍優",
            -3,
            enumCriteria("顧客通行量稍多", "slightlyHighCustomerTraffic"),
          ),
          grade(
            "average",
            "普通",
            -6,
            enumCriteria("顧客通行量普通", "averageCustomerTraffic"),
          ),
          grade(
            "slightlyInferior",
            "稍劣",
            -9,
            enumCriteria("顧客通行量較少", "relativelyLowCustomerTraffic"),
          ),
          grade("inferior", "劣", -12, enumCriteria("顧客通行量少", "lowCustomerTraffic")),
        ]),
      ]),
    ],
  };

  const result = resolveGrades(FIVE_GRADE_TREE, [
    {
      categoryKey: "commercialActivity",
      itemKey: "customerTrafficVolume",
      evidence: {
        type: "enum",
        raw: "顧客通行量普通",
        enumValue: "averageCustomerTraffic",
      },
    },
  ]);

  assert.deepEqual(result.regionalFactors.categories, [
    {
      key: "commercialActivity",
      raw: "工商活動",
      items: [
        {
          key: "customerTrafficVolume",
          raw: "顧客通行量之多寡",
          selectedGrade: { key: "average", raw: "普通", value: -6, rate: 3 },
        },
      ],
    },
  ]);
});

test("resolveGrades: unknown categoryKey is skipped", () => {
  const result = resolveGrades(SAMPLE_TREE, [
    {
      categoryKey: "doesNotExist",
      itemKey: "x",
      evidence: { type: "enum", raw: "x", enumValue: "insideUrbanPlan" },
    },
  ]);
  assert.equal(result.totalScore, 0);
  assert.deepEqual(result.regionalFactors.categories, []);
});

test("resolveGrades: unknown itemKey within a valid category is skipped", () => {
  const result = resolveGrades(SAMPLE_TREE, [
    {
      categoryKey: "landUseRegulation",
      itemKey: "doesNotExist",
      evidence: { type: "enum", raw: "x", enumValue: "insideUrbanPlan" },
    },
  ]);
  assert.equal(result.totalScore, 0);
  assert.deepEqual(result.regionalFactors.categories, []);
});

test("resolveGrades: evidence that matches no grade in the item is skipped", () => {
  const result = resolveGrades(SAMPLE_TREE, [
    {
      categoryKey: "landUseRegulation",
      itemKey: "insideOutsideUrbanPlan",
      evidence: { type: "enum", raw: "不明", enumValue: "doesNotExist" },
    },
  ]);
  assert.equal(result.totalScore, 0);
  assert.deepEqual(result.regionalFactors.categories, []);
});

test("resolveGrades: empty extractions produce empty categories and zero total", () => {
  const result = resolveGrades(SAMPLE_TREE, []);
  assert.deepEqual(result, {
    regionalFactors: { raw: "區域因素", categories: [] },
    totalScore: 0,
  });
});

test("resolveGrades: output category order follows the tree's order, not extraction order", () => {
  const result = resolveGrades(SAMPLE_TREE, [
    {
      categoryKey: "trafficAndTransport",
      itemKey: "mainRoadWidth",
      evidence: { type: "range", raw: "5M", value: 5, unit: "m" },
    },
    {
      categoryKey: "landUseRegulation",
      itemKey: "insideOutsideUrbanPlan",
      evidence: { type: "enum", raw: "都市計畫外", enumValue: "outsideUrbanPlan" },
    },
  ]);
  assert.deepEqual(
    result.regionalFactors.categories.map((c) => c.key),
    ["landUseRegulation", "trafficAndTransport"],
  );
});

test("resolveGrades: two extractions for the same item resolve to the closest-distance grade", () => {
  const result = resolveGrades(SAMPLE_TREE, [
    {
      categoryKey: "specialFacilities",
      itemKey: "proximityToUtilityGasFacility",
      evidence: { type: "range", raw: "距6000M", value: 6000, unit: "m" },
    },
    {
      categoryKey: "specialFacilities",
      itemKey: "proximityToUtilityGasFacility",
      evidence: { type: "range", raw: "距300M", value: 300, unit: "m" },
    },
  ]);

  assert.deepEqual(result.regionalFactors.categories, [
    {
      key: "specialFacilities",
      raw: "特殊設施",
      items: [
        {
          key: "proximityToUtilityGasFacility",
          raw: "電業設施及公用氣體燃料設施之有無及接近程度",
          selectedGrade: { key: "inferior", raw: "劣", value: -8, rate: 2 },
        },
      ],
    },
  ]);
});
