import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFillReport, deriveLabel } from "../../src/individualComparison/compareGraded.js";
import type { GradedResultWithMeta } from "../../src/individualComparison/compareGraded.js";

function grade(key: string, raw: string, value: number, rate = 1) {
  return { key, raw, value, rate };
}

function item(key: string, raw: string, value: string, selectedGrade: ReturnType<typeof grade>) {
  return { key, raw, value, selectedGrade };
}

function category(key: string, raw: string, items: ReturnType<typeof item>[]) {
  return { key, raw, items };
}

function gradedResult(
  categories: ReturnType<typeof category>[],
  totalScore: number,
  sectionId = "P000-00",
  location = "新北市金山區金美段489地號",
): GradedResultWithMeta {
  return {
    meta: { sectionId },
    benchmark: { location },
    individualFactors: { raw: "個別因素", categories },
    totalScore,
  };
}

function findCategory(report: ReturnType<typeof buildFillReport>, categoryKey: string) {
  return report.categories.find((c) => c.categoryKey === categoryKey)!;
}

test("buildFillReport: an item present on base and one comparable reports base, that comparable's item, and the value delta", () => {
  const a = gradedResult([
    category("lotCondition", "宗地條件", [
      item("width", "寬度", "5", grade("slightlyInferior", "稍劣", -3, 4)),
    ]),
  ], -3);
  const b1 = gradedResult([
    category("lotCondition", "宗地條件", [
      item("width", "寬度", "7", grade("superior", "優", 0)),
    ]),
  ], 0);

  const report = buildFillReport(a, [{ label: "1", graded: b1 }]);

  assert.deepEqual(findCategory(report, "lotCondition").items, [
    {
      categoryKey: "lotCondition",
      categoryRaw: "宗地條件",
      itemKey: "width",
      itemRaw: "寬度",
      base: { key: "width", raw: "寬度", value: "5", selectedGrade: grade("slightlyInferior", "稍劣", -3, 4) },
      comparables: [
        {
          label: "1",
          item: { key: "width", raw: "寬度", value: "7", selectedGrade: grade("superior", "優", 0) },
          delta: -3,
        },
      ],
    },
  ]);
});

test("buildFillReport: an item missing on the base reports base:null, and its present comparable reports its own item with delta:null", () => {
  const a = gradedResult([], 0);
  const b1 = gradedResult([
    category("lotCondition", "宗地條件", [
      item("terrain", "地勢", "平坦", grade("superior", "優", 0)),
    ]),
  ], 0);

  const report = buildFillReport(a, [{ label: "1", graded: b1 }]);

  assert.deepEqual(findCategory(report, "lotCondition").items, [
    {
      categoryKey: "lotCondition",
      categoryRaw: "宗地條件",
      itemKey: "terrain",
      itemRaw: "地勢",
      base: null,
      comparables: [
        { label: "1", item: { key: "terrain", raw: "地勢", value: "平坦", selectedGrade: grade("superior", "優", 0) }, delta: null },
      ],
    },
  ]);
});

test("buildFillReport: an item missing on one comparable (present on base and another) reports that comparable's cell as null item/delta", () => {
  const a = gradedResult([
    category("lotCondition", "宗地條件", [
      item("terrain", "地勢", "平坦", grade("superior", "優", 0)),
    ]),
  ], 0);
  const b1 = gradedResult([], 0);
  const b2 = gradedResult([
    category("lotCondition", "宗地條件", [
      item("terrain", "地勢", "低窪", grade("average", "普通", -5, 3)),
    ]),
  ], -5);

  const report = buildFillReport(a, [
    { label: "1", graded: b1 },
    { label: "2", graded: b2 },
  ]);

  assert.deepEqual(findCategory(report, "lotCondition").items[0]!.comparables, [
    { label: "1", item: null, delta: null },
    { label: "2", item: { key: "terrain", raw: "地勢", value: "低窪", selectedGrade: grade("average", "普通", -5, 3) }, delta: 5 },
  ]);
});

test("buildFillReport: given an empty base and one non-empty comparable, every item's base is null and categories surface in the comparable's own order", () => {
  const a = gradedResult([], 0);
  const b1 = gradedResult([
    category("lotCondition", "宗地條件", [
      item("terrain", "地勢", "平坦", grade("superior", "優", 0)),
      item("shape", "形狀", "方形", grade("superior", "優", 0)),
    ]),
  ], 0);

  const report = buildFillReport(a, [{ label: "1", graded: b1 }]);
  const lotCondition = findCategory(report, "lotCondition");

  assert.deepEqual(
    lotCondition.items.map((i) => i.itemKey),
    ["terrain", "shape"],
  );
  assert.ok(lotCondition.items.every((i) => i.base === null));
});

test("buildFillReport: category totals sum item selectedGrade.value per side, treating a missing item as 0, with delta = totalBase - total", () => {
  const a = gradedResult([
    category("lotCondition", "宗地條件", [
      item("terrain", "地勢", "平坦", grade("superior", "優", 0)),
      item("width", "寬度", "5", grade("slightlyInferior", "稍劣", -3, 4)),
    ]),
  ], -3);
  const b1 = gradedResult([
    category("lotCondition", "宗地條件", [
      item("terrain", "地勢", "平坦", grade("superior", "優", 0)),
    ]),
  ], 0);

  const report = buildFillReport(a, [{ label: "1", graded: b1 }]);
  const lotCondition = findCategory(report, "lotCondition");

  assert.equal(lotCondition.totalBase, -3);
  assert.deepEqual(lotCondition.comparableTotals, [{ label: "1", total: 0, delta: -3 }]);
});

test("buildFillReport: categories are ordered by first appearance, base's own order first, then comparable-only categories", () => {
  const a = gradedResult([
    category("lotCondition", "宗地條件", [
      item("terrain", "地勢", "平坦", grade("superior", "優", 0)),
    ]),
  ], 0);
  const b1 = gradedResult([
    category("lotCondition", "宗地條件", [
      item("terrain", "地勢", "平坦", grade("superior", "優", 0)),
    ]),
    category("roadCondition", "道路條件", [
      item("roadType", "道路種類", "主要道路", grade("inferior", "劣", -10, 5)),
    ]),
  ], -10);

  const report = buildFillReport(a, [{ label: "1", graded: b1 }]);

  assert.deepEqual(
    report.categories.map((c) => c.categoryKey),
    ["lotCondition", "roadCondition", "otherFactors"],
  );
});

test("buildFillReport: the otherFactors placeholder category is always appended last, empty, with a zero entry per comparable", () => {
  const a = gradedResult([
    category("lotCondition", "宗地條件", [
      item("terrain", "地勢", "平坦", grade("superior", "優", 0)),
    ]),
  ], 0);
  const b1 = gradedResult([
    category("lotCondition", "宗地條件", [
      item("terrain", "地勢", "平坦", grade("superior", "優", 0)),
    ]),
  ], 0);
  const b2 = gradedResult([
    category("lotCondition", "宗地條件", [
      item("terrain", "地勢", "低窪", grade("inferior", "劣", -20, 2)),
    ]),
  ], -20);

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
  const a = gradedResult([], -32);
  const b1 = gradedResult([], -20);
  const b2 = gradedResult([], -50);

  const report = buildFillReport(a, [
    { label: "1", graded: b1 },
    { label: "2", graded: b2 },
  ]);

  assert.equal(report.totalScoreBase, -32);
  assert.deepEqual(report.comparableTotalScores, [
    { label: "1", total: -20, delta: -12 },
    { label: "2", total: -50, delta: 18 },
  ]);
});

test("buildFillReport: sectionIdBase/locationBase and comparableIdentities come from each side's own meta.sectionId/benchmark.location", () => {
  const a = gradedResult([], 0, "P002-00", "新北市金山區金美段489地號");
  const b1 = gradedResult([], 0, "P002-00", "新北市金山區溫泉段218地號");
  const b2 = gradedResult([], 0, "P003-00", "新北市金山區頂寮段100地號");

  const report = buildFillReport(a, [
    { label: "1", graded: b1 },
    { label: "2", graded: b2 },
  ]);

  assert.equal(report.sectionIdBase, "P002-00");
  assert.equal(report.locationBase, "新北市金山區金美段489地號");
  assert.deepEqual(report.comparableIdentities, [
    { label: "1", sectionId: "P002-00", location: "新北市金山區溫泉段218地號" },
    { label: "2", sectionId: "P003-00", location: "新北市金山區頂寮段100地號" },
  ]);
});

test("buildFillReport: given zero comparables, every item/category has empty comparables/comparableTotals, and comparableTotalScores/comparableIdentities are empty", () => {
  const a = gradedResult([
    category("lotCondition", "宗地條件", [
      item("terrain", "地勢", "平坦", grade("superior", "優", 0)),
    ]),
  ], 0);

  const report = buildFillReport(a, []);
  const lotCondition = findCategory(report, "lotCondition");

  assert.deepEqual(lotCondition.items[0]!.comparables, []);
  assert.deepEqual(lotCondition.comparableTotals, []);
  assert.deepEqual(report.comparableTotalScores, []);
  assert.deepEqual(report.comparableIdentities, []);
  assert.deepEqual(
    report.categories.map((c) => c.categoryKey),
    ["lotCondition", "otherFactors"],
  );
});

test("deriveLabel: strips the graded- prefix and .json suffix from a path's basename", () => {
  assert.equal(deriveLabel("input/graded-1.json"), "1");
});

test("deriveLabel: works with a bare filename with no directory part", () => {
  assert.equal(deriveLabel("graded-2.json"), "2");
});
