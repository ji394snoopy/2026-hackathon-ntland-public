import { fileURLToPath } from "node:url";
import { generateCategoryCoordinates } from "../shared/generateCoordinateRunner.js";
import { buildNaturalConditionsCoordinatesTool } from "./coordinateTool.js";
import { buildCoordinatesPrompt } from "./coordinatePrompt.js";

const CATEGORY_LABEL = "naturalConditions";
const OUTPUT_DIR = `./src/districtSurvey/${CATEGORY_LABEL}/output`;

async function generateNaturalConditionsCoordinates(): Promise<unknown> {
  return generateCategoryCoordinates({
    categoryLabel: CATEGORY_LABEL,
    outputDir: OUTPUT_DIR,
    tool: buildNaturalConditionsCoordinatesTool(),
    promptText: buildCoordinatesPrompt(),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateNaturalConditionsCoordinates().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { generateNaturalConditionsCoordinates };
