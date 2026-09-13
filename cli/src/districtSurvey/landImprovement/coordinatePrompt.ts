// Derived from input/district-survey.pdf's own text layer (via `pdftotext -bbox-layout`,
// converting poppler's top-left-origin word boxes to the PDF's bottom-left-origin space with
// y_bottomleft = 841.68 - yMax + 1.17 — same method and page height already verified against
// publicInfrastructure's/trafficAndTransport's own hand-measured reference values). Used two
// ways: as the reference example in the calibration prompt below (buildCoordinatesPrompt, real
// PDF, model verifies/corrects against the actual page), and copied verbatim into generated
// synthetic samples (generateSample.ts has no real page to check against, so it doesn't call the
// model at all for coordinates — there'd be nothing for it to verify).
const REFERENCE_COORDINATES = {
  buildingSiteImprovement: {
    items: [
      { checkX: 99.384, checkY: 344.44988 },
      { checkX: 153.38391, checkY: 344.44988 },
      { checkX: 189.38385, checkY: 344.44988 },
      { checkX: 225.38379, checkY: 344.44988 },
      { checkX: 99.384, checkY: 336.76986 },
      { checkX: 153.38391, checkY: 336.76986 },
    ],
    other: {
      checkX: 189.38385,
      checkY: 336.76986,
      textX: 207.34,
      textY: 336.76986,
      textEndX: 243.26,
    },
  },
  farmlandImprovement: {
    items: [
      { checkX: 99.384, checkY: 318.97988 },
      { checkX: 135.38394, checkY: 318.97988 },
      { checkX: 171.38627, checkY: 318.97988 },
      { checkX: 207.3886, checkY: 318.97988 },
      { checkX: 243.39093, checkY: 318.97988 },
      { checkX: 99.384, checkY: 311.29986 },
      { checkX: 135.31665, checkY: 311.29986 },
      { checkX: 171.24929, checkY: 311.29986 },
      { checkX: 207.18193, checkY: 311.29986 },
    ],
    other: {
      checkX: 243.11458,
      checkY: 311.29986,
      textX: 99.384,
      textY: 303.61986,
      textEndX: 200,
    },
  },
};

const REFERENCE_COORDINATES_EXAMPLE = JSON.stringify(REFERENCE_COORDINATES, null, 2);

const CATEGORY_CONTEXT =
  "This PDF page is a Taiwanese (Traditional Chinese) 表1 地價區段勘查表 (district survey " +
  "table) for one price-zone. This call only verifies on-page draw coordinates for the " +
  "土地改良 (land improvement) category block's items — it does not read or extract any item's " +
  "printed content. This category prints as two rows: 建築基地改良 " +
  "(buildingSiteImprovement, 6 fixed checkboxes + 其他) and 農地改良 (farmlandImprovement, " +
  "9 fixed checkboxes + 其他).";

const ORDER_RULE =
  "buildingSiteImprovement's items must stay in this fixed printed order (6 entries): " +
  "整平或填挖基地, 開挖水溝, 水土保持, 鋪築道路, 埋設管道, 修築駁嵌. farmlandImprovement's " +
  "items must stay in this fixed printed order (9 entries): 耕地整理, 水土保持, 土壤改良, " +
  "修築農路, 灌溉, 排水, 防風, 防砂, 堤防. These orders match the content-extraction tool's " +
  "item orders exactly, so the two outputs can be matched up positionally afterward.";

const OTHER_WRAP_RULE =
  "Each group's 其他 checkbox and its free-text blank do not necessarily sit on the same line. " +
  "For farmlandImprovement specifically, the printed blank after 其他 is too narrow to fit on " +
  "the checkbox's own row and wraps onto a new line below it — look for where the underscore " +
  "blank actually has room and set textX/textY to that line, which will have a different Y " +
  "than checkY in that case. For buildingSiteImprovement the blank fits on the same line as its " +
  "checkbox, so textY should match checkY there.";

const VERIFY_INSTRUCTION =
  "For every group of coordinates, actually look at this page image and check each reference " +
  "number against what you see before answering — don't pattern-match the reference straight " +
  "into your output without looking. Before you output a group's coordinates, write a brief " +
  "sentence comparing it against the page: does 整平或填挖基地's checkbox really sit at roughly " +
  "checkX≈99, checkY≈344? Does farmlandImprovement's 其他 free-text blank really wrap onto a " +
  "line below its checkbox? If the printed layout still matches, copy the reference numbers " +
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
    OTHER_WRAP_RULE,
    "",
    VERIFY_INSTRUCTION,
    "",
    PLAUSIBILITY_RULE,
    "",
    MATCHES_REFERENCE_RULE,
    "",
    "Reference coordinates (verify each one against the actual page):",
    REFERENCE_COORDINATES_EXAMPLE,
  ].join("\n");
}

export { buildCoordinatesPrompt, REFERENCE_COORDINATES };
