// Derived from input/district-survey.pdf's own text layer (via `pdftotext -bbox-layout`,
// converting poppler's top-left-origin word boxes to the PDF's bottom-left-origin space with
// y_bottomleft = 841.68 - yMax + 1.17 — the same formula every sibling module's reference
// coordinates use). poppler's text layer silently dropped the 名稱：/數量: words for
// exhibitionCenterOrHotel (confirmed by rendering the page at 300dpi and inspecting it visually),
// so that row's nameY is interpolated from entertainmentFacility's name-to-checkbox-line gap
// (~8.88pt) applied to its own checkbox line — everything else here comes directly from the text
// layer. Used two ways: as the reference example in the calibration prompt below
// (buildCoordinatesPrompt, real PDF, model verifies/corrects against the actual page), and copied
// verbatim into generated synthetic samples (generateSample.ts has no real page to check against,
// so it doesn't call the model at all for coordinates — there'd be nothing for it to verify).
const REFERENCE_COORDINATES = {
  departmentStore: {
    nameX: 390,
    nameY: 350.93,
    quantityX: 467.0,
    inSectionX: 372.43,
    outSectionX: 408.43,
    distanceEndX: 462.44,
    distanceY: 330.26,
  },
  financialInstitution: {
    nameX: 390,
    nameY: 321.62,
    quantityX: 467.0,
    inSectionX: 372.43,
    outSectionX: 408.37,
    distanceEndX: 462.28,
    distanceY: 300.98,
  },
  entertainmentFacility: {
    nameX: 390,
    nameY: 292.34,
    quantityX: 467.0,
    inSectionX: 372.43,
    outSectionX: 408.43,
    distanceEndX: 462.44,
    distanceY: 283.46,
  },
  exhibitionCenterOrHotel: {
    nameX: 390,
    nameY: 274.82,
    quantityX: 467.0,
    inSectionX: 372.43,
    outSectionX: 408.43,
    distanceEndX: 462.44,
    distanceY: 265.94,
  },
  customerTraffic: {
    x: 372.43,
    y: 253.1,
  },
  storeContiguity: {
    x: 372.43,
    y: 235.58,
  },
};

const REFERENCE_COORDINATES_EXAMPLE = JSON.stringify(REFERENCE_COORDINATES, null, 2);

const CATEGORY_CONTEXT =
  "This PDF page is a Taiwanese (Traditional Chinese) 表1 地價區段勘查表 (district survey " +
  "table) for one price-zone. This call only verifies on-page draw coordinates for the " +
  "工商活動 (commercial activity) category block's items — it does not read or extract any " +
  "item's printed content. This category has four 名稱：+數量+checkbox facility items " +
  "(百貨公司, 金融機構, 娛樂設施, 大型展示中心或觀光飯店) followed by two bare-text items " +
  "(顧客之通行量, 店鋪之毗連狀態).";

const VERIFY_INSTRUCTION =
  "For every group of coordinates, actually look at this page image and check each reference " +
  "number against what you see before answering — don't pattern-match the reference straight " +
  "into your output without looking. This category's reference coordinates were partly " +
  "interpolated rather than measured directly, so treat them as a rough starting point, not a " +
  "ground truth — look especially carefully at exhibitionCenterOrHotel's nameY. Before you " +
  "output a group's coordinates, write a brief sentence comparing it against the page: does " +
  "百貨公司's 名稱/數量 line really sit at roughly nameY≈351? Does 店鋪之毗連狀態's blank " +
  "answer cell really sit at roughly y≈236? If the printed layout still matches, copy the " +
  "reference numbers through unchanged. If it has genuinely shifted, replace them with what you " +
  "actually observe on the page.";

const PLAUSIBILITY_RULE =
  "This page is a standard-size printed form (roughly 595×842 points, A4). Every plausible " +
  "coordinate on it is a positive number under about 850. If a reference value is wildly " +
  "outside that range — in the thousands, millions, or negative — it is an error in the " +
  "reference itself, not a real position: do not copy it through. Instead estimate a " +
  "replacement from the item's position relative to the other reference coordinates around it " +
  "that do look plausible (e.g. same row, neighboring column), and set that group's " +
  "matchesReference to false.";

const COLUMN_ORDER_RULE =
  "Within any facility coordinate group, they must follow the page's left-to-right column " +
  "order: nameX must never be larger than quantityX, and inSectionX must never be larger than " +
  "outSectionX. Rows must also stay in top-to-bottom printed order: departmentStore's distanceY " +
  "must be the largest (highest on the page) among the four facility rows, followed by " +
  "financialInstitution, entertainmentFacility, then exhibitionCenterOrHotel, and " +
  "customerTraffic/storeContiguity's y values continue that same descending order below them. " +
  "If a reference value breaks either ordering, it is an error in the reference itself — " +
  "correct it using the surrounding positions as a guide, and set that group's " +
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
