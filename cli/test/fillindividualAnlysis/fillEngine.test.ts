import { test } from "node:test";
import assert from "node:assert/strict";
import { planDraws, FONT_SIZE } from "../../src/fillindividualAnlysis/fillEngine.js";

// Fake text measurer: deterministic, proportional to length, so centered cells are
// reproducible in tests without a real embedded font (same technique as
// test/fillRegionalAnlysis/fillEngine.test.ts).
const measure = (text: string) => text.length * 5;

function cellCoord(x: number, y: number, nameLeftBound = x - 1000) {
  return {
    condition: { x, y },
    nameDistanceUnit: {
      name: { x: x + 10, y, leftBound: nameLeftBound }, // right-aligned anchor + own sub-cell's left border
      distance: { x: x + 25, y }, // center anchor
      unit: { x: x + 40, y }, // left-aligned anchor
    },
  };
}

function resolvedItem(raw: string, value: unknown, gradeValue: number, rate: number) {
  return { key: raw, raw, value, selectedGrade: { key: raw, raw, value: gradeValue, rate } };
}

test("item with a plain string value: base+comparable condition centered, comparable delta drawn as a right-aligned signed percent, no percent for base", () => {
  const content = {
    categories: [
      {
        categoryKey: "lotCondition",
        categoryRaw: "宗地條件",
        items: [
          {
            categoryKey: "lotCondition",
            itemKey: "shape",
            base: resolvedItem("形狀", "方形", 0, 1),
            comparables: [{ label: "1", item: resolvedItem("形狀", "方形", 0, 1), delta: 2.5 }],
          },
        ],
        totalBase: 0,
        comparableTotals: [{ label: "1", total: 0, delta: 0 }],
      },
    ],
  };
  const coords = {
    items: [
      {
        categoryKey: "lotCondition",
        itemKey: "shape",
        base: cellCoord(100, 400),
        comparables: [{ label: "1", ...cellCoord(300, 400), percent: { rightX: 350, leftBound: 250, y: 400 } }],
      },
    ],
    otherFactors: { base: { x: 0, y: 0 }, comparables: [] },
    comparableTotalScores: [],
  };

  const draws = planDraws(content, coords, measure);
  // "2.50％" (no leading + for positive) measures 25 (5 chars * 5); maxWidth=100
  // (350-250) so it fits unshrunk, right-aligned flush against rightX: x = 350 - 25.
  assert.deepEqual(draws, [
    { op: "text", x: 100 - measure("方形") / 2, y: 400, text: "方形", size: FONT_SIZE },
    { op: "text", x: 300 - measure("方形") / 2, y: 400, text: "方形", size: FONT_SIZE },
    { op: "text", x: 325, y: 400, text: "2.50％", size: FONT_SIZE },
  ]);
});

test("a percent value too wide for its own percent sub-cell (rightX - leftBound) shrinks to fit, still right-aligned on rightX", () => {
  const content = {
    categories: [
      {
        categoryKey: "administrativeCondition",
        categoryRaw: "行政條件",
        items: [
          {
            categoryKey: "administrativeCondition",
            itemKey: "floorAreaRatio",
            base: resolvedItem("容積率", "240%", 0, 1),
            comparables: [{ label: "1", item: resolvedItem("容積率", "130%", -30, 4), delta: 104.75 }],
          },
        ],
        totalBase: 0,
        comparableTotals: [{ label: "1", total: -30, delta: 104.75 }],
      },
    ],
  };
  const coords = {
    items: [
      {
        categoryKey: "administrativeCondition",
        itemKey: "floorAreaRatio",
        base: cellCoord(100, 400),
        // "104.75％" (no leading + for positive) measures 35 (7 chars * 5); maxWidth=24
        // (350-326) -> scale=24/35.
        comparables: [{ label: "1", ...cellCoord(300, 400), percent: { rightX: 350, leftBound: 326, y: 400 } }],
      },
    ],
    otherFactors: { base: { x: 0, y: 0 }, comparables: [] },
    comparableTotalScores: [],
  };

  const draws = planDraws(content, coords, measure);
  const s = 24 / 35;
  assert.deepEqual(draws[2], { op: "text", x: 350 - 35 * s, y: 400, text: "104.75％", size: FONT_SIZE * s });
});

test("item with a {name,distance,unit} value: name right-aligned on its own anchor, distance centered, unit left-aligned, all at full size when name fits its leftBound", () => {
  const value = { name: "中山路", distance: "18", unit: "M" }; // measure: 15, 10, 5
  const content = {
    categories: [
      {
        categoryKey: "roadCondition",
        categoryRaw: "道路條件",
        items: [
          {
            categoryKey: "roadCondition",
            itemKey: "frontageRoadWidth",
            base: resolvedItem("面前道路寬度", value, -2.5, 2),
            comparables: [{ label: "1", item: resolvedItem("面前道路寬度", value, -2.5, 2), delta: 0 }],
          },
        ],
        totalBase: -2.5,
        comparableTotals: [{ label: "1", total: -2.5, delta: 0 }],
      },
    ],
  };
  const coords = {
    items: [
      {
        categoryKey: "roadCondition",
        itemKey: "frontageRoadWidth",
        base: cellCoord(100, 400),
        comparables: [{ label: "1", ...cellCoord(300, 400), percent: { rightX: 350, leftBound: 250, y: 400 } }],
      },
    ],
    otherFactors: { base: { x: 0, y: 0 }, comparables: [] },
    comparableTotalScores: [],
  };

  const draws = planDraws(content, coords, measure);
  // base: name right edge=110, distance center=125, unit left-aligned=140.
  // name draws at 110-15=95 (leftBound defaults far away, no shrink); distance at
  // 125-10/2=120; unit at 140. percent: "0.00％" measures 25, fits maxWidth=100
  // unshrunk, right-aligned flush against rightX=350: x = 350-25=325.
  assert.deepEqual(draws, [
    { op: "text", x: 95, y: 400, text: "中山路", size: FONT_SIZE },
    { op: "text", x: 120, y: 400, text: "18", size: FONT_SIZE },
    { op: "text", x: 140, y: 400, text: "M", size: FONT_SIZE },
    { op: "text", x: 295, y: 400, text: "中山路", size: FONT_SIZE },
    { op: "text", x: 320, y: 400, text: "18", size: FONT_SIZE },
    { op: "text", x: 340, y: 400, text: "M", size: FONT_SIZE },
    { op: "text", x: 325, y: 400, text: "0.00％", size: FONT_SIZE },
  ]);
});

test("a name too wide for its own sub-cell (name.x - leftBound) shrinks just the name, right-aligned on the same anchor; distance/unit stay full size", () => {
  const value = { name: "ABCDEFGH", distance: "12", unit: "M" }; // measure: 40, 10, 5
  const content = {
    categories: [
      {
        categoryKey: "surroundingEnvironment",
        categoryRaw: "周邊環境條件",
        items: [
          {
            categoryKey: "surroundingEnvironment",
            itemKey: "presenceOfNoxiousFacility",
            base: resolvedItem("嫌惡設施之有無", value, -6, 5),
            comparables: [],
          },
        ],
      },
    ],
  };
  const coords = {
    items: [
      {
        categoryKey: "surroundingEnvironment",
        itemKey: "presenceOfNoxiousFacility",
        // name.x=110, leftBound=86 -> maxWidth=24; nameWidth=40 -> scale=24/40=0.6.
        // distance=125, unit=140 unaffected.
        base: cellCoord(100, 400, 86),
        comparables: [],
      },
    ],
    otherFactors: { base: { x: 0, y: 0 }, comparables: [] },
    comparableTotalScores: [],
  };

  const draws = planDraws(content, coords, measure);
  const s = 0.6;
  assert.deepEqual(draws, [
    { op: "text", x: 110 - 40 * s, y: 400, text: "ABCDEFGH", size: FONT_SIZE * s },
    { op: "text", x: 125 - 10 / 2, y: 400, text: "12", size: FONT_SIZE },
    { op: "text", x: 140, y: 400, text: "M", size: FONT_SIZE },
  ]);
});

test("otherFactors category (empty items) draws a literal '-' in base condition and every comparable's condition+percent", () => {
  const content = {
    categories: [
      { categoryKey: "otherFactors", categoryRaw: "其他影響因素", items: [], totalBase: 0, comparableTotals: [{ label: "1", total: 0, delta: 0 }] },
    ],
  };
  const coords = {
    items: [],
    otherFactors: {
      base: { x: 100, y: 200 },
      comparables: [{ label: "1", condition: { x: 300, y: 200 }, percent: { x: 350, y: 200 } }],
    },
    comparableTotalScores: [],
  };

  const draws = planDraws(content, coords, measure);
  assert.deepEqual(draws, [
    { op: "text", x: 100 - measure("-") / 2, y: 200, text: "-", size: FONT_SIZE },
    { op: "text", x: 300 - measure("-") / 2, y: 200, text: "-", size: FONT_SIZE },
    { op: "text", x: 350 - measure("-") / 2, y: 200, text: "-", size: FONT_SIZE },
  ]);
});

test("category.totalBase/comparableTotals are never drawn; only comparableTotalScores[].delta is, centered on its own merged-region anchor (totalScoreBase skipped)", () => {
  const content = {
    categories: [],
    totalScoreBase: -32,
    comparableTotalScores: [{ label: "1", total: -32, delta: 0 }],
  };
  const coords = {
    items: [],
    otherFactors: { base: { x: 0, y: 0 }, comparables: [] },
    comparableTotalScores: [{ label: "1", coord: { x: 500, y: 100 } }],
  };

  const draws = planDraws(content, coords, measure);
  assert.deepEqual(draws, [{ op: "text", x: 500 - measure("0.00％") / 2, y: 100, text: "0.00％", size: FONT_SIZE }]);
});

test("sectionIdBase/comparableIdentities[].sectionId draw left-aligned; locationBase/comparableIdentities[].location draw centered — both at their own coordinate entries", () => {
  const content = {
    categories: [],
    sectionIdBase: "P002-00",
    locationBase: "新北市金山區金美段489地號",
    comparableIdentities: [{ label: "1", sectionId: "P002-00", location: "新北市金山區溫泉段218地號" }],
  };
  const coords = {
    items: [],
    sectionIdBase: { x: 10, y: 20 },
    locationBase: { x: 30, y: 40 },
    comparableIdentities: [{ label: "1", sectionId: { x: 50, y: 60 }, location: { x: 70, y: 80 } }],
    otherFactors: { base: { x: 0, y: 0 }, comparables: [] },
    comparableTotalScores: [],
  };

  const draws = planDraws(content, coords, measure);
  assert.deepEqual(draws, [
    { op: "text", x: 10, y: 20, text: "P002-00", size: FONT_SIZE }, // sectionId: left-aligned
    { op: "text", x: 30 - measure("新北市金山區金美段489地號") / 2, y: 40, text: "新北市金山區金美段489地號", size: FONT_SIZE }, // location: centered
    { op: "text", x: 50, y: 60, text: "P002-00", size: FONT_SIZE }, // comparable sectionId: left-aligned
    { op: "text", x: 70 - measure("新北市金山區溫泉段218地號") / 2, y: 80, text: "新北市金山區溫泉段218地號", size: FONT_SIZE }, // comparable location: centered
  ]);
});
