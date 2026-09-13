import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveGrades } from "../../src/individualFactorGrading/resolveGrades.js";
import type {
  IndividualFactorsTree,
  RangeCriteria,
  EnumCriteria,
} from "../../src/individualFactorGrading/resolveGrades.js";
import type { Benchmark } from "../../src/individualFactorGrading/benchmarkValue.js";

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

/** A trimmed slice of factor-standard.json's individualFactors tree. */
const SAMPLE_TREE: IndividualFactorsTree = {
  raw: "個別因素",
  categories: [
    category("lotCondition", "宗地條件", [
      item("shape", "形狀", [
        grade("superior", "優", 0, enumCriteria("方形", "square")),
        grade("inferior", "劣", -5, enumCriteria("不規則形", "irregularShape")),
      ]),
    ]),
    category("proximityCondition", "接近條件", [
      item("proximityToSchool", "接近學校程度", [
        grade("superior", "優", 0, rangeCriteria("未滿200m", null, 200, "m")),
        grade("average", "普通", -2, rangeCriteria("600m以上未滿1200m", 600, 1200, "m")),
        grade("inferior", "劣", -4, rangeCriteria("2000m以上或無", 2000, null, "m")),
      ]),
    ]),
    category("surroundingEnvironment", "周邊環境條件", [
      item("presenceOfNoxiousFacility", "嫌惡設施之有無", [
        grade("superior", "優", 0, rangeCriteria("500m以上或無", 500, null, "m")),
        grade("inferior", "劣", -6, rangeCriteria("未滿100m", null, 100, "m")),
      ]),
    ]),
  ],
};

/** A trimmed benchmark fixture covering just the items SAMPLE_TREE grades. */
const BENCHMARK: Benchmark = {
  location: "新北市金山區金美段489地號",
  area: "113.21",
  width: "5",
  depth: "23",
  shape: "方形",
  frontage: "單面臨街",
  terrain: "平坦",
  roadType: "主要道路",
  roadName: "中山路",
  roadWidth: "18",
  schoolName: "金山國小",
  schoolDistance: "150",
  marketName: "金山區第一零售傳統市場",
  marketDistance: "0",
  parkName: "中山溫泉里郡公園",
  parkDistance: "0",
  stationName: "金山區公所站",
  stationDistance: "0",
  districtName: "老街商圈",
  districtDistance: "0",
  disamenityName: "金山第1公墓",
  disamenityDistance: "80",
  parking: "可路邊停車",
  zoning: "第二種商業區",
  coverageRatio: "70%",
  plotRatio: "240%",
  buildRestriction: "無",
  sectionId: "P002-00",
};

test("resolveGrades: happy path resolves raw/value/benchmark-value and sums totalScore", () => {
  const result = resolveGrades(
    SAMPLE_TREE,
    [
      {
        categoryKey: "lotCondition",
        itemKey: "shape",
        evidence: { type: "enum", raw: "方形", enumValue: "square" },
      },
      {
        categoryKey: "proximityCondition",
        itemKey: "proximityToSchool",
        evidence: { type: "range", raw: "150m", value: 150, unit: "m" },
      },
    ],
    BENCHMARK,
  );

  assert.equal(result.totalScore, 0);
  assert.equal(result.individualFactors.categories.length, 2);
  assert.deepEqual(result.individualFactors.categories[0], {
    key: "lotCondition",
    raw: "宗地條件",
    items: [
      {
        key: "shape",
        raw: "形狀",
        value: "方形",
        selectedGrade: { key: "superior", raw: "優", value: 0, rate: 1 },
      },
    ],
  });
  assert.deepEqual(result.individualFactors.categories[1], {
    key: "proximityCondition",
    raw: "接近條件",
    items: [
      {
        key: "proximityToSchool",
        raw: "接近學校程度",
        value: { name: "金山國小", distance: "150", unit: "M" },
        selectedGrade: { key: "superior", raw: "優", value: 0, rate: 1 },
      },
    ],
  });
});

test("resolveGrades: an item with no benchmarkValue mapping gets a null value", () => {
  const NO_MAPPING_TREE: IndividualFactorsTree = {
    raw: "個別因素",
    categories: [
      category("lotCondition", "宗地條件", [
        item("doesNotExistInBenchmark", "不存在", [
          grade("superior", "優", 0, enumCriteria("方形", "square")),
        ]),
      ]),
    ],
  };
  const result = resolveGrades(
    NO_MAPPING_TREE,
    [
      {
        categoryKey: "lotCondition",
        itemKey: "doesNotExistInBenchmark",
        evidence: { type: "enum", raw: "方形", enumValue: "square" },
      },
    ],
    BENCHMARK,
  );

  assert.equal(result.individualFactors.categories[0]?.items[0]?.value, null);
});

test("resolveGrades: rate reflects 1-based position among more than two grades", () => {
  const result = resolveGrades(
    SAMPLE_TREE,
    [
      {
        categoryKey: "proximityCondition",
        itemKey: "proximityToSchool",
        evidence: { type: "range", raw: "700m", value: 700, unit: "m" },
      },
    ],
    BENCHMARK,
  );

  assert.deepEqual(result.individualFactors.categories, [
    {
      key: "proximityCondition",
      raw: "接近條件",
      items: [
        {
          key: "proximityToSchool",
          raw: "接近學校程度",
          value: { name: "金山國小", distance: "150", unit: "M" },
          selectedGrade: { key: "average", raw: "普通", value: -2, rate: 2 },
        },
      ],
    },
  ]);
});

test("resolveGrades: unknown categoryKey is skipped", () => {
  const result = resolveGrades(
    SAMPLE_TREE,
    [
      {
        categoryKey: "doesNotExist",
        itemKey: "x",
        evidence: { type: "enum", raw: "x", enumValue: "square" },
      },
    ],
    BENCHMARK,
  );
  assert.equal(result.totalScore, 0);
  assert.deepEqual(result.individualFactors.categories, []);
});

test("resolveGrades: unknown itemKey within a valid category is skipped", () => {
  const result = resolveGrades(
    SAMPLE_TREE,
    [
      {
        categoryKey: "lotCondition",
        itemKey: "doesNotExist",
        evidence: { type: "enum", raw: "x", enumValue: "square" },
      },
    ],
    BENCHMARK,
  );
  assert.equal(result.totalScore, 0);
  assert.deepEqual(result.individualFactors.categories, []);
});

test("resolveGrades: evidence that matches no grade in the item is skipped", () => {
  const result = resolveGrades(
    SAMPLE_TREE,
    [
      {
        categoryKey: "lotCondition",
        itemKey: "shape",
        evidence: { type: "enum", raw: "不明", enumValue: "doesNotExist" },
      },
    ],
    BENCHMARK,
  );
  assert.equal(result.totalScore, 0);
  assert.deepEqual(result.individualFactors.categories, []);
});

test("resolveGrades: empty extractions produce empty categories and zero total", () => {
  const result = resolveGrades(SAMPLE_TREE, [], BENCHMARK);
  assert.deepEqual(result, {
    individualFactors: { raw: "個別因素", categories: [] },
    totalScore: 0,
  });
});

test("resolveGrades: output category order follows the tree's order, not extraction order", () => {
  const result = resolveGrades(
    SAMPLE_TREE,
    [
      {
        categoryKey: "proximityCondition",
        itemKey: "proximityToSchool",
        evidence: { type: "range", raw: "150m", value: 150, unit: "m" },
      },
      {
        categoryKey: "lotCondition",
        itemKey: "shape",
        evidence: { type: "enum", raw: "不規則形", enumValue: "irregularShape" },
      },
    ],
    BENCHMARK,
  );
  assert.deepEqual(
    result.individualFactors.categories.map((c) => c.key),
    ["lotCondition", "proximityCondition"],
  );
});

test("resolveGrades: two extractions for the same item resolve to the closest-distance grade", () => {
  const result = resolveGrades(
    SAMPLE_TREE,
    [
      {
        categoryKey: "surroundingEnvironment",
        itemKey: "presenceOfNoxiousFacility",
        evidence: { type: "range", raw: "距700M", value: 700, unit: "m" },
      },
      {
        categoryKey: "surroundingEnvironment",
        itemKey: "presenceOfNoxiousFacility",
        evidence: { type: "range", raw: "距80M", value: 80, unit: "m" },
      },
    ],
    BENCHMARK,
  );

  assert.deepEqual(result.individualFactors.categories, [
    {
      key: "surroundingEnvironment",
      raw: "周邊環境條件",
      items: [
        {
          key: "presenceOfNoxiousFacility",
          raw: "嫌惡設施之有無",
          value: { name: "金山第1公墓", distance: "80", unit: "M" },
          selectedGrade: { key: "inferior", raw: "劣", value: -6, rate: 2 },
        },
      ],
    },
  ]);
});
