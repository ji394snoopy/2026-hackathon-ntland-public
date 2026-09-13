import { test } from "node:test";
import assert from "node:assert/strict";
import { planDraws } from "../../src/fillDistrictSurvey/fillEngine.js";

// Fake text measurer: deterministic, proportional to length, so overflow branching
// (which depends on measured name width vs available gap) is reproducible in tests
// without a real embedded font.
const measure = (text: string) => text.length * 5;

test("plain text leaf: draws content.value.text at x,y", () => {
  const draws = planDraws(
    { zoningDesignation: { value: { text: "第三種住宅區" } } },
    { zoningDesignation: { x: 155, y: 716.62 } },
    measure,
  );
  assert.deepEqual(draws, [
    { op: "text", x: 155, y: 716.62, text: "第三種住宅區", size: 5.5 },
  ]);
});

test("plain text leaf: falls back to type=number/measurement formatting when .text absent", () => {
  const draws = planDraws(
    {
      buildingCoverageRatio: { value: { type: "number", value: 45, unit: "%" } },
      electricPowerResources: {
        value: { type: "measurement", label: "供電", value: 5, unit: "kW" },
      },
    },
    {
      buildingCoverageRatio: { x: 1, y: 2 },
      electricPowerResources: { x: 3, y: 4 },
    },
    measure,
  );
  assert.deepEqual(draws, [
    { op: "text", x: 1, y: 2, text: "45%", size: 5.5 },
    { op: "text", x: 3, y: 4, text: "供電 5kW", size: 5.5 },
  ]);
});

test("plain text leaf: draws nothing when no text is derivable (e.g. singleChoice with no .text)", () => {
  const draws = planDraws(
    { insideOutsideUrbanPlan: { value: { type: "singleChoice", selected: "insideUrbanPlan" } } },
    { insideOutsideUrbanPlan: { x: 155, y: 731.26 } },
    measure,
  );
  assert.deepEqual(draws, []);
});

test("checkbox slot: draws a circle mark only when checked/isExist is true", () => {
  const draws = planDraws(
    { a: { checked: true }, b: { checked: false } },
    { a: { checkX: 10, checkY: 20 }, b: { checkX: 30, checkY: 40 } },
    measure,
  );
  assert.deepEqual(draws, [{ op: "text", x: 10, y: 20, text: "●", size: 6 }]);
});

test("checkbox slot: uses square mark when coordinates set markStyle=square", () => {
  const draws = planDraws(
    { other: { checked: true, text: "設置擋土牆" } },
    { other: { checkX: 189, checkY: 336, textX: 207, textY: 336, markStyle: "square" } },
    measure,
  );
  assert.deepEqual(draws, [
    { op: "text", x: 207, y: 336, text: "設置擋土牆", size: 5.5 },
    { op: "text", x: 189, y: 336, text: "■", size: 6 },
  ]);
});

test("inSection/outSection choice: draws at inSectionX when true, outSectionX when false, nothing when undefined", () => {
  const trueCase = planDraws(
    { a: { value: { inSection: true } } },
    { a: { inSectionX: 10, outSectionX: 20, distanceY: 5 } },
    measure,
  );
  assert.deepEqual(trueCase, [{ op: "text", x: 10, y: 5, text: "●", size: 6 }]);

  const falseCase = planDraws(
    { a: { value: { inSection: false } } },
    { a: { inSectionX: 10, outSectionX: 20, distanceY: 5 } },
    measure,
  );
  assert.deepEqual(falseCase, [{ op: "text", x: 20, y: 5, text: "●", size: 6 }]);

  const undefinedCase = planDraws(
    { a: { value: {} } },
    { a: { inSectionX: 10, outSectionX: 20, distanceY: 5 } },
    measure,
  );
  assert.deepEqual(undefinedCase, []);
});

test("inSection/outSection choice: prefers per-side inSectionY/outSectionY over the shared distanceY fallback", () => {
  const draws = planDraws(
    { a: { value: { inSection: true } } },
    { a: { inSectionX: 10, inSectionY: 99, outSectionX: 20, outSectionY: 88, distanceY: 5 } },
    measure,
  );
  assert.deepEqual(draws, [{ op: "text", x: 10, y: 99, text: "●", size: 6 }]);
});

test("distance slot: right-aligns the distance value ending at distanceEndX using the injected measurer", () => {
  const draws = planDraws(
    { a: { value: { distanceValue: 350 } } },
    { a: { distanceEndX: 100, distanceY: 5 } },
    measure,
  );
  // "350" has length 3 -> measured width 15 -> x = 100 - 15 = 85
  assert.deepEqual(draws, [{ op: "text", x: 85, y: 5, text: "350", size: 5.5 }]);
});

test("value slot: right-aligns a plain numeric value ending at valueEndX (mainRoad/averageRoadWidthInSection shape)", () => {
  const draws = planDraws(
    { mainRoad: { value: { label: "仁愛路", value: 24 } } },
    { mainRoad: { labelX: 150, labelY: 629, valueEndX: 249, valueY: 629 } },
    measure,
  );
  assert.deepEqual(draws, [
    { op: "text", x: 150, y: 629, text: "仁愛路", size: 5.5 },
    { op: "text", x: 249 - "24".length * 5, y: 629, text: "24", size: 5.5 },
  ]);
});

test("packed name row (fits): draws the name at fixed nameX/nameY with no whiteout when it fits before inSectionX", () => {
  const draws = planDraws(
    { a: { value: { isExist: true, name: "AB", inSection: true } } },
    { a: { nameX: 0, nameY: 10, inSectionX: 50, outSectionX: 80, distanceEndX: 120, distanceY: 10 } },
    measure,
  );
  // "AB" -> width 10, fits before inSectionX=50 with the 4pt gap
  assert.deepEqual(draws, [
    { op: "text", x: 0, y: 10, text: "AB", size: 5.5 },
    { op: "text", x: 50, y: 10, text: "●", size: 6 },
  ]);
});

test("packed name row (overflow): whites out the row and redraws name+labels+distance sequentially when the name doesn't fit", () => {
  const draws = planDraws(
    {
      a: {
        value: { isExist: true, name: "A very long facility name", inSection: true, distanceValue: 350 },
      },
    },
    { a: { nameX: 0, nameY: 10, inSectionX: 20, outSectionX: 60, distanceEndX: 200, distanceY: 10 } },
    measure,
  );
  assert.equal(draws[0]!.op, "rect");
  const texts = draws.filter((d) => d.op === "text").map((d: any) => d.text);
  assert.deepEqual(texts, ["A very long facility name", "○本區段內", "○本區段外(距", "350", " M)", "●"]);
});

test("packed name row: skipped entirely when isExist is false", () => {
  const draws = planDraws(
    { a: { value: { isExist: false, name: "" } } },
    { a: { nameX: 0, nameY: 10, inSectionX: 50, outSectionX: 80, distanceEndX: 120, distanceY: 10 } },
    measure,
  );
  assert.deepEqual(draws, []);
});

test("name row without an isExist gate (e.g. busStop) is always drawn", () => {
  const draws = planDraws(
    { busStop: { value: { name: "仁愛路口站", inSection: true } } },
    { busStop: { nameX: 0, nameY: 10, inSectionX: 50, outSectionX: 80, distanceEndX: 120, distanceY: 10 } },
    measure,
  );
  assert.deepEqual(draws, [
    { op: "text", x: 0, y: 10, text: "仁愛路口站", size: 5.5 },
    { op: "text", x: 50, y: 10, text: "●", size: 6 },
  ]);
});

test("two-line facility row (nameY !== distanceY): always draws the name, never whites out", () => {
  const draws = planDraws(
    { a: { value: { isExist: true, name: "A very long facility name that would overflow if packed" } } },
    { a: { nameX: 0, nameY: 100, inSectionX: 20, outSectionX: 60, distanceEndX: 200, distanceY: 10 } },
    measure,
  );
  assert.deepEqual(draws, [
    { op: "text", x: 0, y: 100, text: "A very long facility name that would overflow if packed", size: 5.5 },
  ]);
});

test("packed mark+name (nameGapEndX present): always whites out to nameGapEndX with no fits-check", () => {
  const draws = planDraws(
    { a: { value: { isExist: true, name: "國立臺灣大學" } } },
    { a: { checkX: 100, checkY: 292, nameGapEndX: 165, inSectionX: 168, outSectionX: 204 } },
    measure,
  );
  assert.equal(draws[0]!.op, "rect");
  assert.deepEqual((draws[0] as any), { op: "rect", x: 100, y: 290.5, width: 65, height: 6.5 });
  assert.deepEqual(draws[1], { op: "text", x: 100, y: 292, text: "●國立臺灣大學", size: 5.5 });
});

test("quantity slot: draws the quantity at quantityX using nameY", () => {
  const draws = planDraws(
    { a: { value: { isExist: true, name: "X", quantity: 3 } } },
    { a: { nameX: 0, nameY: 10, quantityX: 40 } },
    measure,
  );
  assert.deepEqual(draws, [
    { op: "text", x: 40, y: 10, text: "3", size: 5.5 },
    { op: "text", x: 0, y: 10, text: "X", size: 5.5 },
  ]);
});

test("density-option slot: indexes into densityOptionX/Y by content.densityLevel", () => {
  const draws = planDraws(
    { busStop: { value: { densityLevel: 1 } } },
    { busStop: { densityOptionX: [1, 2, 3], densityOptionY: [10, 20, 30] } },
    measure,
  );
  assert.deepEqual(draws, [{ op: "text", x: 2, y: 20, text: "●", size: 6 }]);
});

test("array group: zips content.items with a bare coordinates array, warns and skips missing rows", (t) => {
  const warnings: string[] = [];
  t.mock.method(console, "warn", (msg: string) => warnings.push(msg));

  const draws = planDraws(
    { facility: { items: [{ value: { isExist: true, name: "A" } }, { value: { isExist: true, name: "B" } }] } },
    { facility: [{ nameX: 0, nameY: 1 }] },
    measure,
  );

  assert.deepEqual(draws, [{ op: "text", x: 0, y: 1, text: "A", size: 5.5 }]);
  assert.equal(warnings.length, 0); // fewer coordinate rows than content items is not itself a warning case here
});

test("array group: warns and skips when a content item is missing for a coordinate row", (t) => {
  const warnings: string[] = [];
  t.mock.method(console, "warn", (msg: string) => warnings.push(msg));

  const draws = planDraws(
    { facility: { items: [] } },
    { facility: [{ nameX: 0, nameY: 1 }] },
    measure,
  );

  assert.deepEqual(draws, []);
  assert.equal(warnings.length, 1);
});

test("grouped items with .items on both sides plus a sibling 'other' leaf (landImprovement shape)", () => {
  const draws = planDraws(
    {
      buildingSiteImprovement: {
        items: [{ checked: false }, { checked: true }],
        other: { checked: true, text: "設置擋土牆" },
      },
    },
    {
      buildingSiteImprovement: {
        items: [{ checkX: 1, checkY: 2 }, { checkX: 3, checkY: 4, markStyle: "square" }],
        other: { checkX: 5, checkY: 6, textX: 7, textY: 6, markStyle: "square" },
      },
    },
    measure,
  );
  assert.deepEqual(draws, [
    { op: "text", x: 3, y: 4, text: "■", size: 6 },
    { op: "text", x: 7, y: 6, text: "設置擋土牆", size: 5.5 },
    { op: "text", x: 5, y: 6, text: "■", size: 6 },
  ]);
});

test("empty/no-op: a content root with nothing set produces no draw instructions", () => {
  const draws = planDraws(
    { zoningDesignation: { value: {} }, a: { value: {} } },
    {
      zoningDesignation: { x: 1, y: 2 },
      a: { checkX: 1, checkY: 2, nameX: 3, nameY: 4, inSectionX: 5, outSectionX: 6, distanceEndX: 7, distanceY: 4 },
    },
    measure,
  );
  assert.deepEqual(draws, []);
});
