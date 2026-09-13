import { fileURLToPath } from "node:url";
import { generateCategoryCoordinates } from "../shared/generateCoordinateRunner.js";
import { buildPublicInfrastructureCoordinatesTool } from "./coordinateTool.js";
import { buildCoordinatesPrompt } from "./coordinatePrompt.js";

const CATEGORY_LABEL = "publicInfrastructure";
const OUTPUT_DIR = `./src/districtSurvey/${CATEGORY_LABEL}/output`;

async function generatePublicInfrastructureCoordinates(): Promise<unknown> {
  return generateCategoryCoordinates({
    categoryLabel: CATEGORY_LABEL,
    outputDir: OUTPUT_DIR,
    tool: buildPublicInfrastructureCoordinatesTool(),
    promptText: buildCoordinatesPrompt(),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generatePublicInfrastructureCoordinates().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { generatePublicInfrastructureCoordinates };
