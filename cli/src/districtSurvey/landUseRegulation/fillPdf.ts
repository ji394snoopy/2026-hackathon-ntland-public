import { fileURLToPath } from "node:url";
import { PDFFont, PDFPage, rgb } from "pdf-lib";
import { readResultToolInput, runStandaloneFill } from "../shared/fillRunner.js";

const OUTPUT_DIR = "./src/districtSurvey/landUseRegulation/output";
const RESULT_JSON_PATH = `${OUTPUT_DIR}/result.json`;

const FONT_SIZE = 5.5;

// Content comes from result.json (sample/generateSample.ts's raw response, unwrapped below) and
// draw positions come separately from coordinates-extracted.json (generateCoordinate.ts's plain
// tool-input output — see coordinateTool.ts/coordinatePrompt.ts) — two separate Bedrock tool
// calls, same split every sibling module uses. This file just zips the two together at draw time.
// All 6 items are plain blank-cell fields (no checkboxes anywhere in this category), so there's a
// single draw loop, unlike every other sibling module's fillPdf.ts.

const TEXT_FIELD_KEYS = [
  "insideOutsideUrbanPlan",
  "zoningDesignation",
  "buildingCoverageRatio",
  "floorAreaRatio",
  "buildingProhibition",
  "buildingRestriction",
] as const;

// insideOutsideUrbanPlan's value has no text/value+unit field of its own — its only structured
// field is the selected enum, so the printed text is derived from that instead of raw.
const URBAN_PLAN_TEXT: Record<string, string> = {
  insideUrbanPlan: "都市計畫內",
  outsideUrbanPlan: "都市計畫外",
};

// buildingCoverageRatio/floorAreaRatio are type=number (parsed value+unit); insideOutsideUrbanPlan
// is type=singleChoice (derived from its selected enum); the rest are type=text (its own text
// field). raw is never read here — it exists only for the model's own consistency cross-check.
function fillTextField(page: PDFPage, item: any, row: any, font: PDFFont) {
  const value = item.value;
  const text: string =
    value.type === "number"
      ? `${value.value}${value.unit ?? ""}`
      : value.type === "singleChoice"
        ? URBAN_PLAN_TEXT[value.selected]!
        : value.text;
  if (!text) return;
  page.drawText(text, { x: row.x, y: row.y, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
}

function fillLandUseRegulationContent(
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

export { fillLandUseRegulationContent };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runStandaloneFill({
    outputDir: OUTPUT_DIR,
    fillContent: fillLandUseRegulationContent,
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
