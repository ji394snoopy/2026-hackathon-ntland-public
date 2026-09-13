// Derived from input/district-survey.pdf's own vector content: PyMuPDF's get_text("words") for
// each label's bounding box, cross-checked against get_drawings() for the column's border lines —
// confirmed all 7 items sit in one undivided cell per row (no internal divider between the label
// and its answer, unlike landUseRegulation's bordered split), using
// y_bottomleft = 841.68 - yMax + 1.17, the same formula every sibling module's reference
// coordinates use (cross-checked against landUseRegulation's own known-correct reference before
// trusting it here). All 7 items share one answer x, positioned to clear the widest label
// (保（排）水之良否, which itself ends at x≈151.4) rather than a per-item x — same approach
// landUseRegulation takes for its own category. Used as the reference example in the calibration
// prompt below (buildCoordinatesPrompt, real PDF, model verifies/corrects against the actual
// page) — exported mainly for tests/inspection, same as landUseRegulation's own
// REFERENCE_COORDINATES export.
const REFERENCE_COORDINATES = {
  sunlight: { x: 185, y: 450.65 },
  view: { x: 185, y: 436.01 },
  slope: { x: 185, y: 421.37 },
  drainageQuality: { x: 185, y: 406.49 },
  terrain: { x: 185, y: 392.09 },
  windCondition: { x: 185, y: 377.45 },
  soilQuality: { x: 185, y: 362.81 },
};

const REFERENCE_COORDINATES_EXAMPLE = JSON.stringify(REFERENCE_COORDINATES, null, 2);

const CATEGORY_CONTEXT =
  "This PDF page is a Taiwanese (Traditional Chinese) 表1 地價區段勘查表 (district survey " +
  "table) for one price-zone. This call only verifies on-page draw coordinates for the " +
  "自然條件 (natural conditions) category block's items — it does not read or extract any " +
  "item's printed content. All 7 items are plain blank cells (no checkboxes) stacked in one " +
  "left-aligned answer column, each item's label and answer sharing one narrow undivided row " +
  "cell (no internal divider between label and answer).";

const VERIFY_INSTRUCTION =
  "For every item, actually look at this page image and check its reference number against what " +
  "you see before answering — don't pattern-match the reference straight into your output " +
  "without looking. Before you output an item's coordinates, write a brief sentence comparing it " +
  "against the page: does sunlight (日照)'s blank answer cell really sit at roughly y≈450? Does " +
  "soilQuality (土質)'s answer cell really sit at roughly y≈363, in the row below windCondition " +
  "(風勢)? If the printed layout still matches, copy the reference numbers through unchanged. If " +
  "it has genuinely shifted, replace them with what you actually observe on the page.";

const PLAUSIBILITY_RULE =
  "This page is a standard-size printed form (roughly 595×842 points, A4). Every plausible " +
  "coordinate on it is a positive number under about 850. If a reference value is wildly " +
  "outside that range — in the thousands, millions, or negative — it is an error in the " +
  "reference itself, not a real position: do not copy it through. Instead estimate a " +
  "replacement from the item's position relative to the other reference coordinates around it " +
  "that do look plausible (all 7 items share the same x and descend in a fixed row order), and " +
  "set that item's matchesReference to false.";

const ROW_ORDER_RULE =
  "All 7 items share the same x (one answer column) and must stay in this fixed top-to-bottom " +
  "printed order, each y strictly smaller (lower on the page) than the one before it: sunlight, " +
  "view, slope, drainageQuality, terrain, windCondition, soilQuality. If a reference value " +
  "breaks this ordering, it is an error in the reference itself — correct it using the " +
  "surrounding row positions as a guide, and set that item's matchesReference to false.";

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
