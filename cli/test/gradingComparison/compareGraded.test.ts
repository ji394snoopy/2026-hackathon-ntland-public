import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFillReport, deriveLabel } from "../../src/gradingComparison/compareGraded.js";
import type { GradedResultWithMeta } from "../../src/gradingComparison/compareGraded.js";

function grade(key: string, raw: string, value: number, rate = 1) {
  return { key, raw, value, rate };
}

function item(key: string, raw: string, selectedGrade: ReturnType<typeof grade>) {
  return { key, raw, selectedGrade };
}

function category(key: string, raw: string, items: ReturnType<typeof item>[]) {
  return { key, raw, items };
}

function gradedResult(
  categories: ReturnType<typeof category>[],
  totalScore: number,
  sectionId = "P000-00",
): GradedResultWithMeta {
  return { meta: { sectionId }, regionalFactors: { raw: "區域因素", categories }, totalScore };
}

function findCategory(report: ReturnType<typeof buildFillReport>, categoryKey: string) {
  return report.categories.find((c) => c.categoryKey === categoryKey)!;
}

test("buildFillReport: an item present on base and one comparable reports base, that comparable's grade, and the value delta", () => {
  const a = gradedResult(
    [
      category("landUseRegulation", "土地使用管制", [
        item("insideOutsideUrbanPlan", "都市計畫內外", grade("superior", "優", 0)),
      ]),
    ],
    0,
  );
  const b1 = gradedResult(
    [
      category("landUseRegulation", "土地使用管制", [
        item("insideOutsideUrbanPlan", "都市計畫內外", grade("inferior", "劣", -20, 2)),
      ]),
    ],
    -20,
  );

  const report = buildFillReport(a, [{ label: "1", graded: b1 }]);

  assert.deepEqual(findCategory(report, "landUseRegulation").items, [
    {
      categoryKey: "landUseRegulation",
      categoryRaw: "土地使用管制",
      itemKey: "insideOutsideUrbanPlan",
      itemRaw: "都市計畫內外",
      base: { key: "superior", raw: "優", value: 0, rate: 1 },
      comparables: [
        {
          label: "1",
          grade: { key: "inferior", raw: "劣", value: -20, rate: 2 },
          delta: 20,
        },
      ],
    },
  ]);
});

test("buildFillReport: an item missing on the base reports base:null, and its present comparable reports its own grade with delta:null", () => {
  const a = gradedResult([], 0);
  const b1 = gradedResult(
    [
      category("naturalConditions", "自然條件", [
        item("terrain", "地勢", grade("superior", "優", 0)),
      ]),
    ],
    0,
  );

  const report = buildFillReport(a, [{ label: "1", graded: b1 }]);

  assert.deepEqual(findCategory(report, "naturalConditions").items, [
    {
      categoryKey: "naturalConditions",
      categoryRaw: "自然條件",
      itemKey: "terrain",
      itemRaw: "地勢",
      base: null,
      comparables: [
        { label: "1", grade: { key: "superior", raw: "優", value: 0, rate: 1 }, delta: null },
      ],
    },
  ]);
});

test("buildFillReport: an item missing on one comparable (present on base and another comparable) reports that comparable's cell as null grade/delta", () => {
  const a = gradedResult(
    [
      category("naturalConditions", "自然條件", [
        item("terrain", "地勢", grade("superior", "優", 0)),
      ]),
    ],
    0,
  );
  const b1 = gradedResult([], 0);
  const b2 = gradedResult(
    [
      category("naturalConditions", "自然條件", [
        item("terrain", "地勢", grade("average", "普通", -5, 3)),
      ]),
    ],
    -5,
  );

  const report = buildFillReport(a, [
    { label: "1", graded: b1 },
    { label: "2", graded: b2 },
  ]);

  assert.deepEqual(findCategory(report, "naturalConditions").items[0]!.comparables, [
    { label: "1", grade: null, delta: null },
    { label: "2", grade: { key: "average", raw: "普通", value: -5, rate: 3 }, delta: 5 },
  ]);
});

test("buildFillReport: category totals sum item values per side, treating a missing item as 0, with delta = totalBase - total", () => {
  const a = gradedResult(
    [
      category("landUseRegulation", "土地使用管制", [
        item("insideOutsideUrbanPlan", "都市計畫內外", grade("superior", "優", 0)),
        item("zoningDesignation", "使用分區﹝編定﹞", grade("inferior", "劣", -20, 5)),
      ]),
    ],
    -20,
  );
  const b1 = gradedResult(
    [
      category("landUseRegulation", "土地使用管制", [
        item("insideOutsideUrbanPlan", "都市計畫內外", grade("superior", "優", 0)),
      ]),
    ],
    0,
  );

  const report = buildFillReport(a, [{ label: "1", graded: b1 }]);
  const landUse = findCategory(report, "landUseRegulation");

  assert.equal(landUse.totalBase, -20);
  assert.deepEqual(landUse.comparableTotals, [{ label: "1", total: 0, delta: -20 }]);
});

test("buildFillReport: categories are ordered by first appearance, base's own order first, then comparable-only categories", () => {
  const a = gradedResult(
    [
      category("landUseRegulation", "土地使用管制", [
        item("insideOutsideUrbanPlan", "都市計畫內外", grade("superior", "優", 0)),
      ]),
    ],
    0,
  );
  const b1 = gradedResult(
    [
      category("landUseRegulation", "土地使用管制", [
        item("insideOutsideUrbanPlan", "都市計畫內外", grade("superior", "優", 0)),
      ]),
      category("naturalConditions", "自然條件", [
        item("terrain", "地勢", grade("inferior", "劣", -10, 5)),
      ]),
    ],
    -10,
  );

  const report = buildFillReport(a, [{ label: "1", graded: b1 }]);

  assert.deepEqual(
    report.categories.map((c) => c.categoryKey),
    ["landUseRegulation", "naturalConditions", "otherFactors"],
  );
});

test("buildFillReport: the otherFactors placeholder category is always appended last, empty, with a zero entry per comparable", () => {
  const a = gradedResult(
    [
      category("landUseRegulation", "土地使用管制", [
        item("insideOutsideUrbanPlan", "都市計畫內外", grade("superior", "優", 0)),
      ]),
    ],
    0,
  );
  const b1 = gradedResult(
    [
      category("landUseRegulation", "土地使用管制", [
        item("insideOutsideUrbanPlan", "都市計畫內外", grade("superior", "優", 0)),
      ]),
    ],
    0,
  );
  const b2 = gradedResult(
    [
      category("landUseRegulation", "土地使用管制", [
        item("insideOutsideUrbanPlan", "都市計畫內外", grade("inferior", "劣", -20, 2)),
      ]),
    ],
    -20,
  );

  const report = buildFillReport(a, [
    { label: "1", graded: b1 },
    { label: "2", graded: b2 },
  ]);
  const otherFactors = report.categories[report.categories.length - 1]!;

  assert.deepEqual(otherFactors, {
    categoryKey: "otherFactors",
    categoryRaw: "其他影響因素",
    items: [],
    totalBase: 0,
    comparableTotals: [
      { label: "1", total: 0, delta: 0 },
      { label: "2", total: 0, delta: 0 },
    ],
  });
});

test("buildFillReport: top-level totalScoreBase/comparableTotalScores reflect each GradedResult.totalScore directly", () => {
  const a = gradedResult([], -57);
  const b1 = gradedResult([], -46.5);
  const b2 = gradedResult([], -30);

  const report = buildFillReport(a, [
    { label: "1", graded: b1 },
    { label: "2", graded: b2 },
  ]);

  assert.equal(report.totalScoreBase, -57);
  assert.deepEqual(report.comparableTotalScores, [
    { label: "1", total: -46.5, delta: -10.5 },
    { label: "2", total: -30, delta: -27 },
  ]);
});

test("buildFillReport: sectionIdBase/comparableSectionIds come from each side's own meta.sectionId", () => {
  const a = gradedResult([], 0, "P002-00");
  const b1 = gradedResult([], 0, "P002-00");
  const b2 = gradedResult([], 0, "P003-00");

  const report = buildFillReport(a, [
    { label: "1", graded: b1 },
    { label: "2", graded: b2 },
  ]);

  assert.equal(report.sectionIdBase, "P002-00");
  assert.deepEqual(report.comparableSectionIds, [
    { label: "1", sectionId: "P002-00" },
    { label: "2", sectionId: "P003-00" },
  ]);
});

test("buildFillReport: given zero comparables, every item/category has empty comparables/comparableTotals, and comparableTotalScores is empty", () => {
  const a = gradedResult(
    [
      category("naturalConditions", "自然條件", [
        item("terrain", "地勢", grade("superior", "優", 0)),
      ]),
    ],
    0,
  );

  const report = buildFillReport(a, []);
  const naturalConditions = findCategory(report, "naturalConditions");

  assert.deepEqual(naturalConditions.items[0]!.comparables, []);
  assert.deepEqual(naturalConditions.comparableTotals, []);
  assert.deepEqual(report.comparableTotalScores, []);
  assert.deepEqual(
    report.categories.map((c) => c.categoryKey),
    ["naturalConditions", "otherFactors"],
  );
});

test("buildFillReport: given an empty base and one non-empty comparable, every item's base is null and categories surface in the comparable's own order", () => {
  const a = gradedResult([], 0);
  const b1 = gradedResult(
    [
      category("naturalConditions", "自然條件", [
        item("terrain", "地勢", grade("superior", "優", 0)),
        item("drainageQuality", "排水之良否", grade("average", "普通", -5, 3)),
      ]),
    ],
    -5,
  );

  const report = buildFillReport(a, [{ label: "1", graded: b1 }]);
  const naturalConditions = findCategory(report, "naturalConditions");

  assert.deepEqual(
    naturalConditions.items.map((i) => i.itemKey),
    ["terrain", "drainageQuality"],
  );
  assert.ok(naturalConditions.items.every((i) => i.base === null));
});

test("deriveLabel: strips the graded- prefix and .json suffix from a path's basename", () => {
  assert.equal(deriveLabel("input/graded-1.json"), "1");
});

test("deriveLabel: works with a bare filename with no directory part", () => {
  assert.equal(deriveLabel("graded-2.json"), "2");
});
