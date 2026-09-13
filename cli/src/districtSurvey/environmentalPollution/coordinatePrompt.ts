// Derived from input/district-survey.pdf's own text layer (via `pdftotext -bbox-layout`,
// converting poppler's top-left-origin word boxes to the PDF's bottom-left-origin space with
// y_bottomleft = 841.68 - yMax + 1.17 — the same formula specialFacilities' reference coordinates
// use). Used two ways: as the reference example in the calibration prompt below
// (buildCoordinatesPrompt, real PDF, model verifies/corrects against the actual page), and copied
// verbatim into generated synthetic samples (generateSample.ts has no real page to check against,
// so it doesn't call the model at all for coordinates — there'd be nothing for it to verify).
const REFERENCE_COORDINATES = {
  environmentalPollution: [
    {
      checkX: 317.23,
      checkY: 421.37,
      nameX: 390.07,
      nameY: 421.13,
      inSectionX: 423.34,
      outSectionX: 459.29,
      distanceEndX: 513.20,
      distanceY: 421.13,
    },
    {
      checkX: 317.23,
      checkY: 406.73,
      nameX: 390.07,
      nameY: 406.49,
      inSectionX: 423.34,
      outSectionX: 459.29,
      distanceEndX: 513.20,
      distanceY: 406.49,
    },
    {
      checkX: 317.23,
      checkY: 392.09,
      nameX: 390.07,
      nameY: 391.85,
      inSectionX: 423.34,
      outSectionX: 459.29,
      distanceEndX: 513.20,
      distanceY: 391.85,
    },
    {
      checkX: 317.23,
      checkY: 377.45,
      nameX: 390.07,
      nameY: 377.21,
      inSectionX: 423.34,
      outSectionX: 459.29,
      distanceEndX: 513.20,
      distanceY: 377.21,
    },
    {
      checkX: 317.23,
      checkY: 362.81,
      nameX: 390.07,
      nameY: 362.57,
      inSectionX: 423.34,
      outSectionX: 459.29,
      distanceEndX: 513.20,
      distanceY: 362.57,
    },
  ],
};

const REFERENCE_COORDINATES_EXAMPLE = JSON.stringify(REFERENCE_COORDINATES, null, 2);

const CATEGORY_CONTEXT =
  "This PDF page is a Taiwanese (Traditional Chinese) 表1 地價區段勘查表 (district survey " +
  "table) for one price-zone. This call only verifies on-page draw coordinates for the " +
  "環境污染 (environmental pollution) category block's items — it does not read or extract any " +
  "item's printed content. This category is a single group of 5 fixed-order items.";

const ORDER_RULE =
  "environmentalPollution's five entries must stay in this fixed printed order: 水污染, 噪音污染, " +
  "廢氣污染, 廢棄物污染, 其他污染. This order matches the content-extraction tool's item order " +
  "exactly, so the two outputs can be matched up positionally afterward.";

const VERIFY_INSTRUCTION =
  "For every group of coordinates, actually look at this page image and check each reference " +
  "number against what you see before answering — don't pattern-match the reference straight " +
  "into your output without looking. Before you output a group's coordinates, write a brief " +
  "sentence comparing it against the page: does 水污染's leading checkbox really sit at roughly " +
  "checkX≈317, checkY≈421? Does 其他污染's leading checkbox really sit at roughly checkX≈317, " +
  "checkY≈363? If the printed layout still matches, copy the reference numbers through " +
  "unchanged. If it has genuinely shifted, replace them with what you actually observe on the " +
  "page.";

const PLAUSIBILITY_RULE =
  "This page is a standard-size printed form (roughly 595×842 points, A4). Every plausible " +
  "coordinate on it is a positive number under about 850. If a reference value is wildly " +
  "outside that range — in the thousands, millions, or negative — it is an error in the " +
  "reference itself, not a real position: do not copy it through. Instead estimate a " +
  "replacement from the item's position relative to the other reference coordinates around it " +
  "that do look plausible (e.g. same row, neighboring column), and set that group's " +
  "matchesReference to false.";

const COLUMN_ORDER_RULE =
  "Within any coordinate group, they must follow the page's left-to-right column order: checkX " +
  "must never be larger than that row's nameX, nameX must never be larger than inSectionX, and " +
  "inSectionX must never be larger than outSectionX. If a reference value breaks this ordering, " +
  "it is an error in the reference itself — correct it using the surrounding column positions " +
  "as a guide, and set that group's matchesReference to false.";

const MATCHES_REFERENCE_RULE =
  'Every coordinate group also has a "matchesReference" boolean. Set it to true only if you ' +
  "compared every number in that group against the page and left them all unchanged. Set it " +
  "to false if you changed anything in that group, for any reason — including correcting an " +
  "implausible reference value per the rule above.";

function buildCoordinatesPrompt(): string {
  return [
    CATEGORY_CONTEXT,
    "",
    ORDER_RULE,
    "",
    VERIFY_INSTRUCTION,
    "",
    PLAUSIBILITY_RULE,
    "",
    COLUMN_ORDER_RULE,
    "",
    MATCHES_REFERENCE_RULE,
    "",
    "Reference coordinates (verify each one against the actual page):",
    REFERENCE_COORDINATES_EXAMPLE,
  ].join("\n");
}

export { buildCoordinatesPrompt, REFERENCE_COORDINATES };
