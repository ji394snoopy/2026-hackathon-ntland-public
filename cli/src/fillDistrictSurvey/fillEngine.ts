import type { PDFFont, PDFPage } from "pdf-lib";
import { rgb } from "pdf-lib";

// A generic recursive engine that fills the district-survey PDF by structurally
// matching content data against a coordinates tree — dispatching purely on shape
// (arrays, `.items` groups, and flat "slot bag" leaf objects recognized by field-name
// convention), never on category identity. See src/fillDistrictSurvey/README.md for
// the full rule table this implements and the real per-category shapes it was
// verified against.

const FONT_SIZE = 5.5;
const MARK_SIZE = 6;
const CIRCLE_MARK = "●";
const SQUARE_MARK = "■";
const ROW_SEGMENT_GAP = 4;
const IN_SECTION_LABEL = "○本區段內";
const OUT_SECTION_LABEL = "○本區段外(距";
const DISTANCE_UNIT_LABEL = " M)";
const MIN_DISTANCE_DIGITS = "00000";

const SLOT_KEYS = [
  "x",
  "y",
  "textX",
  "textY",
  "labelX",
  "labelY",
  "valueEndX",
  "valueY",
  "quantityX",
  "distanceEndX",
  "distanceY",
  "checkX",
  "checkY",
  "circleX",
  "circleY",
  "nameX",
  "nameY",
  "nameGapEndX",
  "inSectionX",
  "outSectionX",
  "inSectionY",
  "outSectionY",
  "densityOptionX",
  "densityOptionY",
] as const;

interface DrawText {
  op: "text";
  x: number;
  y: number;
  text: string;
  size: number;
}

interface DrawRect {
  op: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
}

type DrawInstruction = DrawText | DrawRect;
type MeasureText = (text: string) => number;

function isSlotBag(coords: Record<string, any>): boolean {
  return SLOT_KEYS.some((key) => coords[key] !== undefined);
}

function mark(markStyle: unknown): string {
  return markStyle === "square" ? SQUARE_MARK : CIRCLE_MARK;
}

function pushMark(out: DrawInstruction[], x: number, y: number, markStyle: unknown) {
  out.push({ op: "text", x, y, text: mark(markStyle), size: MARK_SIZE });
}

function pushRightAligned(
  out: DrawInstruction[],
  text: string,
  endX: number,
  y: number,
  measureText: MeasureText,
) {
  out.push({ op: "text", x: endX - measureText(text), y, text, size: FONT_SIZE });
}

// v.text is used verbatim when present; type=number/measurement are formatted
// mechanically (string interpolation, no vocabulary). Anything else (e.g.
// type=singleChoice) has no mechanical derivation — the caller must supply .text
// directly, or nothing is drawn.
function resolveText(v: Record<string, any>): string | undefined {
  if (v.text) return v.text;
  if (v.type === "number") return `${v.value}${v.unit ?? ""}`;
  if (v.type === "measurement") return `${v.label} ${v.value}${v.unit ?? ""}`;
  return undefined;
}

function unwrapValue(content: any): Record<string, any> {
  if (content && typeof content === "object" && content.value && typeof content.value === "object") {
    return content.value;
  }
  return content ?? {};
}

function drawOverflowRow(
  out: DrawInstruction[],
  v: Record<string, any>,
  coords: Record<string, any>,
  nameWidth: number,
  measureText: MeasureText,
) {
  const distanceText = v.distanceValue !== undefined ? String(v.distanceValue) : "";
  const inLabelWidth = measureText(IN_SECTION_LABEL);
  const outLabelWidth = measureText(OUT_SECTION_LABEL);
  const distanceWidth = measureText(distanceText);
  const minDistanceSlotWidth = measureText(MIN_DISTANCE_DIGITS);
  const distanceSlotWidth = Math.max(distanceWidth, minDistanceSlotWidth);
  const unitWidth = measureText(DISTANCE_UNIT_LABEL);
  const drawnWidth =
    nameWidth +
    ROW_SEGMENT_GAP +
    inLabelWidth +
    ROW_SEGMENT_GAP +
    outLabelWidth +
    distanceSlotWidth +
    unitWidth;
  const staticRegionWidth = coords.distanceEndX - coords.nameX + unitWidth + ROW_SEGMENT_GAP;
  const whiteoutWidth = Math.max(drawnWidth, staticRegionWidth);

  out.push({
    op: "rect",
    x: coords.nameX,
    y: coords.nameY - 1.5,
    width: whiteoutWidth,
    height: FONT_SIZE + 1,
  });

  let x = coords.nameX;
  out.push({ op: "text", x, y: coords.nameY, text: v.name, size: FONT_SIZE });
  x += nameWidth + ROW_SEGMENT_GAP;

  const inSectionCircleX = x;
  out.push({ op: "text", x, y: coords.nameY, text: IN_SECTION_LABEL, size: FONT_SIZE });
  x += inLabelWidth + ROW_SEGMENT_GAP;

  const outSectionCircleX = x;
  out.push({ op: "text", x, y: coords.nameY, text: OUT_SECTION_LABEL, size: FONT_SIZE });
  x += outLabelWidth;

  if (distanceText) {
    out.push({
      op: "text",
      x: x + (distanceSlotWidth - distanceWidth),
      y: coords.nameY,
      text: distanceText,
      size: FONT_SIZE,
    });
  }
  x += distanceSlotWidth;
  out.push({ op: "text", x, y: coords.nameY, text: DISTANCE_UNIT_LABEL, size: FONT_SIZE });

  if (v.inSection === true) pushMark(out, inSectionCircleX, coords.nameY, coords.markStyle);
  if (v.inSection === false) pushMark(out, outSectionCircleX, coords.nameY, coords.markStyle);
}

function leafDraw(
  content: any,
  coords: Record<string, any>,
  measureText: MeasureText,
  out: DrawInstruction[],
) {
  const v = unwrapValue(content);

  const tx = coords.x ?? coords.textX;
  const ty = coords.y ?? coords.textY;
  if (tx !== undefined && ty !== undefined) {
    const text = resolveText(v);
    if (text) out.push({ op: "text", x: tx, y: ty, text, size: FONT_SIZE });
  }

  if (coords.labelX !== undefined && v.label) {
    out.push({ op: "text", x: coords.labelX, y: coords.labelY, text: v.label, size: FONT_SIZE });
  }

  if (coords.valueEndX !== undefined && v.value !== undefined) {
    pushRightAligned(out, String(v.value), coords.valueEndX, coords.valueY, measureText);
  }

  if (coords.quantityX !== undefined && v.quantity !== undefined) {
    out.push({ op: "text", x: coords.quantityX, y: coords.nameY, text: String(v.quantity), size: FONT_SIZE });
  }

  if (coords.densityOptionX !== undefined && v.densityLevel !== undefined) {
    const dx = coords.densityOptionX[v.densityLevel];
    const dy = coords.densityOptionY[v.densityLevel];
    if (dx !== undefined) pushMark(out, dx, dy, coords.markStyle);
  }

  let handledInSectionAndDistance = false;

  if (coords.nameGapEndX !== undefined) {
    const markX = coords.checkX ?? coords.circleX;
    const markY = coords.checkY ?? coords.circleY;
    if (v.isExist) {
      out.push({
        op: "rect",
        x: markX,
        y: markY - 1.5,
        width: coords.nameGapEndX - markX,
        height: FONT_SIZE + 1,
      });
      out.push({ op: "text", x: markX, y: markY, text: `${mark(coords.markStyle)}${v.name}`, size: FONT_SIZE });
    }
  } else if (coords.nameX !== undefined) {
    const packed = coords.inSectionX !== undefined && coords.nameY === coords.distanceY;
    if (v.isExist !== false && v.name) {
      if (!packed) {
        out.push({ op: "text", x: coords.nameX, y: coords.nameY, text: v.name, size: FONT_SIZE });
      } else {
        const nameWidth = measureText(v.name);
        const fits = coords.nameX + nameWidth + ROW_SEGMENT_GAP <= coords.inSectionX;
        if (fits) {
          out.push({ op: "text", x: coords.nameX, y: coords.nameY, text: v.name, size: FONT_SIZE });
        } else {
          handledInSectionAndDistance = true;
          drawOverflowRow(out, v, coords, nameWidth, measureText);
        }
      }
    }
  }

  if (!handledInSectionAndDistance) {
    if (coords.inSectionX !== undefined) {
      const inY = coords.inSectionY ?? coords.distanceY ?? coords.nameY ?? coords.checkY ?? coords.circleY;
      const outY = coords.outSectionY ?? coords.distanceY ?? coords.nameY ?? coords.checkY ?? coords.circleY;
      if (v.inSection === true) pushMark(out, coords.inSectionX, inY, coords.markStyle);
      if (v.inSection === false) pushMark(out, coords.outSectionX, outY, coords.markStyle);
    }
    if (coords.distanceEndX !== undefined && v.distanceValue !== undefined) {
      pushRightAligned(out, String(v.distanceValue), coords.distanceEndX, coords.distanceY, measureText);
    }
  }

  if (coords.checkX !== undefined && coords.nameGapEndX === undefined) {
    if (v.checked === true || v.isExist === true) {
      pushMark(out, coords.checkX, coords.checkY, coords.markStyle);
    }
  }
}

function walk(
  content: any,
  coords: any,
  measureText: MeasureText,
  out: DrawInstruction[],
  path: string,
) {
  if (coords === undefined || coords === null) return;

  if (Array.isArray(coords)) {
    const items = Array.isArray(content) ? content : content?.items;
    coords.forEach((row, i) => {
      const item = items?.[i];
      if (item === undefined) {
        console.warn(`fillDistrictSurvey: missing content for ${path}[${i}], skipping`);
        return;
      }
      walk(item, row, measureText, out, `${path}[${i}]`);
    });
    return;
  }

  if (typeof coords !== "object") return;

  if (Array.isArray(coords.items)) {
    const contentItems = content?.items;
    coords.items.forEach((row: any, i: number) => {
      const item = contentItems?.[i];
      if (item === undefined) {
        console.warn(`fillDistrictSurvey: missing content for ${path}.items[${i}], skipping`);
        return;
      }
      walk(item, row, measureText, out, `${path}.items[${i}]`);
    });
    if (coords.other !== undefined) {
      walk(content?.other, coords.other, measureText, out, `${path}.other`);
    }
    return;
  }

  if (isSlotBag(coords)) {
    leafDraw(content, coords, measureText, out);
    return;
  }

  for (const key of Object.keys(coords)) {
    walk(content?.[key], coords[key], measureText, out, `${path}.${key}`);
  }
}

function planDraws(
  content: any,
  coords: any,
  measureText: MeasureText,
  path = "root",
): DrawInstruction[] {
  const out: DrawInstruction[] = [];
  walk(content, coords, measureText, out, path);
  return out;
}

function renderDraws(page: PDFPage, font: PDFFont, instructions: DrawInstruction[]) {
  for (const instr of instructions) {
    if (instr.op === "rect") {
      page.drawRectangle({
        x: instr.x,
        y: instr.y,
        width: instr.width,
        height: instr.height,
        color: rgb(1, 1, 1),
      });
    } else {
      page.drawText(instr.text, { x: instr.x, y: instr.y, size: instr.size, font, color: rgb(0, 0, 0) });
    }
  }
}

export { planDraws, renderDraws, FONT_SIZE };
export type { DrawInstruction };
