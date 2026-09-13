// Derived from input/district-survey.pdf's own vector content: the table's own column border
// (a real drawn line at x=151.4, confirmed via PyMuPDF's get_drawings()) plus each row's label
// baseline (via PyMuPDF's get_text("words"), cross-checked against `pdftotext -bbox-layout`), using
// y_bottomleft = 841.68 - yMax + 1.17 — the same formula every sibling module's reference
// coordinates use. All 6 items sit in one left-aligned answer column a few points right of the
// border. buildingRestriction's label wraps onto two printed lines, but its own item-code digits
// (and a small white "erase" rectangle already baked into this template) sit at the single baseline
// used here, confirming it as the intended one-line answer position. Used two ways: as the
// reference example in the calibration prompt below (buildCoordinatesPrompt, real PDF, model
// verifies/corrects against the actual page), and copied verbatim into generated synthetic samples
// (generateSample.ts has no real page to check against, so it doesn't call the model at all for
// coordinates — there'd be nothing for it to verify).
const REFERENCE_COORDINATES = {
  insideOutsideUrbanPlan: { x: 155, y: 731.26 },
  zoningDesignation: { x: 155, y: 716.62 },
  buildingCoverageRatio: { x: 155, y: 701.98 },
  floorAreaRatio: { x: 155, y: 687.34 },
  buildingProhibition: { x: 155, y: 672.7 },
  buildingRestriction: { x: 155, y: 651.19 },
};

const REFERENCE_COORDINATES_EXAMPLE = JSON.stringify(REFERENCE_COORDINATES, null, 2);

const CATEGORY_CONTEXT =
  "This PDF page is a Taiwanese (Traditional Chinese) 表1 地價區段勘查表 (district survey " +
  "table) for one price-zone. This call only verifies on-page draw coordinates for the " +
  "土地使用管制 (land use regulation) category block's items — it does not read or extract any " +
  "item's printed content. All 6 items are plain blank cells (no checkboxes) stacked in one " +
  "left-aligned answer column near the top-left of the page.";

const VERIFY_INSTRUCTION =
  "For every item, actually look at this page image and check its reference number against what " +
  "you see before answering — don't pattern-match the reference straight into your output " +
  "without looking. Before you output an item's coordinates, write a brief sentence comparing it " +
  "against the page: does 都市計畫（內外）'s blank answer cell really sit at roughly y≈731? Does " +
  "有無限制建築（整體開發、面積限制、高度限制）'s answer cell really sit at roughly y≈651, at the " +
  "row's item-code digits rather than either line of its wrapped label? If the printed layout " +
  "still matches, copy the reference numbers through unchanged. If it has genuinely shifted, " +
  "replace them with what you actually observe on the page.";

const PLAUSIBILITY_RULE =
  "This page is a standard-size printed form (roughly 595×842 points, A4). Every plausible " +
  "coordinate on it is a positive number under about 850. If a reference value is wildly " +
  "outside that range — in the thousands, millions, or negative — it is an error in the " +
  "reference itself, not a real position: do not copy it through. Instead estimate a " +
  "replacement from the item's position relative to the other reference coordinates around it " +
  "that do look plausible (all 6 items share the same x and descend in a fixed row order), and " +
  "set that item's matchesReference to false.";

const ROW_ORDER_RULE =
  "All 6 items share the same x (one answer column) and must stay in this fixed top-to-bottom " +
  "printed order, each y strictly smaller (lower on the page) than the one before it: " +
  "insideOutsideUrbanPlan, zoningDesignation, buildingCoverageRatio, floorAreaRatio, " +
  "buildingProhibition, buildingRestriction. If a reference value breaks this ordering, it is an " +
  "error in the reference itself — correct it using the surrounding row positions as a guide, and " +
  "set that item's matchesReference to false.";

const MATCHES_REFERENCE_RULE =
  'Every item also has a "matchesReference" boolean. Set it to true only if you compared its ' +
  "numbers against the page and left them unchanged. Set it to false if you changed anything, " +
  "for any reason — including correcting an implausible reference value per the rule above.";

function buildCoordinatesPrompt(): string {
  return [
    CATEGORY_CONTEXT,
    "",
    VERIFY_INSTRUCTION,
    "",
    PLAUSIBILITY_RULE,
    "",
    ROW_ORDER_RULE,
    "",
    MATCHES_REFERENCE_RULE,
    "",
    "Reference coordinates (verify each one against the actual page):",
    REFERENCE_COORDINATES_EXAMPLE,
  ].join("\n");
}

export { buildCoordinatesPrompt, REFERENCE_COORDINATES };
