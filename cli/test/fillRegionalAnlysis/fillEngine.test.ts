import { test } from "node:test";
import assert from "node:assert/strict";
import { planDraws, FONT_SIZE } from "../../src/fillRegionalAnlysis/fillEngine.js";

// Fake text measurer: deterministic, proportional to length, so centered/right-aligned
// cells are reproducible in tests without a real embedded font.
const measure = (text: string) => text.length * 5;

function grade(raw: string, value: number, rate: number) {
  return { key: raw, raw, value, rate };
}

function gradeCell(x: number, y: number) {
  return { rateX: x, rateY: y, gradeCenterX: x + 30, gradeCenterY: y };
}

test("item row: base cell draws rate left-aligned at rateX and grade.raw centered at gradeCenterX, no percent slot", () => {
  const content = {
    categories: [
      {
        categoryKey: "landUseRegulation",
        categoryRaw: "土地使用管制",
        items: [
          {
            categoryKey: "landUseRegulation",
            categoryRaw: "土地使用管制",
            itemKey: "zoningDesignation",
            itemRaw: "使用分區",
            base: grade("優", 0, 1),
            comparables: [],
          },
        ],
        totalBase: 0,
        comparableTotals: [],
      },
    ],
    sectionIdBase: null,
    comparableSectionIds: [],
    totalScoreBase: 0,
    comparableTotalScores: [],
  };
  const coords = {
    categories: [
      {
        categoryRaw: "土地使用管制",
        items: [
          {
            itemRaw: "使用分區",
            base: gradeCell(100, 700),
            comparables: [],
          },
        ],
        totalBase: { percentX: 200, percentY: 690 },
        comparableTotals: [],
      },
    ],
    totalScoreBase: { percentX: 200, percentY: 100 },
    comparableTotalScores: [],
  };

  const draws = planDraws(content, coords, measure);
  assert.deepEqual(draws, [
    { op: "text", x: 100, y: 700, text: "1", size: FONT_SIZE }, // rate, left-aligned
    { op: "text", x: 130 - measure("優") / 2, y: 700, text: "優", size: FONT_SIZE }, // grade, centered on gradeCenterX=130
    // category.totalBase and totalScoreBase are never drawn
  ]);
});

test("item row: comparable cell draws rate + centered grade + left-aligned bare-number percent (no ％ suffix at item level)", () => {
  const content = {
    categories: [
      {
        categoryKey: "trafficAndTransport",
        categoryRaw: "交通運輸",
        items: [
          {
            categoryKey: "trafficAndTransport",
            categoryRaw: "交通運輸",
            itemKey: "mainRoadWidth",
            itemRaw: "主要道路寬度",
            base: grade("普通", -7.5, 3),
            comparables: [
              { label: "1", grade: grade("優", 0, 1), delta: -7.5 },
            ],
          },
        ],
        totalBase: -7.5,
        comparableTotals: [{ label: "1", total: 0, delta: -7.5 }],
      },
    ],
    sectionIdBase: null,
    comparableSectionIds: [],
    totalScoreBase: -7.5,
    comparableTotalScores: [{ label: "1", total: 0, delta: -7.5 }],
  };
  const coords = {
    categories: [
      {
        categoryRaw: "交通運輸",
        items: [
          {
            itemRaw: "主要道路寬度",
            base: gradeCell(100, 700),
            comparables: [{ label: "1", ...gradeCell(250, 700), percentX: 300, percentY: 700 }],
          },
        ],
        totalBase: { percentX: 200, percentY: 690 },
        comparableTotals: [{ label: "1", percentX: 300, percentY: 690 }],
      },
    ],
    totalScoreBase: { percentX: 200, percentY: 100 },
    comparableTotalScores: [{ label: "1", percentX: 300, percentY: 100 }],
  };

  const draws = planDraws(content, coords, measure);
  assert.deepEqual(draws, [
    { op: "text", x: 100, y: 700, text: "3", size: FONT_SIZE }, // base rate
    { op: "text", x: 130 - measure("普通") / 2, y: 700, text: "普通", size: FONT_SIZE }, // base grade centered
    { op: "text", x: 250, y: 700, text: "1", size: FONT_SIZE }, // comparable rate
    { op: "text", x: 280 - measure("優") / 2, y: 700, text: "優", size: FONT_SIZE }, // comparable grade centered
    { op: "text", x: 300, y: 700, text: "-7.50", size: FONT_SIZE }, // item-level percent: bare, left-aligned
    // category.totalBase is never drawn; comparableTotals[].delta still is
    { op: "text", x: 300, y: 690, text: "-7.50％", size: FONT_SIZE },
    // totalScoreBase is never drawn; comparableTotalScores[].delta still is
    { op: "text", x: 300, y: 100, text: "-7.50％", size: FONT_SIZE },
  ]);
});

test("positive delta has no leading + sign (negatives still show their own -), at both item level (bare) and subtotal level (％-suffixed)", () => {
  const content = {
    categories: [
      {
        categoryKey: "publicInfrastructure",
        categoryRaw: "公共建設",
        items: [
          {
            categoryKey: "publicInfrastructure",
            categoryRaw: "公共建設",
            itemKey: "proximityToMarket",
            itemRaw: "接近市場之程度",
            base: grade("優", 0, 1),
            comparables: [{ label: "1", grade: grade("普通", -3, 3), delta: 3 }],
          },
        ],
        totalBase: 0,
        comparableTotals: [{ label: "1", total: -3, delta: 3 }],
      },
    ],
    sectionIdBase: null,
    comparableSectionIds: [],
    totalScoreBase: 0,
    comparableTotalScores: [{ label: "1", total: -3, delta: 3 }],
  };
  const coords = {
    categories: [
      {
        categoryRaw: "公共建設",
        items: [
          {
            itemRaw: "接近市場之程度",
            base: gradeCell(100, 700),
            comparables: [{ label: "1", ...gradeCell(250, 700), percentX: 300, percentY: 700 }],
          },
        ],
        totalBase: { percentX: 200, percentY: 690 },
        comparableTotals: [{ label: "1", percentX: 300, percentY: 690 }],
      },
    ],
    totalScoreBase: { percentX: 200, percentY: 100 },
    comparableTotalScores: [{ label: "1", percentX: 300, percentY: 100 }],
  };

  const draws = planDraws(content, coords, measure);
  const percentDraws = draws.filter((d) => d.text.startsWith("3.00"));
  assert.deepEqual(
    percentDraws.map((d) => d.text),
    ["3.00", "3.00％", "3.00％"],
  );
});

test("sectionIdBase and matched comparableInstanceIds draw the raw section-id string", () => {
  const content = {
    categories: [],
    sectionIdBase: "P002-00",
    comparableSectionIds: [
      { label: "1", sectionId: "P002-01" },
      { label: "2", sectionId: "P002-02" },
    ],
    totalScoreBase: 0,
    comparableTotalScores: [],
  };
  const coords = {
    sectionIdBase: { x: 50, y: 800 },
    comparableInstanceIds: [{ label: "1", x: 150, y: 800 }],
    categories: [],
    totalScoreBase: { percentX: 200, percentY: 100 },
    comparableTotalScores: [],
  };

  const draws = planDraws(content, coords, measure);
  assert.deepEqual(draws, [
    { op: "text", x: 50, y: 800, text: "P002-00", size: FONT_SIZE },
    { op: "text", x: 150, y: 800, text: "P002-01", size: FONT_SIZE },
    // totalScoreBase is never drawn
  ]);
});

test("comparableSequenceNumbers: draws 1..n positionally, n = however many comparableSectionIds entries content has, regardless of their own label values", () => {
  const content = {
    categories: [],
    sectionIdBase: null,
    comparableSectionIds: [
      { label: "1", sectionId: "P002-01" },
      { label: "2", sectionId: "P002-02" },
    ],
    totalScoreBase: 0,
    comparableTotalScores: [],
  };
  const coords = {
    categories: [],
    comparableSequenceNumbers: [
      { label: "1", x: 282, y: 767 },
      { label: "2", x: 385, y: 767 },
      { label: "3", x: 485, y: 767 },
    ],
    totalScoreBase: { percentX: 200, percentY: 100 },
    comparableTotalScores: [],
  };

  const draws = planDraws(content, coords, measure);
  assert.deepEqual(draws, [
    { op: "text", x: 282, y: 767, text: "1", size: FONT_SIZE },
    { op: "text", x: 385, y: 767, text: "2", size: FONT_SIZE },
    // only 2 comparables present in content — the 3rd coords slot is unused, no throw
  ]);
});

test("comparableSequenceNumbers: fills all 3 when content has 3 comparables, even if content's own labels aren't \"1\"/\"2\"/\"3\"", () => {
  const content = {
    categories: [],
    sectionIdBase: null,
    comparableSectionIds: [
      { label: "a", sectionId: "P002-01" },
      { label: "b", sectionId: "P002-02" },
      { label: "c", sectionId: "P002-03" },
    ],
    totalScoreBase: 0,
    comparableTotalScores: [],
  };
  const coords = {
    categories: [],
    comparableSequenceNumbers: [
      { label: "1", x: 282, y: 767 },
      { label: "2", x: 385, y: 767 },
      { label: "3", x: 485, y: 767 },
    ],
    totalScoreBase: { percentX: 200, percentY: 100 },
    comparableTotalScores: [],
  };

  const draws = planDraws(content, coords, measure);
  assert.deepEqual(draws, [
    { op: "text", x: 282, y: 767, text: "1", size: FONT_SIZE },
    { op: "text", x: 385, y: 767, text: "2", size: FONT_SIZE },
    { op: "text", x: 485, y: 767, text: "3", size: FONT_SIZE },
  ]);
});

test("category present in content but missing from coords (by categoryRaw): skipped, no throw", () => {
  const content = {
    categories: [
      {
        categoryKey: "commercialActivity",
        categoryRaw: "工商活動",
        items: [
          {
            categoryKey: "commercialActivity",
            categoryRaw: "工商活動",
            itemKey: "customerTrafficVolume",
            itemRaw: "顧客通行量之多寡",
            base: grade("優", 0, 1),
            comparables: [],
          },
        ],
        totalBase: 0,
        comparableTotals: [],
      },
    ],
    sectionIdBase: null,
    comparableSectionIds: [],
    totalScoreBase: 0,
    comparableTotalScores: [],
  };
  const coords = {
    categories: [],
    totalScoreBase: { percentX: 200, percentY: 100 },
    comparableTotalScores: [],
  };

  assert.doesNotThrow(() => planDraws(content, coords, measure));
  assert.deepEqual(planDraws(content, coords, measure), []);
});

test("item present in content but missing from a matched category's coords (by itemRaw): skipped, no throw", () => {
  const content = {
    categories: [
      {
        categoryKey: "landUseRegulation",
        categoryRaw: "土地使用管制",
        items: [
          {
            categoryKey: "landUseRegulation",
            categoryRaw: "土地使用管制",
            itemKey: "buildingProhibition",
            itemRaw: "有無禁止建築",
            base: grade("優", 0, 1),
            comparables: [],
          },
        ],
        totalBase: 0,
        comparableTotals: [],
      },
    ],
    sectionIdBase: null,
    comparableSectionIds: [],
    totalScoreBase: 0,
    comparableTotalScores: [],
  };
  const coords = {
    categories: [{ categoryRaw: "土地使用管制", items: [], totalBase: { percentX: 200, percentY: 690 }, comparableTotals: [] }],
    totalScoreBase: { percentX: 200, percentY: 100 },
    comparableTotals: [],
  };

  const draws = planDraws(content, coords, measure);
  // category.totalBase and totalScoreBase are both never drawn
  assert.deepEqual(draws, []);
});

test("category/item matching ignores bracket-enclosed spans (comparison.json's labels are abbreviated vs. the PDF's fuller printed text)", () => {
  const content = {
    categories: [
      {
        categoryKey: "landUseRegulation",
        categoryRaw: "土地使用管制",
        items: [
          {
            categoryKey: "landUseRegulation",
            categoryRaw: "土地使用管制",
            itemKey: "insideOutsideUrbanPlan",
            itemRaw: "都市計畫內外",
            base: grade("優", 0, 1),
            comparables: [],
          },
          {
            categoryKey: "landUseRegulation",
            categoryRaw: "土地使用管制",
            itemKey: "zoningDesignation",
            itemRaw: "使用分區﹝編定﹞",
            base: grade("優", 0, 1),
            comparables: [],
          },
        ],
        totalBase: 0,
        comparableTotals: [],
      },
    ],
    sectionIdBase: null,
    comparableSectionIds: [],
    totalScoreBase: 0,
    comparableTotalScores: [],
  };
  const coords = {
    categories: [
      {
        categoryRaw: "土地使用管制",
        items: [
          { itemRaw: "都市計畫（內、外）", base: gradeCell(100, 700), comparables: [] },
          { itemRaw: "使用分區(使用地類別)", base: gradeCell(100, 690), comparables: [] },
        ],
        totalBase: { percentX: 200, percentY: 680 },
        comparableTotals: [],
      },
    ],
    totalScoreBase: { percentX: 200, percentY: 100 },
    comparableTotalScores: [],
  };

  const draws = planDraws(content, coords, measure);
  const gradeDraws = draws.filter((d) => d.text === "優");
  assert.equal(gradeDraws.length, 2);
});

test("empty category (items: []) draws nothing at all — its totalBase is never drawn, and it has no comparableTotals", () => {
  const content = {
    categories: [
      { categoryKey: "otherFactors", categoryRaw: "其他影響因素", items: [], totalBase: 0, comparableTotals: [] },
    ],
    sectionIdBase: null,
    comparableSectionIds: [],
    totalScoreBase: 0,
    comparableTotalScores: [],
  };
  const coords = {
    categories: [
      { categoryRaw: "其他影響因素", items: [], totalBase: { percentX: 200, percentY: 690 }, comparableTotals: [] },
    ],
    totalScoreBase: { percentX: 200, percentY: 100 },
    comparableTotalScores: [],
  };

  assert.doesNotThrow(() => planDraws(content, coords, measure));
  const draws = planDraws(content, coords, measure);
  assert.deepEqual(draws, []);
});

test("category.totalBase is never drawn even when categoryCoords/category both have it and comparableTotals is non-empty", () => {
  const content = {
    categories: [
      {
        categoryKey: "naturalConditions",
        categoryRaw: "自然條件",
        items: [],
        totalBase: -2.5,
        comparableTotals: [{ label: "1", total: 0, delta: -2.5 }],
      },
    ],
    sectionIdBase: null,
    comparableSectionIds: [],
    totalScoreBase: 0,
    comparableTotalScores: [],
  };
  const coords = {
    categories: [
      {
        categoryRaw: "自然條件",
        items: [],
        totalBase: { percentX: 200, percentY: 690 },
        comparableTotals: [{ label: "1", percentX: 300, percentY: 690 }],
      },
    ],
    totalScoreBase: { percentX: 200, percentY: 100 },
    comparableTotalScores: [],
  };

  const draws = planDraws(content, coords, measure);
  assert.deepEqual(draws, [{ op: "text", x: 300, y: 690, text: "-2.50％", size: FONT_SIZE }]);
});

test("root-level totalScoreBase is never drawn even when it and coords.totalScoreBase both have it, but comparableTotalScores still are", () => {
  const content = {
    categories: [],
    sectionIdBase: null,
    comparableSectionIds: [],
    totalScoreBase: -57,
    comparableTotalScores: [{ label: "1", total: -46.5, delta: -10.5 }],
  };
  const coords = {
    categories: [],
    totalScoreBase: { percentX: 200, percentY: 100 },
    comparableTotalScores: [{ label: "1", percentX: 300, percentY: 100 }],
  };

  const draws = planDraws(content, coords, measure);
  assert.deepEqual(draws, [{ op: "text", x: 300, y: 100, text: "-10.50％", size: FONT_SIZE }]);
});
