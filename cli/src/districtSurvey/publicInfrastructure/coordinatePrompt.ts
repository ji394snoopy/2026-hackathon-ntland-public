// Derived from input/district-survey.pdf's own text layer (via `pdftotext -bbox-layout`,
// converting poppler's top-left-origin word boxes to the PDF's bottom-left-origin space with
// y_bottomleft = 841.68 - yMax + 1.17 — verified exactly against trafficAndTransport's existing
// hand-measured mainRoad/averageRoadWidthInSection reference values). Used two ways: as the
// reference example in the calibration prompt below (buildCoordinatesPrompt, real PDF, model
// verifies/corrects against the actual page), and copied verbatim into generated synthetic
// samples (generateSample.ts has no real page to check against, so it doesn't call the model at
// all for coordinates — there'd be nothing for it to verify).
const REFERENCE_COORDINATES = {
  touristRecreationFacility: {
    nameX: 378,
    nameY: 734.5,
    inSectionX: 357.07,
    outSectionX: 393.07,
    distanceEndX: 446,
    distanceY: 713.86,
  },
  parkingArea: {
    nameX: 378,
    nameY: 705.22,
    inSectionX: 357.07,
    outSectionX: 393.07,
    distanceEndX: 446,
    distanceY: 684.58,
  },
  proximityToServiceFacility: {
    nameX: 378,
    nameY: 675.94,
    inSectionX: 357.07,
    outSectionX: 393.07,
    distanceEndX: 446,
    distanceY: 655.27,
  },
  electricPowerResources: { x: 360, y: 643.87 },
  industrialWaterSupply: { x: 360, y: 629.59 },
  wastewaterTreatmentFacility: {
    nameX: 378,
    nameY: 607.03,
    inSectionX: 407.98,
    outSectionX: 443.93,
    distanceEndX: 493.84,
    distanceY: 607.03,
  },
  school: [
    {
      checkX: 99.38,
      checkY: 292.34,
      nameGapEndX: 165,
      inSectionX: 168.39,
      outSectionX: 204.39,
      distanceEndX: 254.4,
      distanceY: 292.34,
    },
    {
      checkX: 99.38,
      checkY: 277.7,
      nameGapEndX: 165,
      inSectionX: 168.39,
      outSectionX: 204.39,
      distanceEndX: 254.4,
      distanceY: 277.7,
    },
    {
      checkX: 99.38,
      checkY: 263.06,
      nameGapEndX: 165,
      inSectionX: 168.39,
      outSectionX: 204.39,
      distanceEndX: 254.4,
      distanceY: 263.06,
    },
    {
      checkX: 99.38,
      checkY: 248.3,
      nameGapEndX: 165,
      inSectionX: 168.39,
      outSectionX: 204.39,
      distanceEndX: 254.4,
      distanceY: 248.3,
    },
  ],
  market: [
    {
      checkX: 99.38,
      checkY: 239.71,
      nameGapEndX: 165,
      inSectionX: 192.39,
      outSectionX: 225.39,
      distanceEndX: 101.3,
      distanceY: 228.74,
    },
    {
      checkX: 99.38,
      checkY: 217.7,
      nameGapEndX: 165,
      inSectionX: 168.39,
      outSectionX: 204.39,
      distanceEndX: 254.4,
      distanceY: 217.7,
    },
    {
      checkX: 99.38,
      checkY: 206.54,
      nameGapEndX: 165,
      inSectionX: 168.39,
      outSectionX: 204.39,
      distanceEndX: 254.4,
      distanceY: 206.54,
    },
  ],
  parkPlazaPedestrianZone: [
    {
      checkX: 99.38,
      checkY: 197.95,
      nameGapEndX: 165,
      inSectionX: 186.39,
      outSectionX: 222.39,
      distanceEndX: 101.3,
      distanceY: 183.38,
    },
    {
      checkX: 99.38,
      checkY: 168.6,
      nameGapEndX: 165,
      inSectionX: 168.39,
      outSectionX: 204.39,
      distanceEndX: 254.4,
      distanceY: 168.6,
    },
    {
      checkX: 99.38,
      checkY: 153.84,
      nameGapEndX: 165,
      inSectionX: 168.27,
      outSectionX: 204.22,
      distanceEndX: 254.1,
      distanceY: 153.84,
    },
  ],
};

const REFERENCE_COORDINATES_EXAMPLE = JSON.stringify(REFERENCE_COORDINATES, null, 2);

const CATEGORY_CONTEXT =
  "This PDF page is a Taiwanese (Traditional Chinese) 表1 地價區段勘查表 (district survey " +
  "table) for one price-zone. This call only verifies on-page draw coordinates for the " +
  "公共建設 (public infrastructure) category block's items — it does not read or extract any " +
  "item's printed content. This category spans two separate blocks on the page: a top-right " +
  "block (touristRecreationFacility, parkingArea, proximityToServiceFacility, " +
  "electricPowerResources, industrialWaterSupply, wastewaterTreatmentFacility) and a " +
  "bottom-left block (school, market, parkPlazaPedestrianZone).";

const ORDER_RULE =
  "school's four entries must stay in this fixed printed order: 國小, 國中, 高中, 大專院校. " +
  "market's three entries must stay in this fixed printed order: 傳統市場, 超級市場, " +
  "超大型購物中心 — note 傳統市場's own row prints no label text at all (a blank cell), so " +
  "calibrate its checkbox/section/distance positions from the blank row itself, not from any " +
  "visible label. parkPlazaPedestrianZone's three entries must stay in this fixed printed " +
  "order: 里鄰公園, 一般公園, 廣場.徒步區 — 里鄰公園's row is likewise printed blank. These " +
  "orders match the content-extraction tool's item orders exactly, so the two outputs can be " +
  "matched up positionally afterward.";

const VERIFY_INSTRUCTION =
  "For every group of coordinates, actually look at this page image and check each reference " +
  "number against what you see before answering — don't pattern-match the reference straight " +
  "into your output without looking. Before you output a group's coordinates, write a brief " +
  "sentence comparing it against the page: does 觀光遊憩設施's 名稱 answer really sit at roughly " +
  "nameX≈378, nameY≈735? Does 學校's first row really sit at roughly checkY≈292? If the printed " +
  "layout still matches, copy the reference numbers through unchanged. If it has genuinely " +
  "shifted, replace them with what you actually observe on the page.";

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
  "column order: nameGapEndX (school/market/parkPlazaPedestrianZone rows only) must never be " +
  "larger than that row's inSectionX, and inSectionX must never be larger than outSectionX " +
  "(every group that has both). If a reference value breaks this ordering, it is an error in the " +
  "reference itself — correct it using the surrounding column positions as a guide, and set that " +
  "group's matchesReference to false.";

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
