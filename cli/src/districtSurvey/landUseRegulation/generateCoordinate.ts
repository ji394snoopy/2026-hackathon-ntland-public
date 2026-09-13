import { fileURLToPath } from "node:url";
import { generateCategoryCoordinates } from "../shared/generateCoordinateRunner.js";
import { buildLandUseRegulationCoordinatesTool } from "./coordinateTool.js";
import { buildCoordinatesPrompt } from "./coordinatePrompt.js";

const CATEGORY_LABEL = "landUseRegulation";
const OUTPUT_DIR = `./src/districtSurvey/${CATEGORY_LABEL}/output`;

async function generateLandUseRegulationCoordinates(): Promise<unknown> {
  return generateCategoryCoordinates({
    categoryLabel: CATEGORY_LABEL,
    outputDir: OUTPUT_DIR,
    tool: buildLandUseRegulationCoordinatesTool(),
    promptText: buildCoordinatesPrompt(),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateLandUseRegulationCoordinates().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { generateLandUseRegulationCoordinates };
