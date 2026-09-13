import { fileURLToPath } from "node:url";
import { PDFFont, PDFPage, rgb } from "pdf-lib";
import { readResultToolInput, runStandaloneFill } from "../shared/fillRunner.js";

const OUTPUT_DIR = "./src/districtSurvey/environmentalPollution/output";
const RESULT_JSON_PATH = `${OUTPUT_DIR}/result.json`;

const FONT_SIZE = 5.5;
const CIRCLE_SIZE = 6;
const FILLED_MARK = "●";

// Every row in this category packs 名稱 and 本區段內/本區段外(距 M) onto a single line (nameY ===
// distanceY for all 5 items, confirmed against coordinatePrompt.ts's REFERENCE_COORDINATES), so a
// filled-in facility name can overlap the printed 本區段內/外 labels exactly like
// specialFacilities' funeralFacility/wasteFacility rows do. When 名稱 is set we whiteout that
// whole line and redraw name + labels + circles + distance ourselves, walking an x-cursor by
// measured glyph width so nothing overlaps regardless of name length.
const ROW_SEGMENT_GAP = 4;
const IN_SECTION_LABEL = "○本區段內";
const OUT_SECTION_LABEL = "○本區段外(距";
const DISTANCE_UNIT_LABEL = " M)";
// The printed template always reserves a minimum blank slot between "距" and "M)" for the
// distance digits, regardless of whether one's actually printed there — the redrawn (overflow)
// row should keep that same minimum, not collapse to the exact digit width (or nothing, when
// there's no distance at all), same as every fixed-position row's slot never shrinks either.
const MIN_DISTANCE_DIGITS = "00000";

// Content comes from result.json (sample/generateSample.ts's raw response, unwrapped below) and
// draw positions come separately from coordinates-extracted.json (generateCoordinate.ts's plain
// tool-input output — see coordinateTool.ts/coordinatePrompt.ts) — two separate Bedrock tool
// calls, same split specialFacilities/trafficAndTransport/publicInfrastructure use. This file
// just zips the two together at draw time.

const CHECKED_FACILITY_GROUP_KEYS = ["environmentalPollution"] as const;

function fillCircle(page: PDFPage, x: number, y: number, font: PDFFont) {
  page.drawText(FILLED_MARK, {
    x,
    y,
    size: CIRCLE_SIZE,
    font,
    color: rgb(0, 0, 0),
  });
}

function drawRightAligned(
  page: PDFPage,
  text: string,
  endX: number,
  y: number,
  font: PDFFont,
) {
  const width = font.widthOfTextAtSize(text, FONT_SIZE);
  page.drawText(text, {
    x: endX - width,
    y,
    size: FONT_SIZE,
    font,
    color: rgb(0, 0, 0),
  });
}

// Fast path: the name fits in the gap before the pre-printed 本區段內 checkbox, so nothing needs
// whiteout/redraw — draw the name on the blank space it belongs on and mark the pre-printed
// checkboxes/distance at their original fixed positions, exactly like every other field on this
// form. This keeps 本區段內/外 aligned with the rest of the page instead of always drifting to
// wherever the name happens to end.
function fillFixedPositionRow(page: PDFPage, value: any, row: any, font: PDFFont) {
  page.drawText(value.name, {
    x: row.nameX,
    y: row.nameY,
    size: FONT_SIZE,
    font,
    color: rgb(0, 0, 0),
  });
  if (value.inSection === true) fillCircle(page, row.inSectionX, row.distanceY, font);
  if (value.inSection === false) fillCircle(page, row.outSectionX, row.distanceY, font);
  if (value.distanceValue !== undefined) {
    drawRightAligned(page, String(value.distanceValue), row.distanceEndX, row.distanceY, font);
  }
}

// Fallback: the name is too long to fit before row.inSectionX — ignore the fixed reference
// positions entirely, whiteout the whole row, and lay name/labels/circles/distance out
// sequentially so nothing overlaps regardless of name length.
function fillOverflowRow(page: PDFPage, value: any, row: any, font: PDFFont, nameWidth: number) {
  const distanceText = value.distanceValue !== undefined ? String(value.distanceValue) : "";
  const inLabelWidth = font.widthOfTextAtSize(IN_SECTION_LABEL, FONT_SIZE);
  const outLabelWidth = font.widthOfTextAtSize(OUT_SECTION_LABEL, FONT_SIZE);
  const distanceWidth = font.widthOfTextAtSize(distanceText, FONT_SIZE);
  const minDistanceSlotWidth = font.widthOfTextAtSize(MIN_DISTANCE_DIGITS, FONT_SIZE);
  const distanceSlotWidth = Math.max(distanceWidth, minDistanceSlotWidth);
  const unitWidth = font.widthOfTextAtSize(DISTANCE_UNIT_LABEL, FONT_SIZE);
  const drawnWidth =
    nameWidth +
    ROW_SEGMENT_GAP +
    inLabelWidth +
    ROW_SEGMENT_GAP +
    outLabelWidth +
    distanceSlotWidth +
    unitWidth;
  // The original static labels/circles this replaces run through row.distanceEndX plus a
  // trailing "M)" — whiteout at least that far even if our redrawn content is narrower.
  const staticRegionWidth = row.distanceEndX - row.nameX + unitWidth + ROW_SEGMENT_GAP;
  const whiteoutWidth = Math.max(drawnWidth, staticRegionWidth);

  page.drawRectangle({
    x: row.nameX,
    y: row.nameY - 1.5,
    width: whiteoutWidth,
    height: FONT_SIZE + 1,
    color: rgb(1, 1, 1),
  });

  let x = row.nameX;
  const draw = (text: string) => {
    page.drawText(text, { x, y: row.nameY, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
  };

  draw(value.name);
  x += nameWidth + ROW_SEGMENT_GAP;

  const inSectionCircleX = x;
  draw(IN_SECTION_LABEL);
  x += inLabelWidth + ROW_SEGMENT_GAP;

  const outSectionCircleX = x;
  draw(OUT_SECTION_LABEL);
  x += outLabelWidth;

  // Right-align the digits within the reserved slot (like the fixed-position path aligns them
  // against row.distanceEndX) instead of drawing them flush against "距", so the slot's width
  // stays constant whether or not there's actually a distance to show.
  if (distanceText) {
    page.drawText(distanceText, {
      x: x + (distanceSlotWidth - distanceWidth),
      y: row.nameY,
      size: FONT_SIZE,
      font,
      color: rgb(0, 0, 0),
    });
  }
  x += distanceSlotWidth;
  draw(DISTANCE_UNIT_LABEL);

  if (value.inSection === true) fillCircle(page, inSectionCircleX, row.nameY, font);
  if (value.inSection === false) fillCircle(page, outSectionCircleX, row.nameY, font);
}

function fillPackedNameRow(page: PDFPage, value: any, row: any, font: PDFFont) {
  if (!value.isExist || !value.name) return;

  const nameWidth = font.widthOfTextAtSize(value.name, FONT_SIZE);
  const fitsBeforeInSection = row.nameX + nameWidth + ROW_SEGMENT_GAP <= row.inSectionX;

  if (fitsBeforeInSection) {
    fillFixedPositionRow(page, value, row, font);
  } else {
    fillOverflowRow(page, value, row, font, nameWidth);
  }
}

function fillCheckedFacilityRow(page: PDFPage, item: any, row: any, font: PDFFont) {
  const value = item.value;
  if (value.isExist) fillCircle(page, row.checkX, row.checkY, font);
  fillPackedNameRow(page, value, row, font);
}

function fillEnvironmentalPollutionContent(
  page: PDFPage,
  font: PDFFont,
  coordinates: Record<string, any>,
  content?: Record<string, any>,
) {
  const input = content ?? readResultToolInput(RESULT_JSON_PATH);

  for (const key of CHECKED_FACILITY_GROUP_KEYS) {
    const items = input[key].items as any[];
    const rows = coordinates[key] as any[];
    items.forEach((item, i) => {
      if (!rows[i]) {
        console.warn(`environmentalPollution: missing coordinates for ${key} item ${i}, skipping`);
        return;
      }
      fillCheckedFacilityRow(page, item, rows[i], font);
    });
  }
}

export { fillEnvironmentalPollutionContent };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runStandaloneFill({
    outputDir: OUTPUT_DIR,
    fillContent: fillEnvironmentalPollutionContent,
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
