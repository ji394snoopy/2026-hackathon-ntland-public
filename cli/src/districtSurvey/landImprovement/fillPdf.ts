import { fileURLToPath } from "node:url";
import { PDFFont, PDFPage, rgb } from "pdf-lib";
import { readResultToolInput, runStandaloneFill } from "../shared/fillRunner.js";

const OUTPUT_DIR = "./src/districtSurvey/landImprovement/output";
const RESULT_JSON_PATH = `${OUTPUT_DIR}/result.json`;

const FONT_SIZE = 5.5;
const MARK_SIZE = 6;
const FILLED_MARK = "■";

// Content comes from result.json (generateSample.ts's or a real extraction run's raw response,
// unwrapped below) and draw positions come separately from coordinates-extracted.json
// (generateCoordinate.ts's plain tool-input output — see coordinateTool.ts/coordinatePrompt.ts)
// — two separate Bedrock tool calls, same split every districtSurvey category uses. This file
// just zips the two together at draw time.

const GROUP_KEYS = ["buildingSiteImprovement", "farmlandImprovement"] as const;

function fillMark(page: PDFPage, x: number, y: number, font: PDFFont) {
  page.drawText(FILLED_MARK, {
    x,
    y,
    size: MARK_SIZE,
    font,
    color: rgb(0, 0, 0),
  });
}

function fillCheckboxItem(page: PDFPage, item: any, row: any, font: PDFFont) {
  if (item.checked) fillMark(page, row.checkX, row.checkY, font);
}

function fillOther(page: PDFPage, other: any, row: any, font: PDFFont) {
  if (other.checked) fillMark(page, row.checkX, row.checkY, font);
  if (other.text) {
    page.drawText(other.text, {
      x: row.textX + 1,
      y: row.textY,
      size: FONT_SIZE,
      font,
      color: rgb(0, 0, 0),
    });
  }
}

function fillLandImprovementContent(
  page: PDFPage,
  font: PDFFont,
  coordinates: Record<string, any>,
  content?: Record<string, any>,
) {
  const input = content ?? readResultToolInput(RESULT_JSON_PATH);

  for (const key of GROUP_KEYS) {
    const items = input[key].items as any[];
    const rows = coordinates[key].items as any[];
    items.forEach((item, i) => {
      if (!rows[i]) {
        console.warn(`landImprovement: missing coordinates for ${key} item ${i}, skipping`);
        return;
      }
      fillCheckboxItem(page, item, rows[i], font);
    });
    fillOther(page, input[key].other, coordinates[key].other, font);
  }
}

export { fillLandImprovementContent };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runStandaloneFill({
    outputDir: OUTPUT_DIR,
    fillContent: fillLandImprovementContent,
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
