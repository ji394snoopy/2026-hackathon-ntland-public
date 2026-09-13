import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCoordinates, ITEM_KEY_ORDER } from "../../src/fillindividualAnlysis/extractCoordinates.js";

// Real text-layer values dumped from src/fillindividualAnlysis/input/individual-asnlysis.pdf
// via pdfjs-dist's getTextContent() during planning (see temp/plans/fill-individual-analysis.md's
// Context section) — not guessed. Column headers and the 19 numbered item-row y's are both
// genuinely real, positioned text on this template.
const ITEM_NUMBER_X = 102.74;
const ITEM_ROW_YS = [
  463.66, 452.5, 440.38, 428.26, 416.14, 404.02, // 7-12 lotCondition
  391.87, 378.79, // 13-14 roadCondition
  365.71, 352.63, 339.55, 326.47, 313.39, // 15-19 proximityCondition
  300.31, 287.23, // 20-21 surroundingEnvironment
  273.41, 261.89, 250.37, 238.85, // 22-25 administrativeCondition
];

const HEADER_ROW = [
  { str: "條件", x: 245.33, y: 533.4 }, // base
  { str: "條件", x: 372.55, y: 533.4 }, // comparable 1
  { str: "條件", x: 526.78, y: 533.4 }, // comparable 2
  { str: "條件", x: 681.0, y: 533.4 }, // comparable 3
  { str: "差異率", x: 445.99, y: 532.92 }, // comparable 1
  { str: "差異率", x: 600.22, y: 532.92 }, // comparable 2
  { str: "差異率", x: 754.44, y: 532.92 }, // comparable 3
];

function itemNumberRows() {
  return ITEM_ROW_YS.map((y, i) => ({ str: String(i + 7), x: ITEM_NUMBER_X, y }));
}

test("19 item rows zipped 1:1, in order, against the hardcoded categoryKey/itemKey list", () => {
  const items = [...HEADER_ROW, ...itemNumberRows()];
  const coords = extractCoordinates(items);

  assert.equal(coords.items.length, 19);
  assert.deepEqual(
    coords.items.map((i) => `${i.categoryKey}::${i.itemKey}`),
    ITEM_KEY_ORDER.map((k) => `${k.categoryKey}::${k.itemKey}`),
  );
  // row y comes from the item's own numbered-row y, in descending order (first item = first row)
  assert.deepEqual(coords.items.map((i) => i.base.condition.y), ITEM_ROW_YS);
});

test("non-split item (e.g. 10形狀, 4th row): condition centers at headerX + 7.2 for base and every comparable", () => {
  const items = [...HEADER_ROW, ...itemNumberRows()];
  const coords = extractCoordinates(items);

  const shape = coords.items[3]!; // lotCondition::shape, 4th in ITEM_KEY_ORDER
  assert.equal(shape.itemKey, "shape");
  assert.equal(shape.base.condition.x, 245.33 + 7.2);
  assert.equal(shape.base.condition.y, 428.26);

  const comp1 = shape.comparables[0]!;
  assert.equal(comp1.label, "1");
  assert.equal(comp1.condition.x, 372.55 + 7.2);
  const comp3 = shape.comparables[2]!;
  assert.equal(comp3.condition.x, 681.0 + 7.2);
});

test("split item (面前道路寬度, 8th row): name/distance/unit each get their own calibrated centered/left-aligned anchor, for base and every comparable", () => {
  const items = [...HEADER_ROW, ...itemNumberRows()];
  const coords = extractCoordinates(items);

  const frontageRoadWidth = coords.items[7]!; // roadCondition::frontageRoadWidth
  assert.equal(frontageRoadWidth.itemKey, "frontageRoadWidth");
  const baseNdu = frontageRoadWidth.base.nameDistanceUnit;
  assert.equal(baseNdu.name.x, 245.33 + 13.2);
  assert.equal(baseNdu.distance.x, 245.33 + 30.4);
  assert.equal(baseNdu.unit.x, 245.33 + 55.26);
  assert.equal(baseNdu.name.y, 378.79);

  const comp1Ndu = frontageRoadWidth.comparables[0]!.nameDistanceUnit;
  assert.equal(comp1Ndu.name.x, 372.55 + 13.2);
  assert.equal(comp1Ndu.distance.x, 372.55 + 30.4);
  assert.equal(comp1Ndu.unit.x, 372.55 + 55.26);
});

test("every cell carries a maxX right boundary — base bounded by comparable 1's own column start, each comparable bounded by its own 差異率 header x (not comparable 1's)", () => {
  const items = [...HEADER_ROW, ...itemNumberRows()];
  const coords = extractCoordinates(items);

  const area = coords.items[0]!;
  assert.equal(area.base.maxX, 372.55);
  assert.equal(area.comparables[0]!.maxX, 445.99);
  assert.equal(area.comparables[1]!.maxX, 600.22);
  assert.equal(area.comparables[2]!.maxX, 754.44);
});

test("comparable percent (差異率) coords key off each comparable's own header, not comparable 1's", () => {
  const items = [...HEADER_ROW, ...itemNumberRows()];
  const coords = extractCoordinates(items);

  const area = coords.items[0]!;
  assert.equal(area.comparables[0]!.percent.x, 445.99 + 5.04);
  assert.equal(area.comparables[1]!.percent.x, 600.22 + 5.04);
  assert.equal(area.comparables[2]!.percent.x, 754.44 + 5.04);
});

test("sectionId/location/otherFactors/grand-total coords derive from their own label anchors", () => {
  const items = [
    ...HEADER_ROW,
    ...itemNumberRows(),
    { str: "地價區段", x: 66.14, y: 474.58 },
    { str: "基本資料", x: 66.86, y: 519.48 },
    { str: "其他", x: 81.74, y: 227.57 },
    { str: "合計", x: 124.82, y: 216.05 },
  ];
  const coords = extractCoordinates(items);

  assert.equal(coords.sectionIdBase?.x, 245.33 - 4.92);
  assert.equal(coords.sectionIdBase?.y, 474.58 + 0.6);
  assert.equal(coords.comparableIdentities?.[0]?.sectionId.x, 372.55 - 4.92);

  // 0基本資料/合計 are drawn in a *merged* per-comparable cell (spanning what item rows
  // split into 條件+差異率), physically wider/differently-centered than the item rows'
  // narrow 條件 column — confirmed by measuring the reference PDF's own rendered border
  // pixels (not text): base's merged cell is [188.28,316.26]pt, comparable N's is a
  // uniform ~154.4pt-wide cell starting where the previous one ends. Centered within
  // those, base's true center is headerX+6.94 (≈ the item-row formula, headerX+7.2, by
  // near-coincidence) but every comparable's is headerX+20.93 — independently confirmed
  // via 3 border measurements (comp1/2/3 all ~20.91-20.96), not the item-row offset.
  assert.equal(coords.locationBase?.x, 245.33 + 7.2);
  assert.equal(coords.comparableIdentities?.[1]?.location.x, 526.78 + 20.93);

  assert.equal(coords.otherFactors.base.x, 245.33 + 7.2);
  assert.equal(coords.otherFactors.comparables[0]!.condition.x, 372.55 + 7.2);
  assert.equal(coords.otherFactors.comparables[0]!.percent.x, 445.99 + 5.04);

  assert.equal(coords.comparableTotalScores[0]!.coord.x, 372.55 + 20.93);
  assert.equal(coords.comparableTotalScores.length, 3);
});

test("throws if the PDF doesn't have exactly 4 real 條件 headers", () => {
  const items = [{ str: "條件", x: 245.33, y: 533.4 }, ...itemNumberRows()];
  assert.throws(() => extractCoordinates(items), /Condition header/);
});

test("ignores 條件 occurrences from the 2-line category labels, which sit at a much smaller x than the real column headers", () => {
  const items = [
    ...HEADER_ROW,
    ...itemNumberRows(),
    { str: "條件", x: 81.26, y: 423.34 },
    { str: "條件", x: 82.46, y: 375.79 },
    { str: "條件", x: 81.26, y: 328.03 },
    { str: "條件", x: 81.26, y: 246.53 },
  ];
  const coords = extractCoordinates(items);
  assert.equal(coords.items.length, 19);
  assert.equal(coords.items[3]!.base.condition.x, 245.33 + 7.2);
});
