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
// A name that doesn't fit its allotted width (next to a fixed 本區段內/外 control) is
// redrawn at this smaller size, wrapped onto additional lines below, rather than
// running into — or displacing — that fixed control.
const NAME_WRAP_FONT_SIZE = 4;
const nameLineHeight = (fontSize: number) => fontSize + 1.2;
// A wrapped name's first line is nudged up by this much (PDF points) so the multi-line
// block sits more centered on the row instead of hanging entirely below coords.nameY.
// Only applied when the name actually wraps (lines.length > 1); a single-line name is
// unaffected. Tune this value to taste; 0 disables the nudge.
const NAME_WRAP_Y_LIFT = 1.5;
// Long free text (e.g. meta.range's "沿...之第一種住宅區", 見 header.range) is drawn verbatim
// at a single x/y with no coordinates-driven layout box, so an unbroken long value would run
// off the page edge. Wrap onto additional lines below the original y once it exceeds this
// length, rather than adding a per-field wrap box to every coordinates.json leaf.
const TEXT_WRAP_LENGTH = 50;
const TEXT_LINE_HEIGHT = FONT_SIZE + 2;

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
type MeasureText = (text: string, size?: number) => number;

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

function wrapText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += maxLength) {
    lines.push(text.slice(i, i + maxLength));
  }
  return lines;
}

// Greedily breaks `text` into lines that each fit their width budget at `size`
// (`firstLineMaxWidth` for the first line, `maxWidth` for the rest) — a plain
// character-by-character break, since Chinese names carry no spaces to break on.
function greedyWrap(
  text: string,
  maxWidth: number,
  firstLineMaxWidth: number,
  measureText: MeasureText,
  size: number,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of text) {
    const candidate = line + ch;
    const limit = lines.length === 0 ? firstLineMaxWidth : maxWidth;
    if (line && measureText(candidate, size) > limit) {
      lines.push(line);
      line = ch;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Fits `text` into `firstLineMaxWidth` at FONT_SIZE when possible — no shrink, no wrap.
// Otherwise the name doesn't fit on one line as-is, so line breaks are decided at the
// NORMAL FONT_SIZE first (guaranteeing at least 2 lines, since the one-line check just
// failed), and only THEN is the smaller NAME_WRAP_FONT_SIZE applied to draw those same
// lines. Font size never re-drives the line count — shrinking can't collapse a name back
// onto one line, it only makes the multi-line block sit more comfortably in its box.
// `firstLineMaxWidth` (defaulting to `maxWidth`) lets a caller reserve room on the first
// line only, e.g. for a mark drawn at full size ahead of the name.
function wrapNameToWidth(
  text: string,
  maxWidth: number,
  measureText: MeasureText,
  firstLineMaxWidth: number = maxWidth,
): { lines: string[]; fontSize: number } {
  if (measureText(text, FONT_SIZE) <= firstLineMaxWidth) return { lines: [text], fontSize: FONT_SIZE };

  return {
    lines: greedyWrap(text, maxWidth, firstLineMaxWidth, measureText, FONT_SIZE),
    fontSize: NAME_WRAP_FONT_SIZE,
  };
}

function pushWrappedName(
  out: DrawInstruction[],
  x: number,
  y: number,
  lines: string[],
  fontSize: number,
) {
  const lineHeight = nameLineHeight(fontSize);
  lines.forEach((line, i) => {
    out.push({ op: "text", x, y: y - i * lineHeight, text: line, size: fontSize });
  });
}

// Whiteout region for a (possibly multi-line) wrapped name, matching the single-line
// rect the non-wrapped path already draws when lines.length === 1.
function nameWhiteoutRect(x: number, y: number, width: number, fontSize: number, lineCount: number): DrawRect {
  const lineHeight = nameLineHeight(fontSize);
  return {
    op: "rect",
    x,
    y: y - (lineCount - 1) * lineHeight - 1.5,
    width,
    height: (lineCount - 1) * lineHeight + fontSize + 1,
  };
}

function unwrapValue(content: any): Record<string, any> {
  if (content && typeof content === "object" && content.value && typeof content.value === "object") {
    return content.value;
  }
  return content ?? {};
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
    if (text) {
      wrapText(text, TEXT_WRAP_LENGTH).forEach((line, i) => {
        out.push({ op: "text", x: tx, y: ty - i * TEXT_LINE_HEIGHT, text: line, size: FONT_SIZE });
      });
    }
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

  if (coords.nameGapEndX !== undefined) {
    const markX = coords.checkX ?? coords.circleX;
    const markY = coords.checkY ?? coords.circleY;
    if (v.isExist) {
      const maxWidth = coords.nameGapEndX - markX;
      const markStr = mark(coords.markStyle);
      const markWidth = measureText(markStr, FONT_SIZE);
      const nameX = markX + markWidth;
      const nameMaxWidth = maxWidth - markWidth;
      const { lines, fontSize } = wrapNameToWidth(v.name, nameMaxWidth, measureText);
      const nameY = lines.length > 1 ? markY + NAME_WRAP_Y_LIFT : markY;
      out.push(nameWhiteoutRect(markX, nameY, maxWidth, fontSize, lines.length));
      out.push({ op: "text", x: markX, y: markY, text: markStr, size: FONT_SIZE });
      pushWrappedName(out, nameX, nameY, lines, fontSize);
    }
  } else if (coords.nameX !== undefined) {
    const packed = coords.inSectionX !== undefined && coords.nameY === coords.distanceY;
    if (v.isExist !== false && v.name) {
      if (!packed) {
        out.push({ op: "text", x: coords.nameX, y: coords.nameY, text: v.name, size: FONT_SIZE });
      } else {
        const maxWidth = coords.inSectionX - coords.nameX - ROW_SEGMENT_GAP;
        const { lines, fontSize } = wrapNameToWidth(v.name, maxWidth, measureText);
        const nameY = lines.length > 1 ? coords.nameY + NAME_WRAP_Y_LIFT : coords.nameY;
        if (lines.length > 1) out.push(nameWhiteoutRect(coords.nameX, nameY, maxWidth, fontSize, lines.length));
        pushWrappedName(out, coords.nameX, nameY, lines, fontSize);
      }
    }
  }

  if (coords.inSectionX !== undefined) {
    const inY = coords.inSectionY ?? coords.distanceY ?? coords.nameY ?? coords.checkY ?? coords.circleY;
    const outY = coords.outSectionY ?? coords.distanceY ?? coords.nameY ?? coords.checkY ?? coords.circleY;
    if (v.inSection === true) pushMark(out, coords.inSectionX, inY, coords.markStyle);
    if (v.inSection === false) pushMark(out, coords.outSectionX, outY, coords.markStyle);
  }
  if (coords.distanceEndX !== undefined && v.distanceValue !== undefined) {
    pushRightAligned(out, String(v.distanceValue), coords.distanceEndX, coords.distanceY, measureText);
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
