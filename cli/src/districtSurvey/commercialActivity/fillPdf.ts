import { fileURLToPath } from "node:url";
import { PDFFont, PDFPage, rgb } from "pdf-lib";
import { readResultToolInput, runStandaloneFill } from "../shared/fillRunner.js";

const OUTPUT_DIR = "./src/districtSurvey/commercialActivity/output";
const RESULT_JSON_PATH = `${OUTPUT_DIR}/result.json`;

const FONT_SIZE = 5.5;
const CIRCLE_SIZE = 6;
const FILLED_MARK = "●";

// Content comes from result.json (sample/generateSample.ts's raw response, unwrapped below) and
// draw positions come separately from coordinates-extracted.json (generateCoordinate.ts's plain
// tool-input output — see coordinateTool.ts/coordinatePrompt.ts) — two separate Bedrock tool
// calls, same split every sibling module uses. This file just zips the two together at draw time.

const FACILITY_KEYS = [
  "departmentStore",
  "financialInstitution",
  "entertainmentFacility",
  "exhibitionCenterOrHotel",
] as const;

const TEXT_FIELD_KEYS = ["customerTraffic", "storeContiguity"] as const;

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

// 名稱/數量 sit on their own line above the checkbox/distance line (unlike environmentalPollution/
// specialFacilities, whose packed rows put name and checkboxes on the same line), so there's no
// overlap risk here regardless of name length — just draw each answer at its own reference
// position.
function fillFacilityRow(page: PDFPage, item: any, row: any, font: PDFFont) {
  const value = item.value;
  if (!value.isExist) return;

  page.drawText(value.name, {
    x: row.nameX,
    y: row.nameY,
    size: FONT_SIZE,
    font,
    color: rgb(0, 0, 0),
  });
  if (value.quantity !== undefined) {
    page.drawText(String(value.quantity), {
      x: row.quantityX,
      y: row.nameY,
      size: FONT_SIZE,
      font,
      color: rgb(0, 0, 0),
    });
  }
  if (value.inSection === true) fillCircle(page, row.inSectionX, row.distanceY, font);
  if (value.inSection === false) fillCircle(page, row.outSectionX, row.distanceY, font);
  if (value.distanceValue !== undefined) {
    drawRightAligned(page, String(value.distanceValue), row.distanceEndX, row.distanceY, font);
  }
}

// Both fields are type=text; raw is never read here — it exists only for the model's own
// consistency cross-check.
function fillTextField(page: PDFPage, item: any, row: any, font: PDFFont) {
  const text = item.value.text as string;
  if (!text) return;
  page.drawText(text, { x: row.x, y: row.y, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
}

function fillCommercialActivityContent(
  page: PDFPage,
  font: PDFFont,
  coordinates: Record<string, any>,
  content?: Record<string, any>,
) {
  const input = content ?? readResultToolInput(RESULT_JSON_PATH);

  for (const key of FACILITY_KEYS) {
    fillFacilityRow(page, input[key], coordinates[key], font);
  }

  for (const key of TEXT_FIELD_KEYS) {
    fillTextField(page, input[key], coordinates[key], font);
  }
}

export { fillCommercialActivityContent };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runStandaloneFill({
    outputDir: OUTPUT_DIR,
    fillContent: fillCommercialActivityContent,
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
