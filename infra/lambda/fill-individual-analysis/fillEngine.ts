import type { PDFFont, PDFPage } from "pdf-lib";
import { rgb } from "pdf-lib";

// Fills src/fillindividualAnlysis/input/individual-asnlysis.pdf (表4 比較法調查估價表) by
// matching comparison.json's content tree against a calibrated coordinates tree, both keyed
// by categoryKey::itemKey — unlike fillRegionalAnlysis, this template's items line up 1:1
// with references/factor-standard.json's individualFactors vocabulary, so no raw-label
// matching/normalization is needed here. input/coordinates.json is now hand-maintained
// (see README's "How coordinates are derived") — extractCoordinates.ts/
// generateCoordinates.ts are no longer run against it, since that would overwrite the
// manual per-column name-field calibration this file's drawConditionValue relies on.

const FONT_SIZE = 6;

// itemKeys whose {name,distance,unit} name field wraps across multiple lines instead of
// pushRightAlignedFit's single-line shrink — per request, scoped to just these six 接近/
// 嫌惡設施 rows, whose facility names (nearest school/market/park/station/commercial
// district, or a list of noxious facilities) run long enough that shrinking alone becomes
// illegible. Every other item keeps the plain shrink-to-fit behavior.
const WRAPPABLE_NAME_ITEM_KEYS = new Set([
  "proximityToSchool",
  "proximityToMarket",
  "proximityToParkPlaza",
  "proximityToStation",
  "proximityToCommercialDistrict",
  "presenceOfNoxiousFacility",
]);

// Row spacing around these items is 13.08pt (see input/coordinates.json); two lines at
// NAME_WRAP_LINE_HEIGHT apart, centered on the row's y, spread 7pt total and leave a ~3pt
// buffer to the rows above/below.
const NAME_WRAP_MAX_LINES = 2;
const NAME_WRAP_LINE_HEIGHT = 7;
// Whenever a name wraps to multiple lines it also shrinks — a wrapped name never renders
// at the full single-line FONT_SIZE, always starting from this smaller size and backing
// off further (down to NAME_WRAP_MIN_SIZE) only if NAME_WRAP_MAX_LINES still isn't enough
// at that size.
const NAME_WRAP_START_SIZE = 5;
// Floor for the shrink-to-fit fallback below, so text never shrinks past legibility.
const NAME_WRAP_MIN_SIZE = FONT_SIZE * 0.4;
// Small nudge off leftBound (that sub-cell's real left border) so wrapped lines don't sit
// flush against it — a bit of breathing room from the border, not a hard column edge.
const NAME_WRAP_LEFT_PADDING = 4;

interface DrawText {
  op: "text";
  x: number;
  y: number;
  text: string;
  size: number;
}

type DrawInstruction = DrawText;
type MeasureText = (text: string) => number;

interface NameDistanceValue {
  name: string;
  distance: string;
  unit: string;
}

function isNameDistanceValue(value: unknown): value is NameDistanceValue {
  return typeof value === "object" && value !== null && "name" in value && "distance" in value;
}

// Full-width ％ (U+FF05), matching references/example-page-2.pdf's convention (reused by
// fillRegionalAnlysis's formatSignedPercent) rather than the ASCII "%". No leading "+" for
// positive values — toFixed already signs negatives, and a positive value is left bare, by
// request.
function formatSignedPercent(value: number): string {
  return `${value.toFixed(2)}％`;
}

// Thousands-grouped, no decimals (matches references/example-page-3.pdf's "184,763" /
// "212,958" convention for 土地正常單價/調整至估價基準日單價/試算價格/比準地比較價格).
function formatCurrency(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function pushLeftAligned(out: DrawInstruction[], x: number, y: number, text: string) {
  out.push({ op: "text", x, y, text, size: FONT_SIZE });
}

function pushCentered(out: DrawInstruction[], centerX: number, y: number, text: string, measureText: MeasureText) {
  out.push({ op: "text", x: centerX - measureText(text) / 2, y, text, size: FONT_SIZE });
}

// Right-aligned on rightX (never enlarged past FONT_SIZE); shrinks only when the text
// would cross leftBound — that sub-cell's real left border (see input/coordinates.json's
// nameDistanceUnit.name.leftBound, and percent.leftBound/rightX, both derived the same
// way: border-pixel scan of the blank template) — otherwise renders at full FONT_SIZE.
// Used for both the {name,distance,unit} cell's name field (a long facility name) and the
// 差異率 percent cell (a long signed percentage like "+104.75％") — distance/unit are
// never shrunk: their values are always short digits/units that fit their own sub-cells
// at full size.
function pushRightAlignedFit(
  out: DrawInstruction[],
  rightX: number,
  leftBound: number,
  y: number,
  text: string,
  measureText: MeasureText,
) {
  const width = measureText(text);
  const maxWidth = rightX - leftBound;
  const scale = maxWidth > 0 && width > maxWidth ? maxWidth / width : 1;
  const size = FONT_SIZE * scale;
  out.push({ op: "text", x: rightX - width * scale, y, text, size });
}

// Greedily splits text into lines that each fit maxWidth at the given font size, one
// character at a time (no word-splitting — these are Chinese facility names, which carry
// no spaces to break on). measureText always measures at FONT_SIZE; since embedded-font
// widths scale linearly with size, width-at-size is derived by scaling that measurement
// rather than re-measuring per candidate size.
function wrapToWidth(text: string, maxWidth: number, size: number, measureText: MeasureText): string[] {
  const scale = size / FONT_SIZE;
  const lines: string[] = [];
  let current = "";
  for (const ch of Array.from(text)) {
    const candidate = current + ch;
    if (current !== "" && measureText(candidate) * scale > maxWidth) {
      lines.push(current);
      current = ch;
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines;
}

// Wraps a long name across up to NAME_WRAP_MAX_LINES lines, each left-aligned on
// leftBound + NAME_WRAP_LEFT_PADDING (centered as a block vertically on centerY) instead of
// pushRightAlignedFit's single-line right-aligned shrink — multi-line text reads as a
// ragged-right paragraph, not lines dangling from a shared right edge. Short names that
// already fit on one line at FONT_SIZE are drawn exactly as pushRightAlignedFit would (no
// wrap, no shrink, still right-aligned — unchanged from before). Longer names always wrap
// AND shrink together, starting at NAME_WRAP_START_SIZE and backing off further, down to
// NAME_WRAP_MIN_SIZE, only if NAME_WRAP_MAX_LINES still isn't enough at that size.
function pushWrappedLeftAlignedFit(
  out: DrawInstruction[],
  rightX: number,
  leftBound: number,
  centerY: number,
  text: string,
  measureText: MeasureText,
) {
  const maxWidth = rightX - leftBound;
  if (maxWidth <= 0 || measureText(text) <= maxWidth) {
    pushRightAlignedFit(out, rightX, leftBound, centerY, text, measureText);
    return;
  }

  const startX = leftBound + NAME_WRAP_LEFT_PADDING;
  const wrapWidth = rightX - startX;
  let size = NAME_WRAP_START_SIZE;
  let lines = wrapToWidth(text, wrapWidth, size, measureText);
  while (lines.length > NAME_WRAP_MAX_LINES && size > NAME_WRAP_MIN_SIZE) {
    size -= 0.3;
    lines = wrapToWidth(text, wrapWidth, size, measureText);
  }

  const top = centerY + ((lines.length - 1) * NAME_WRAP_LINE_HEIGHT) / 2;
  lines.forEach((line, i) => {
    out.push({ op: "text", x: startX, y: top - i * NAME_WRAP_LINE_HEIGHT, text: line, size });
  });
}

function drawConditionValue(
  out: DrawInstruction[],
  cellCoords:
    | {
        condition: { x: number; y: number };
        nameDistanceUnit: {
          name: { x: number; y: number; leftBound: number };
          distance: { x: number; y: number };
          unit: { x: number; y: number };
        };
      }
    | undefined,
  value: unknown,
  measureText: MeasureText,
  wrapName: boolean,
) {
  if (cellCoords === undefined || value === undefined || value === null) return;
  if (isNameDistanceValue(value)) {
    const { name, distance, unit } = cellCoords.nameDistanceUnit;
    // name.x is that column's own fixed right edge (calibrated from 中山路's
    // manually-tuned position — see README); a short name like 中山路 sits flush
    // against distance the same way it always did. A longer facility name grows
    // leftward, shrinking only if it would cross name.leftBound (that sub-cell's real
    // left border) — or, for wrapName items (see WRAPPABLE_NAME_ITEM_KEYS), wrapping
    // across multiple left-aligned lines before shrinking.
    // An empty name (e.g. a comparable with no market/school/park/... nearby recorded) has
    // no facility to print — draw "-" instead of leaving the cell blank.
    const displayName = value.name === "" ? "-" : value.name;
    if (wrapName) {
      pushWrappedLeftAlignedFit(out, name.x, name.leftBound, name.y, displayName, measureText);
    } else {
      pushRightAlignedFit(out, name.x, name.leftBound, name.y, displayName, measureText);
    }
    pushCentered(out, distance.x, distance.y, value.distance, measureText);
    pushLeftAligned(out, unit.x, unit.y, value.unit);
    return;
  }
  pushCentered(out, cellCoords.condition.x, cellCoords.condition.y, String(value), measureText);
}

function indexByLabel<T extends { label: string }>(rows: T[] | undefined): Map<string, T> {
  return new Map((rows ?? []).map((row) => [row.label, row]));
}

function planItemRow(out: DrawInstruction[], item: any, itemCoords: any, measureText: MeasureText) {
  const wrapName = WRAPPABLE_NAME_ITEM_KEYS.has(item.itemKey);
  drawConditionValue(out, itemCoords.base, item.base?.value, measureText, wrapName);

  const coordsByLabel = indexByLabel<any>(itemCoords.comparables);
  for (const comparable of item.comparables ?? []) {
    const cellCoords = coordsByLabel.get(comparable.label);
    if (cellCoords === undefined) {
      console.warn(`fillindividualAnlysis: no coordinates for comparable "${comparable.label}" of item "${item.itemKey}", skipping`);
      continue;
    }
    drawConditionValue(out, cellCoords, comparable.item?.value, measureText, wrapName);
    if (comparable.delta !== undefined && comparable.delta !== null) {
      const { rightX, leftBound, y } = cellCoords.percent;
      pushRightAlignedFit(out, rightX, leftBound, y, formatSignedPercent(comparable.delta), measureText);
    }
  }
}

// 表4 下半部的價格鏈區塊:案號/估價基準日/比準地比較價格(單一值)+ 各比較標的自己的
// 土地正常單價/交易日期/調整百分率/調整至估價基準日單價/區域因素調整百分率/
// 調整百分率絕對值加總/價格形成因素之相近程度/試算價格/比較標的權重。座標見
// input/coordinates.json 的 priceSummary(案號/估價基準日 left-aligned;其餘 centered)。
// 缺值(undefined/null)的欄位略過不畫,不補假資料。
function planPriceSummary(out: DrawInstruction[], content: any, coords: any, measureText: MeasureText) {
  const summary = content?.priceSummary;
  const summaryCoords = coords?.priceSummary;
  if (!summary || !summaryCoords) return;

  if (summary.appraisalBaseDate != null && summaryCoords.appraisalBaseDate) {
    pushLeftAligned(out, summaryCoords.appraisalBaseDate.x, summaryCoords.appraisalBaseDate.y, String(summary.appraisalBaseDate));
  }
  if (summary.caseCode != null && summaryCoords.caseCode) {
    pushLeftAligned(out, summaryCoords.caseCode.x, summaryCoords.caseCode.y, String(summary.caseCode));
  }
  if (summary.benchmarkComparedPrice != null && summaryCoords.benchmarkComparedPrice) {
    const { x, y } = summaryCoords.benchmarkComparedPrice;
    pushCentered(out, x, y, formatCurrency(summary.benchmarkComparedPrice), measureText);
  }

  const coordsByLabel = indexByLabel<any>(summaryCoords.cases);
  for (const c of summary.cases ?? []) {
    const cc = coordsByLabel.get(c.label);
    if (cc === undefined) continue;
    if (c.normalPrice != null) pushCentered(out, cc.normalPrice.x, cc.normalPrice.y, formatCurrency(c.normalPrice), measureText);
    if (c.tradeDate != null) pushCentered(out, cc.tradeDate.x, cc.tradeDate.y, String(c.tradeDate), measureText);
    // dateAdjRate/regionalAdjRate share the item rows' own 差異率 sub-column (same
    // rightX/leftBound), so a longer signed percentage (e.g. "-3.50％", "10.25％") needs the
    // same right-aligned shrink-to-fit as item deltas instead of pushCentered, which would
    // overflow across the column's left border.
    if (c.dateAdjRate != null) {
      const { rightX, leftBound, y } = cc.dateAdjRate;
      pushRightAlignedFit(out, rightX, leftBound, y, formatSignedPercent(c.dateAdjRate), measureText);
    }
    if (c.adjustedPrice != null) pushCentered(out, cc.adjustedPrice.x, cc.adjustedPrice.y, formatCurrency(c.adjustedPrice), measureText);
    if (c.regionalAdjRate != null) {
      const { rightX, leftBound, y } = cc.regionalAdjRate;
      pushRightAlignedFit(out, rightX, leftBound, y, formatSignedPercent(c.regionalAdjRate), measureText);
    }
    if (c.absRateSum != null) pushCentered(out, cc.absRateSum.x, cc.absRateSum.y, formatSignedPercent(c.absRateSum), measureText);
    if (c.priceSimilarity != null) pushCentered(out, cc.priceSimilarity.x, cc.priceSimilarity.y, String(c.priceSimilarity), measureText);
    if (c.trialPrice != null) pushCentered(out, cc.trialPrice.x, cc.trialPrice.y, formatCurrency(c.trialPrice), measureText);
    if (c.weight != null) pushCentered(out, cc.weight.x, cc.weight.y, String(c.weight), measureText);
  }
}

function planOtherFactors(out: DrawInstruction[], coords: any, measureText: MeasureText) {
  pushCentered(out, coords.otherFactors.base.x, coords.otherFactors.base.y, "-", measureText);
  for (const comparable of coords.otherFactors.comparables ?? []) {
    pushCentered(out, comparable.condition.x, comparable.condition.y, "-", measureText);
    pushCentered(out, comparable.percent.x, comparable.percent.y, "-", measureText);
  }
}

function planDraws(content: any, coords: any, measureText: MeasureText): DrawInstruction[] {
  const out: DrawInstruction[] = [];

  if (content.sectionIdBase !== undefined && content.sectionIdBase !== null && coords.sectionIdBase) {
    pushLeftAligned(out, coords.sectionIdBase.x, coords.sectionIdBase.y, content.sectionIdBase);
  }
  if (content.locationBase !== undefined && content.locationBase !== null && coords.locationBase) {
    pushCentered(out, coords.locationBase.x, coords.locationBase.y, content.locationBase, measureText);
  }
  const identityCoordsByLabel = indexByLabel<any>(coords.comparableIdentities);
  for (const identity of content.comparableIdentities ?? []) {
    const cellCoords = identityCoordsByLabel.get(identity.label);
    if (cellCoords === undefined) continue;
    // 表4 header row's "實例編號：" is otherwise left blank — draw this comparable's own
    // number (identity.label, e.g. "1"/"2"/"3") right after the colon so each of the n
    // comparables present gets its own numbering, matching how many columns are filled.
    if (cellCoords.instanceNumber) {
      pushLeftAligned(out, cellCoords.instanceNumber.x, cellCoords.instanceNumber.y, identity.label);
    }
    if (identity.sectionId !== undefined && identity.sectionId !== null) {
      pushLeftAligned(out, cellCoords.sectionId.x, cellCoords.sectionId.y, identity.sectionId);
    }
    if (identity.location !== undefined && identity.location !== null) {
      pushCentered(out, cellCoords.location.x, cellCoords.location.y, identity.location, measureText);
    }
  }

  const itemCoordsByKey = new Map<string, any>(
    (coords.items ?? []).map((row: any) => [`${row.categoryKey}::${row.itemKey}`, row]),
  );
  for (const category of content.categories ?? []) {
    if ((category.items ?? []).length === 0) {
      planOtherFactors(out, coords, measureText);
      continue;
    }
    // category.totalBase/comparableTotals are intentionally never drawn — this PDF
    // template has no per-category subtotal row (see Decision Log).
    for (const item of category.items ?? []) {
      const itemCoords = itemCoordsByKey.get(`${item.categoryKey}::${item.itemKey}`);
      if (itemCoords === undefined) {
        console.warn(`fillindividualAnlysis: no coordinates for item "${item.categoryKey}::${item.itemKey}", skipping`);
        continue;
      }
      planItemRow(out, item, itemCoords, measureText);
    }
  }

  // content.totalScoreBase (比準地's own grand total) is intentionally never drawn — same
  // convention as fillRegionalAnlysis, confirmed against references/example-page-3.pdf's
  // own 合計 row (only comparable columns carry a value there).
  const grandTotalCoordsByLabel = indexByLabel<any>(coords.comparableTotalScores);
  for (const total of content.comparableTotalScores ?? []) {
    const cellCoords = grandTotalCoordsByLabel.get(total.label);
    if (cellCoords === undefined) continue;
    pushCentered(out, cellCoords.coord.x, cellCoords.coord.y, formatSignedPercent(total.delta), measureText);
  }

  planPriceSummary(out, content, coords, measureText);

  return out;
}

function renderDraws(page: PDFPage, font: PDFFont, instructions: DrawInstruction[]) {
  for (const instr of instructions) {
    page.drawText(instr.text, { x: instr.x, y: instr.y, size: instr.size, font, color: rgb(0, 0, 0) });
  }
}

export { planDraws, renderDraws, FONT_SIZE, formatSignedPercent, formatCurrency };
export type { DrawInstruction };
