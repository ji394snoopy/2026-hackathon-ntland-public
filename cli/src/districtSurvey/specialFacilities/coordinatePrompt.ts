// Derived from input/district-survey.pdf's own text layer (via `pdftotext -bbox-layout`,
// converting poppler's top-left-origin word boxes to the PDF's bottom-left-origin space with
// y_bottomleft = 841.68 - yMax + 1.17 — the same formula publicInfrastructure's reference
// coordinates use, verified against trafficAndTransport's hand-measured values). Used two ways:
// as the reference example in the calibration prompt below (buildCoordinatesPrompt, real PDF,
// model verifies/corrects against the actual page), and copied verbatim into generated synthetic
// samples (generateSample.ts has no real page to check against, so it doesn't call the model at
// all for coordinates — there'd be nothing for it to verify).
const REFERENCE_COORDINATES = {
  utilityGasFacility: [
    {
      nameX: 390.07,
      nameY: 577.99,
      inSectionX: 423.43,
      outSectionX: 459.43,
      distanceEndX: 513.44,
      distanceY: 577.99,
    },
    {
      nameX: 390.07,
      nameY: 547.03,
      inSectionX: 423.43,
      outSectionX: 459.43,
      distanceEndX: 513.44,
      distanceY: 547.03,
    },
  ],
  funeralFacility: [
    {
      checkX: 330.91,
      checkY: 523.63,
      nameX: 390.29,
      nameY: 523.63,
      inSectionX: 423.36,
      outSectionX: 459.31,
      distanceEndX: 510.22,
      distanceY: 523.63,
    },
    {
      checkX: 330.91,
      checkY: 508.99,
      nameX: 390.07,
      nameY: 508.99,
      inSectionX: 423.34,
      outSectionX: 459.29,
      distanceEndX: 513.2,
      distanceY: 508.99,
    },
    {
      checkX: 330.91,
      checkY: 494.33,
      nameX: 390.07,
      nameY: 494.33,
      inSectionX: 423.34,
      outSectionX: 459.29,
      distanceEndX: 513.2,
      distanceY: 494.33,
    },
    {
      checkX: 330.91,
      checkY: 479.69,
      nameX: 390.07,
      nameY: 479.69,
      inSectionX: 423.34,
      outSectionX: 459.29,
      distanceEndX: 513.2,
      distanceY: 479.69,
    },
  ],
  wasteFacility: [
    {
      checkX: 330.91,
      checkY: 465.05,
      nameX: 390.07,
      nameY: 465.05,
      inSectionX: 423.34,
      outSectionX: 459.29,
      distanceEndX: 513.2,
      distanceY: 465.05,
    },
    {
      checkX: 330.91,
      checkY: 454.25,
      nameX: 390.07,
      nameY: 450.41,
      inSectionX: 423.34,
      outSectionX: 459.29,
      distanceEndX: 513.2,
      distanceY: 450.41,
    },
    {
      checkX: 330.91,
      checkY: 435.77,
      nameX: 390.07,
      nameY: 435.77,
      inSectionX: 423.34,
      outSectionX: 459.29,
      distanceEndX: 513.2,
      distanceY: 435.77,
    },
  ],
};

const REFERENCE_COORDINATES_EXAMPLE = JSON.stringify(REFERENCE_COORDINATES, null, 2);

const CATEGORY_CONTEXT =
  "This PDF page is a Taiwanese (Traditional Chinese) 表1 地價區段勘查表 (district survey " +
  "table) for one price-zone. This call only verifies on-page draw coordinates for the " +
  "特殊設施 (special facilities) category block's items — it does not read or extract any " +
  "item's printed content. This category spans three group rows: 電業氣體燃料, 殯葬, " +
  "廢棄物處理.";

const ORDER_RULE =
  "utilityGasFacility's two entries must stay in this fixed printed order: 變電所或高壓鐵塔, " +
  "瓦斯槽或儲油槽. funeralFacility's four entries must stay in this fixed printed order: 墓地, " +
  "殯儀館, 火葬場, 納骨塔. wasteFacility's three entries must stay in this fixed printed order: " +
  "污水處理場, 垃圾場或掩埋場, 焚化爐 — note 垃圾場或掩埋場's own printed label wraps to a " +
  "second line, so its checkY may sit above nameY/distanceY on the same row. These orders match " +
  "the content-extraction tool's item orders exactly, so the two outputs can be matched up " +
  "positionally afterward.";

const VERIFY_INSTRUCTION =
  "For every group of coordinates, actually look at this page image and check each reference " +
  "number against what you see before answering — don't pattern-match the reference straight " +
  "into your output without looking. Before you output a group's coordinates, write a brief " +
  "sentence comparing it against the page: does 變電所或高壓鐵塔's 名稱 answer really sit at " +
  "roughly nameX≈390, nameY≈578? Does 墓地's leading checkbox really sit at roughly " +
  "checkX≈331, checkY≈524? If the printed layout still matches, copy the reference numbers " +
  "through unchanged. If it has genuinely shifted, replace them with what you actually observe " +
  "on the page.";

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
  "column order: checkX (funeralFacility/wasteFacility rows only) must never be larger than " +
  "that row's nameX, nameX must never be larger than inSectionX, and inSectionX must never be " +
  "larger than outSectionX. If a reference value breaks this ordering, it is an error in the " +
  "reference itself — correct it using the surrounding column positions as a guide, and set " +
  "that group's matchesReference to false.";

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
