import { fileURLToPath } from "node:url";
import { generateCategoryCoordinates } from "../shared/generateCoordinateRunner.js";
import { buildSpecialFacilitiesCoordinatesTool } from "./coordinateTool.js";
import { buildCoordinatesPrompt } from "./coordinatePrompt.js";

const CATEGORY_LABEL = "specialFacilities";
const OUTPUT_DIR = `./src/districtSurvey/${CATEGORY_LABEL}/output`;

async function generateSpecialFacilitiesCoordinates(): Promise<unknown> {
  return generateCategoryCoordinates({
    categoryLabel: CATEGORY_LABEL,
    outputDir: OUTPUT_DIR,
    tool: buildSpecialFacilitiesCoordinatesTool(),
    promptText: buildCoordinatesPrompt(),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateSpecialFacilitiesCoordinates().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { generateSpecialFacilitiesCoordinates };
