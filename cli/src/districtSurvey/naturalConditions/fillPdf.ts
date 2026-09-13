import { fileURLToPath } from "node:url";
import { PDFFont, PDFPage, rgb } from "pdf-lib";
import { readResultToolInput, runStandaloneFill } from "../shared/fillRunner.js";

const OUTPUT_DIR = "./src/districtSurvey/naturalConditions/output";
const RESULT_JSON_PATH = `${OUTPUT_DIR}/result.json`;

const FONT_SIZE = 5.5;

// Content comes from result.json (sample/generateSample.ts's raw response, unwrapped below) and
// draw positions come separately from coordinates-extracted.json (generateCoordinate.ts's plain
// tool-input output — see coordinateTool.ts/coordinatePrompt.ts) — two separate Bedrock tool
// calls, same split every sibling module uses. This file just zips the two together at draw time.
// All 7 items are plain blank-cell fields (no checkboxes anywhere in this category), so there's a
// single draw loop, same shape as landUseRegulation's fillPdf.ts.

const TEXT_FIELD_KEYS = [
  "sunlight",
  "view",
  "slope",
  "drainageQuality",
  "terrain",
  "windCondition",
  "soilQuality",
] as const;

// slope is type=number (parsed value+unit); the other 6 items are type=text (its own text
// field). raw is never read here — it exists only for the model's own consistency cross-check.
function fillTextField(page: PDFPage, item: any, row: any, font: PDFFont) {
  const value = item.value;
  const text: string =
    value.type === "number" ? `${value.value}${value.unit ?? ""}` : value.text;
  if (!text) return;
  page.drawText(text, { x: row.x, y: row.y, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
}

function fillNaturalConditionsContent(
  page: PDFPage,
  font: PDFFont,
  coordinates: Record<string, any>,
  content?: Record<string, any>,
) {
  const input = content ?? readResultToolInput(RESULT_JSON_PATH);

  for (const key of TEXT_FIELD_KEYS) {
    fillTextField(page, input[key], coordinates[key], font);
  }
}

export { fillNaturalConditionsContent };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runStandaloneFill({
    outputDir: OUTPUT_DIR,
    fillContent: fillNaturalConditionsContent,
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
