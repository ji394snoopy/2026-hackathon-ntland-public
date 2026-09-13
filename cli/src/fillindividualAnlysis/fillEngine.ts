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
) {
  if (cellCoords === undefined || value === undefined || value === null) return;
  if (isNameDistanceValue(value)) {
    const { name, distance, unit } = cellCoords.nameDistanceUnit;
    // name.x is that column's own fixed right edge (calibrated from 中山路's
    // manually-tuned position — see README); a short name like 中山路 sits flush
    // against distance the same way it always did. A longer facility name grows
    // leftward, shrinking only if it would cross name.leftBound (that sub-cell's real
    // left border).
    pushRightAlignedFit(out, name.x, name.leftBound, name.y, value.name, measureText);
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
  drawConditionValue(out, itemCoords.base, item.base?.value, measureText);

  const coordsByLabel = indexByLabel<any>(itemCoords.comparables);
  for (const comparable of item.comparables ?? []) {
    const cellCoords = coordsByLabel.get(comparable.label);
    if (cellCoords === undefined) {
      console.warn(`fillindividualAnlysis: no coordinates for comparable "${comparable.label}" of item "${item.itemKey}", skipping`);
      continue;
    }
    drawConditionValue(out, cellCoords, comparable.item?.value, measureText);
    if (comparable.delta !== undefined && comparable.delta !== null) {
      const { rightX, leftBound, y } = cellCoords.percent;
      pushRightAlignedFit(out, rightX, leftBound, y, formatSignedPercent(comparable.delta), measureText);
    }
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

  return out;
}

function renderDraws(page: PDFPage, font: PDFFont, instructions: DrawInstruction[]) {
  for (const instr of instructions) {
    page.drawText(instr.text, { x: instr.x, y: instr.y, size: instr.size, font, color: rgb(0, 0, 0) });
  }
}

export { planDraws, renderDraws, FONT_SIZE, formatSignedPercent };
export type { DrawInstruction };
