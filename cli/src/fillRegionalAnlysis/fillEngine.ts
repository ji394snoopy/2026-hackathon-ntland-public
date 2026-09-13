import type { PDFFont, PDFPage } from "pdf-lib";
import { rgb } from "pdf-lib";

// Fills a 表5-1~5-5 影響地價區域因素分析明細表 PDF by matching comparison.json's
// content tree against a calibrated coordinates tree — both keyed by the raw printed
// Chinese label (categoryRaw/itemRaw/label), not by itemKey/categoryKey, since the
// non-commercial PDFs' items have no equivalent entry in factor-standard.json's
// vocabulary. See README.md for the coordinate schema this expects.

const FONT_SIZE = 6;

// comparison.json's categoryRaw/itemRaw are abbreviated summaries, not verbatim PDF
// text, and the abbreviation isn't applied one consistent way: some items drop the
// whole bracketed clause ("有無限制建築（整體開發...）" -> "有無限制建築"), others
// unwrap it into plain text ("都市計畫（內、外）" -> "都市計畫內外"). Two normalized
// variants per label cover both: the whole span removed, and just the bracket/comma
// punctuation removed (content kept). A match only needs one variant to agree on
// either side.
const BRACKET_SPAN = /[（(﹝][^）)﹞]*[）)﹞]/g;
const PUNCTUATION_CHARS = /[（）()﹝﹞、，]/g;

function normalizeVariants(raw: string): string[] {
  const spanRemoved = raw.replace(BRACKET_SPAN, "");
  const punctuationRemoved = raw.replace(PUNCTUATION_CHARS, "");
  return spanRemoved === punctuationRemoved ? [spanRemoved] : [spanRemoved, punctuationRemoved];
}

function indexByNormalizedLabel<T>(rows: T[], getRaw: (row: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    for (const variant of normalizeVariants(getRaw(row))) {
      if (variant) map.set(variant, row);
    }
  }
  return map;
}

function lookupByNormalizedLabel<T>(map: Map<string, T>, raw: string): T | undefined {
  for (const variant of normalizeVariants(raw)) {
    const hit = map.get(variant);
    if (hit) return hit;
  }
  return undefined;
}

interface DrawText {
  op: "text";
  x: number;
  y: number;
  text: string;
  size: number;
}

type DrawInstruction = DrawText;
type MeasureText = (text: string) => number;

// Item-level percent cells (修正百分比) are bare numbers, matching the reference
// example — the ％ character there is only ever drawn separately, on subtotal/total
// rows. No leading "+" for positive values (toFixed already signs negatives) — a
// positive value is left bare, by request.
function formatSignedValue(value: number): string {
  return value.toFixed(2);
}

// Full-width ％ (U+FF05), matching the character used in references/example-page-2.pdf
// — not the ASCII "%" — since subtotal/grand-total rows draw it themselves (it's not
// pre-printed on the blank template).
function formatSignedPercent(value: number): string {
  return `${formatSignedValue(value)}％`;
}

function pushLeftAligned(out: DrawInstruction[], x: number, y: number, text: string) {
  out.push({ op: "text", x, y, text, size: FONT_SIZE });
}

function pushCentered(
  out: DrawInstruction[],
  centerX: number,
  y: number,
  text: string,
  measureText: MeasureText,
) {
  out.push({ op: "text", x: centerX - measureText(text) / 2, y, text, size: FONT_SIZE });
}

function drawGradeCell(
  out: DrawInstruction[],
  cellCoords: { rateX: number; rateY: number; gradeCenterX: number; gradeCenterY: number } | undefined,
  grade: { rate?: number; raw?: string } | undefined,
  measureText: MeasureText,
) {
  if (cellCoords === undefined || grade === undefined) return;
  if (grade.rate !== undefined) {
    pushLeftAligned(out, cellCoords.rateX, cellCoords.rateY, String(grade.rate));
  }
  if (grade.raw !== undefined) {
    pushCentered(out, cellCoords.gradeCenterX, cellCoords.gradeCenterY, grade.raw, measureText);
  }
}

// Item-row percent cells: left-aligned, bare number.
function drawItemPercentCell(
  out: DrawInstruction[],
  cellCoords: { percentX: number; percentY: number } | undefined,
  value: number | undefined,
) {
  if (cellCoords === undefined || value === undefined) return;
  pushLeftAligned(out, cellCoords.percentX, cellCoords.percentY, formatSignedValue(value));
}

// Subtotal/grand-total percent cells: left-aligned, ％-suffixed.
function drawTotalPercentCell(
  out: DrawInstruction[],
  cellCoords: { percentX: number; percentY: number } | undefined,
  value: number | undefined,
) {
  if (cellCoords === undefined || value === undefined) return;
  pushLeftAligned(out, cellCoords.percentX, cellCoords.percentY, formatSignedPercent(value));
}

function indexByLabel<T extends { label: string }>(rows: T[] | undefined): Map<string, T> {
  return new Map((rows ?? []).map((row) => [row.label, row]));
}

function planItemRow(
  out: DrawInstruction[],
  item: any,
  itemCoords: any,
  measureText: MeasureText,
) {
  drawGradeCell(out, itemCoords.base, item.base, measureText);

  const coordsByLabel = indexByLabel<any>(itemCoords.comparables);
  for (const comparable of item.comparables ?? []) {
    const cellCoords = coordsByLabel.get(comparable.label);
    if (cellCoords === undefined) {
      console.warn(`fillRegionalAnlysis: no coordinates for comparable "${comparable.label}" of item "${item.itemRaw}", skipping`);
      continue;
    }
    drawGradeCell(out, cellCoords, comparable.grade, measureText);
    drawItemPercentCell(out, cellCoords, comparable.delta ?? undefined);
  }
}

function planCategory(
  out: DrawInstruction[],
  category: any,
  categoryCoords: any,
  measureText: MeasureText,
) {
  const itemCoordsByRaw = indexByNormalizedLabel<any>(categoryCoords.items ?? [], (row) => row.itemRaw);
  for (const item of category.items ?? []) {
    const itemCoords = lookupByNormalizedLabel(itemCoordsByRaw, item.itemRaw);
    if (itemCoords === undefined) {
      console.warn(`fillRegionalAnlysis: no coordinates for item "${item.itemRaw}" in category "${category.categoryRaw}", skipping`);
      continue;
    }
    planItemRow(out, item, itemCoords, measureText);
  }

  // category.totalBase (the 比準地 column's own category subtotal) is intentionally
  // never drawn — per explicit user instruction.
  const totalCoordsByLabel = indexByLabel<any>(categoryCoords.comparableTotals);
  for (const total of category.comparableTotals ?? []) {
    drawTotalPercentCell(out, totalCoordsByLabel.get(total.label), total.delta);
  }
}

function planDraws(content: any, coords: any, measureText: MeasureText): DrawInstruction[] {
  const out: DrawInstruction[] = [];

  if (content.sectionIdBase !== undefined && content.sectionIdBase !== null && coords.sectionIdBase) {
    pushLeftAligned(out, coords.sectionIdBase.x, coords.sectionIdBase.y, content.sectionIdBase);
  }
  const instanceIdCoordsByLabel = indexByLabel<any>(coords.comparableInstanceIds);
  for (const entry of content.comparableSectionIds ?? []) {
    const cellCoords = instanceIdCoordsByLabel.get(entry.label);
    if (cellCoords === undefined) continue;
    pushLeftAligned(out, cellCoords.x, cellCoords.y, entry.sectionId);
  }

  // 實例編號: not sourced from any comparison.json field — just however many
  // comparables the content actually has (content.comparableSectionIds.length),
  // numbered 1..n in order, matched positionally against coords.comparableSequenceNumbers
  // (not by label, since the point is the sequence itself, not whatever label string
  // each comparable happens to carry).
  const sequenceNumberSlots = coords.comparableSequenceNumbers ?? [];
  (content.comparableSectionIds ?? []).forEach((_entry: any, index: number) => {
    const cellCoords = sequenceNumberSlots[index];
    if (cellCoords === undefined) {
      console.warn(`fillRegionalAnlysis: no coordinates slot for comparable sequence number ${index + 1}, skipping`);
      return;
    }
    pushLeftAligned(out, cellCoords.x, cellCoords.y, String(index + 1));
  });

  const categoryCoordsByRaw = indexByNormalizedLabel<any>(coords.categories ?? [], (row) => row.categoryRaw);
  for (const category of content.categories ?? []) {
    const categoryCoords = lookupByNormalizedLabel(categoryCoordsByRaw, category.categoryRaw);
    if (categoryCoords === undefined) {
      console.warn(`fillRegionalAnlysis: no coordinates for category "${category.categoryRaw}", skipping`);
      continue;
    }
    planCategory(out, category, categoryCoords, measureText);
  }

  // content.totalScoreBase (the 比準地 column's own grand-total) is intentionally
  // never drawn — per explicit user instruction, same treatment as category.totalBase.
  const grandTotalCoordsByLabel = indexByLabel<any>(coords.comparableTotalScores);
  for (const total of content.comparableTotalScores ?? []) {
    drawTotalPercentCell(out, grandTotalCoordsByLabel.get(total.label), total.delta);
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
