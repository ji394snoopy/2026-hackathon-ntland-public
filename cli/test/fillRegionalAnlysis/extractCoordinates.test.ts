import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCoordinates } from "../../src/fillRegionalAnlysis/extractCoordinates.js";

// Minimal synthetic text-layer fixtures shaped like a real pdfjs getTextContent()
// dump (str/x/y triples), covering only the anchor strings/columns extractCoordinates
// actually reads. Column x's and y-gaps below are taken from the real commercial PDF
// dump (validated during planning): continuation lines sit ~10.56pt apart, new rows
// ≥11.16pt apart. rateX/gradeCenterX/percentX offsets are calibrated against
// references/example-page-2.pdf, a real filled reference — see extractCoordinates.ts's
// own header comment for the exact offset values and how they were derived.

const HEADER_ROW = [
  { str: "優劣等級", x: 210.53, y: 742.3 }, // base
  { str: "優劣等級", x: 269.33, y: 742.3 }, // comparable 1
  { str: "優劣等級", x: 368.11, y: 742.3 }, // comparable 2
  { str: "優劣等級", x: 466.9, y: 742.3 }, // comparable 3
  { str: "修正百分", x: 318.67, y: 747.58 }, // comparable 1 percent header
  { str: "修正百分", x: 417.43, y: 747.58 }, // comparable 2 percent header
  { str: "修正百分", x: 516.22, y: 747.58 }, // comparable 3 percent header
  { str: "比準地", x: 214.61, y: 777.22 },
  { str: "地價區段號", x: 100.7, y: 760.3 },
  { str: "實例編號", x: 282.17, y: 776.74 },
  { str: "實例編號", x: 380.95, y: 776.74 },
  { str: "實例編號", x: 479.74, y: 776.74 },
];

const ITEM_LABEL_X = 83.76;
const CATEGORY_LABEL_X = 46.56;

test("single category/item, no wrapped lines: rateX/gradeCenterX/percentX derived from the 優劣等級 headers per the reference offsets", () => {
  const items = [
    ...HEADER_ROW,
    { str: "土地使用", x: CATEGORY_LABEL_X, y: 688.54 },
    { str: "管制", x: CATEGORY_LABEL_X + 3.36, y: 677.98 },
    { str: "都市計畫（內、外）", x: ITEM_LABEL_X, y: 723.82 },
    { str: "百分比小計", x: ITEM_LABEL_X, y: 642.31 },
    { str: "=(1)+(2)", x: ITEM_LABEL_X, y: 125.88 },
  ];

  const coords = extractCoordinates(items);

  assert.equal(coords.categories.length, 1);
  const category = coords.categories[0]!;
  const item = category.items[0]!;
  assert.equal(item.itemRaw, "都市計畫（內、外）");

  // base: rateX = gradeHeaderX - 2.76, gradeCenterX = gradeHeaderX + 25.08
  assert.equal(item.base.rateX, 210.53 - 2.76);
  assert.equal(item.base.rateY, 723.82);
  assert.equal(item.base.gradeCenterX, 210.53 + 25.08);
  assert.equal(item.base.gradeCenterY, 723.82);

  // comparable 1: rateX = gradeHeaderX - 3.24, gradeCenterX = gradeHeaderX + 27.24,
  // percentX = percentHeaderX + 6.24 (percent header derived the same way headers are:
  // the "修正百分" text's own x, one column-pitch per comparable to the right)
  const comp1 = item.comparables[0]!;
  assert.equal(comp1.rateX, 269.33 - 3.24);
  assert.equal(comp1.gradeCenterX, 269.33 + 27.24);

  // percentEndX from the old schema is gone; percentX is left-aligned now
  assert.ok(comp1.percentX !== undefined);
  assert.equal(comp1.percentY, 723.82);

  // comparable 3 uses its own real measured 優劣等級/修正百分 headers directly (466.9 /
  // 516.22), not a pitch extrapolation from comparable 1 — every header is real,
  // measured text on every one of these PDFs, so there's no need to extrapolate.
  const comp3 = item.comparables[2]!;
  assert.ok(Math.abs(comp3.rateX - (466.9 - 3.24)) < 1e-9);
  assert.ok(Math.abs(comp3.gradeCenterX - (466.9 + 27.24)) < 1e-9);
  assert.ok(Math.abs(comp3.percentX - (516.22 + 6.24)) < 1e-9);
});

test("wrapped item label (~10.56pt apart) merges into one itemRaw, row y is the first line's y", () => {
  const items = [
    ...HEADER_ROW,
    { str: "土地使用", x: CATEGORY_LABEL_X, y: 688.54 },
    { str: "管制", x: CATEGORY_LABEL_X + 3.36, y: 677.98 },
    { str: "都市計畫（內、外）", x: ITEM_LABEL_X, y: 723.82 },
    { str: "有無限制建築（整體開發、面", x: ITEM_LABEL_X, y: 664.27 },
    { str: "積限制、高度限制……等）", x: ITEM_LABEL_X, y: 653.71 }, // 10.56pt gap: continuation
    { str: "百分比小計", x: ITEM_LABEL_X, y: 642.31 },
    { str: "=(1)+(2)", x: ITEM_LABEL_X, y: 125.88 },
  ];

  const coords = extractCoordinates(items);

  assert.equal(coords.categories[0]!.items.length, 2);
  const wrapped = coords.categories[0]!.items[1]!;
  assert.equal(wrapped.itemRaw, "有無限制建築（整體開發、面積限制、高度限制……等）");
  assert.equal(wrapped.base.rateY, 664.27);
});

test("two categories: items partitioned by the 百分比小計 subtotal markers between them", () => {
  const items = [
    ...HEADER_ROW,
    { str: "土地使用", x: CATEGORY_LABEL_X, y: 688.54 },
    { str: "管制", x: CATEGORY_LABEL_X + 3.36, y: 677.98 },
    { str: "都市計畫（內、外）", x: ITEM_LABEL_X, y: 723.82 },
    { str: "使用分區", x: ITEM_LABEL_X, y: 711.82 },
    { str: "有無限制建築（整體開發、面", x: ITEM_LABEL_X, y: 699.82 },
    { str: "積限制、高度限制……等）", x: ITEM_LABEL_X, y: 689.26 },
    { str: "百分比小計", x: ITEM_LABEL_X, y: 642.31 },
    { str: "交通運輸", x: CATEGORY_LABEL_X, y: 593.95 },
    { str: "主要道路寬度", x: ITEM_LABEL_X, y: 629.47 },
    { str: "百分比小計", x: ITEM_LABEL_X, y: 547.99 },
    { str: "=(1)+(2)", x: ITEM_LABEL_X, y: 125.88 },
  ];

  const coords = extractCoordinates(items);

  assert.equal(coords.categories.length, 2);
  assert.equal(coords.categories[0]!.categoryRaw, "土地使用管制");
  assert.deepEqual(coords.categories[0]!.items.map((i) => i.itemRaw), [
    "都市計畫（內、外）",
    "使用分區",
    "有無限制建築（整體開發、面積限制、高度限制……等）",
  ]);
  assert.equal(coords.categories[1]!.categoryRaw, "交通運輸");
  assert.deepEqual(coords.categories[1]!.items.map((i) => i.itemRaw), ["主要道路寬度"]);
});

test("category subtotal / grand-total percentX: base uses the comparable-1 grade header + 24.12 offset (per the reference, base's subtotal sits in the merged region near comparable 1's grade column)", () => {
  const items = [
    ...HEADER_ROW,
    { str: "土地使用", x: CATEGORY_LABEL_X, y: 688.54 },
    { str: "管制", x: CATEGORY_LABEL_X + 3.36, y: 677.98 },
    { str: "都市計畫（內、外）", x: ITEM_LABEL_X, y: 723.82 },
    { str: "百分比小計", x: ITEM_LABEL_X, y: 642.31 },
    { str: "=(1)+(2)", x: ITEM_LABEL_X, y: 125.88 },
  ];

  const coords = extractCoordinates(items);

  const category = coords.categories[0]!;
  assert.equal(category.totalBase.percentX, 269.33 + 24.12);
  assert.equal(category.totalBase.percentY, 642.31);
  assert.equal(coords.totalScoreBase.percentX, 269.33 + 24.12);
  assert.equal(coords.totalScoreBase.percentY, 125.88);
});

test("grand-total row located via the =(1)+(2)+... formula string, independent of category count", () => {
  const items = [
    ...HEADER_ROW,
    { str: "土地使用", x: CATEGORY_LABEL_X, y: 688.54 },
    { str: "管制", x: CATEGORY_LABEL_X + 3.36, y: 677.98 },
    { str: "都市計畫（內、外）", x: ITEM_LABEL_X, y: 723.82 },
    { str: "百分比小計", x: ITEM_LABEL_X, y: 642.31 },
    { str: "=(1)+(2)+(3)+(4)+(5)+(6)", x: ITEM_LABEL_X, y: 125.88 },
    { str: "影響地價", x: CATEGORY_LABEL_X, y: 135.6 },
    { str: "總修正數", x: CATEGORY_LABEL_X, y: 114.48 },
  ];

  const coords = extractCoordinates(items);

  assert.equal(coords.totalScoreBase.percentY, 125.88);
  assert.equal(coords.comparableTotalScores.length, 3);
  assert.equal(coords.comparableTotalScores[0]!.percentY, 125.88);
  // the grand-total row's own stray category-column labels must not become a 9th category
  assert.equal(coords.categories.length, 1);
});

test("continuation gap varies per PDF (measured 11.64pt on the real agricultural PDF, not 10.56pt): still merges wrapped lines without over-merging distinct items", () => {
  const items = [
    ...HEADER_ROW,
    { str: "土地使用", x: CATEGORY_LABEL_X, y: 712.66 },
    { str: "管制", x: CATEGORY_LABEL_X + 3.66, y: 701.02 }, // 11.64pt gap: continuation
    { str: "都市計畫（內、外）", x: ITEM_LABEL_X, y: 723.82 },
    { str: "使用分區(使用地類別)", x: ITEM_LABEL_X, y: 710.74 }, // 13.08pt gap: new item
    { str: "接近聚落之程度", x: ITEM_LABEL_X, y: 697.66 }, // 13.08pt gap: new item
    { str: "接近運銷中心之", x: ITEM_LABEL_X, y: 684.58 }, // 13.08pt gap: new item
    { str: "程度", x: ITEM_LABEL_X, y: 672.94 }, // 11.64pt gap: continuation
    { str: "百分比小計", x: ITEM_LABEL_X, y: 660.0 },
    { str: "=(1)+(2)", x: ITEM_LABEL_X, y: 125.88 },
  ];

  const coords = extractCoordinates(items);

  assert.equal(coords.categories[0]!.categoryRaw, "土地使用管制");
  assert.deepEqual(
    coords.categories[0]!.items.map((i) => i.itemRaw),
    ["都市計畫（內、外）", "使用分區(使用地類別)", "接近聚落之程度", "接近運銷中心之程度"],
  );
});

test("sectionIdBase/comparableInstanceIds derived from 地價區段號/比準地/實例編號 anchors", () => {
  const items = [
    ...HEADER_ROW,
    { str: "土地使用", x: CATEGORY_LABEL_X, y: 688.54 },
    { str: "管制", x: CATEGORY_LABEL_X + 3.36, y: 677.98 },
    { str: "都市計畫（內、外）", x: ITEM_LABEL_X, y: 723.82 },
    { str: "百分比小計", x: ITEM_LABEL_X, y: 642.31 },
    { str: "=(1)+(2)", x: ITEM_LABEL_X, y: 125.88 },
  ];

  const coords = extractCoordinates(items);

  assert.deepEqual(coords.sectionIdBase, { x: 214.61, y: 760.3 });
  assert.equal(coords.comparableInstanceIds?.length, 3);
  assert.deepEqual(
    coords.comparableInstanceIds?.map((c) => c.label),
    ["1", "2", "3"],
  );
  // comparableInstanceIds draws content.comparableSectionIds[].sectionId in the same
  // merged cell as sectionIdBase, so it sits on that exact row (x stays each label's
  // own real measured x; y equals sectionIdBase's y, not "below the 實例編號 label").
  assert.deepEqual(coords.comparableInstanceIds, [
    { label: "1", x: 282.17, y: 760.3 },
    { label: "2", x: 380.95, y: 760.3 },
    { label: "3", x: 479.74, y: 760.3 },
  ]);

  // comparableSequenceNumbers: 實例編號's own sequential-number slot, a distinct
  // position from comparableInstanceIds above so the two values can never collide —
  // drawn on the 實例編號 label's own row, offset right into the blank space after it
  // (the same x every comparable's item-row percent value uses).
  assert.equal(coords.comparableSequenceNumbers?.length, 3);
  assert.deepEqual(coords.comparableSequenceNumbers, [
    { label: "1", x: 324.91, y: 776.74 },
    { label: "2", x: 423.67, y: 776.74 },
    { label: "3", x: 522.46, y: 776.74 },
  ]);
});

test("comparableTotals/comparableTotalScores percentX use the merged-cell region (same x as comparableInstanceIds), not the narrow item-row percent column", () => {
  const items = [
    ...HEADER_ROW,
    { str: "土地使用", x: CATEGORY_LABEL_X, y: 688.54 },
    { str: "管制", x: CATEGORY_LABEL_X + 3.36, y: 677.98 },
    { str: "都市計畫（內、外）", x: ITEM_LABEL_X, y: 723.82 },
    { str: "百分比小計", x: ITEM_LABEL_X, y: 642.31 },
    { str: "=(1)+(2)", x: ITEM_LABEL_X, y: 125.88 },
  ];

  const coords = extractCoordinates(items);

  const category = coords.categories[0]!;
  assert.deepEqual(
    category.comparableTotals.map((t) => t.percentX),
    [282.17, 380.95, 479.74],
  );
  assert.deepEqual(
    coords.comparableTotalScores.map((t) => t.percentX),
    [282.17, 380.95, 479.74],
  );
});
