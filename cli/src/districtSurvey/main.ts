import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { CATEGORY_NAMES } from "./shared/categories.js";
import type { CategoryName } from "./shared/categories.js";
import { fillLandImprovementContent } from "./landImprovement/fillPdf.js";
import { fillSpecialFacilitiesContent } from "./specialFacilities/fillPdf.js";
import { fillCommercialActivityContent } from "./commercialActivity/fillPdf.js";
import { fillLandUseRegulationContent } from "./landUseRegulation/fillPdf.js";
import { fillTrafficAndTransportContent } from "./trafficAndTransport/fillPdf.js";
import { fillPublicInfrastructureContent } from "./publicInfrastructure/fillPdf.js";
import { fillEnvironmentalPollutionContent } from "./environmentalPollution/fillPdf.js";
import { fillNaturalConditionsContent } from "./naturalConditions/fillPdf.js";
import { loadData } from "./loadData.js";

const INPUT_PDF_PATH = "./src/districtSurvey/input/district-survey.pdf";
const SAMPLE_DATA_PATH = "./src/districtSurvey/input/sample-data.json";
const FONT_PATH = "./assets/ARPLUKaiTW-Book.ttf";
const OUTPUT_DIR = "./src/districtSurvey/output";
const COORDINATES_MERGED_PATH = `${OUTPUT_DIR}/coordinates-merged.json`;
const OUTPUT_PDF_PATH = `${OUTPUT_DIR}/district-survey-filled.pdf`;

type ContentFiller = (
  page: PDFPage,
  font: PDFFont,
  coordinates: Record<string, any>,
  content?: Record<string, any>,
) => void;

const FILLERS: Record<CategoryName, ContentFiller> = {
  landImprovement: fillLandImprovementContent,
  specialFacilities: fillSpecialFacilitiesContent,
  commercialActivity: fillCommercialActivityContent,
  landUseRegulation: fillLandUseRegulationContent,
  trafficAndTransport: fillTrafficAndTransportContent,
  publicInfrastructure: fillPublicInfrastructureContent,
  environmentalPollution: fillEnvironmentalPollutionContent,
  naturalConditions: fillNaturalConditionsContent,
};

function readMergedCoordinates(): Record<string, any> {
  return JSON.parse(readFileSync(COORDINATES_MERGED_PATH, "utf-8"));
}

// `data` mirrors readMergedCoordinates()'s per-category shape (keyed by the 8 category
// names) but for content instead of positions — a string is treated as a file path to
// read+parse (see loadData.ts), an object is used as-is, and omitting it entirely falls
// back to each fill<Category>Content's own per-category output/result.json disk read.
async function main(data?: Record<string, any> | string) {
  const pdfBytes = readFileSync(INPUT_PDF_PATH);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(readFileSync(FONT_PATH), {
    subset: false,
  });
  const page = pdfDoc.getPages()[0]!;
  const coordinates = readMergedCoordinates();
  const content = loadData(data);

  for (const name of CATEGORY_NAMES) {
    FILLERS[name](page, font, coordinates[name], content?.[name]);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_PDF_PATH, await pdfDoc.save());
  console.log(`Wrote ${OUTPUT_PDF_PATH}`);
}

export { main };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(SAMPLE_DATA_PATH).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
