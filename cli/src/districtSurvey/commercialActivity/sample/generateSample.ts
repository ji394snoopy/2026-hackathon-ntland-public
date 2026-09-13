import { generateCategorySample } from "../../shared/generateSampleRunner.js";
import { buildCommercialActivityTool } from "./sampleTool.js";
import { buildGenerationPrompt } from "./samplePrompt.js";

const CATEGORY_LABEL = "commercialActivity";
const OUTPUT_DIR = `./src/districtSurvey/${CATEGORY_LABEL}/output`;

generateCategorySample({
  categoryLabel: CATEGORY_LABEL,
  outputDir: OUTPUT_DIR,
  tool: buildCommercialActivityTool(),
  promptText: buildGenerationPrompt(),
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
