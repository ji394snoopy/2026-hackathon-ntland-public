// Hand-measured from input/district-survey.pdf's own text layer (via pdfjs-dist getTextContent
// on page 1) — the known-correct baseline for this template. Used two ways: as the reference
// example in the calibration prompt below (buildCoordinatesPrompt, real PDF, model verifies/
// corrects against the actual page), and copied verbatim into generated synthetic samples
// (generateCoordinate.ts has no real page to check against, so it doesn't call the model at
// all — there'd be nothing for it to verify).
const REFERENCE_COORDINATES = {
  mainRoad: { labelX: 150, labelY: 629.23, valueEndX: 249, valueY: 629.23 },
  averageRoadWidthInSection: { valueEndX: 175, valueY: 614.59 },
  majorStation: [
    {
      circleX: 99.38,
      circleY: 599.71,
      nameGapEndX: 129.23,
      inSectionX: 156.28,
      outSectionX: 192.23,
      distanceEndX: 249,
      distanceY: 599.71,
    },
    {
      circleX: 99.38,
      circleY: 585.07,
      nameGapEndX: 129.23,
      inSectionX: 156.28,
      outSectionX: 192.23,
      distanceEndX: 249,
      distanceY: 585.07,
    },
    {
      circleX: 99.38,
      circleY: 570.36,
      nameGapEndX: 156.51,
      inSectionX: 156.51,
      outSectionX: 192.39,
      distanceEndX: 249,
      distanceY: 570.43,
    },
    {
      circleX: 99.38,
      circleY: 555.79,
      nameGapEndX: 129.23,
      inSectionX: 156.28,
      outSectionX: 192.23,
      distanceEndX: 249,
      distanceY: 555.79,
    },
  ],
  busStop: {
    nameX: 121,
    nameY: 543.55,
    inSectionX: 156.39,
    inSectionY: 543.48,
    outSectionX: 192.51,
    outSectionY: 543.55,
    distanceEndX: 249,
    distanceY: 543.55,
    densityOptionX: [156.28, 192.22, 216.18],
    densityOptionY: [535.87, 535.8, 535.87],
  },
  interchange: {
    nameX: 121,
    nameY: 523.87,
    inSectionX: 156.51,
    outSectionX: 192.51,
    distanceEndX: 249,
    distanceY: 523.87,
  },
  proximityToSettlement: { x: 185, y: 509.23 },
  proximityToDistributionCenter: { x: 185, y: 494.57 },
  proximityToMarket: { x: 185, y: 479.93 },
  roadConstructionLevel: { x: 185, y: 465.29 },
};

const REFERENCE_COORDINATES_EXAMPLE = JSON.stringify(
  REFERENCE_COORDINATES,
  null,
  2,
);

const CATEGORY_CONTEXT =
  "This PDF page is a Taiwanese (Traditional Chinese) 表1 地價區段勘查表 (district survey " +
  "table) for one price-zone. This call only verifies on-page draw coordinates for the " +
  "交通運輸 (traffic and transport) category block's items — it does not read or extract " +
  "any item's printed content.";

const ORDER_RULE =
  "majorStation's four entries must stay in this fixed printed order: 高鐵站, 火車站, 客運站, " +
  "捷運站 — the same order the content-extraction tool uses for majorStation.items, so the " +
  "two outputs can be matched up positionally afterward.";

const VERIFY_INSTRUCTION =
  "For every group of coordinates, actually look at this page image and check each reference " +
  "number against what you see before answering — don't pattern-match the reference straight " +
  "into your output without looking. Before you output a group's coordinates, write a brief " +
  "sentence comparing it against the page: does 主要道路's label really sit at roughly " +
  "labelX≈150? Does 大型車站's first row really sit at circleY≈600? If the printed layout still " +
  "matches, copy the reference numbers through unchanged. If it has genuinely shifted, replace " +
  "them with what you actually observe on the page.";

const PLAUSIBILITY_RULE =
  "This page is a standard-size printed form (roughly 595×842 points, A4). Every plausible " +
  "coordinate on it is a positive number under about 850. If a reference value is wildly " +
  "outside that range — in the thousands, millions, or negative — it is an error in the " +
  "reference itself, not a real position: do not copy it through. Instead estimate a " +
  "replacement from the item's position relative to the other reference coordinates around it " +
  "that do look plausible (e.g. same row, neighboring column), and set that group's " +
  "matchesReference to false.";

const COLUMN_ORDER_RULE =
  "Within any coordinate group that has these fields, they must follow the page's left-to-right " +
  "column order: nameGapEndX (majorStation rows only) must never be larger than that row's " +
  "inSectionX, and inSectionX must never be larger than outSectionX (every group that has both " +
  "— majorStation, busStop, interchange). If a reference value breaks this ordering, it is an " +
  "error in the reference itself — correct it using the surrounding column positions as a " +
  "guide, and set that group's matchesReference to false.";

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
