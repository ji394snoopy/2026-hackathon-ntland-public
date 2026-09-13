import { fileURLToPath } from "node:url";
import { generateCategoryCoordinates } from "../shared/generateCoordinateRunner.js";
import { buildTrafficAndTransportCoordinatesTool } from "./coordinateTool.js";
import { buildCoordinatesPrompt } from "./coordinatePrompt.js";

const CATEGORY_LABEL = "trafficAndTransport";
const OUTPUT_DIR = `./src/districtSurvey/${CATEGORY_LABEL}/output`;

async function generateTrafficAndTransportCoordinates(): Promise<unknown> {
  return generateCategoryCoordinates({
    categoryLabel: CATEGORY_LABEL,
    outputDir: OUTPUT_DIR,
    tool: buildTrafficAndTransportCoordinatesTool(),
    promptText: buildCoordinatesPrompt(),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateTrafficAndTransportCoordinates().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { generateTrafficAndTransportCoordinates };
