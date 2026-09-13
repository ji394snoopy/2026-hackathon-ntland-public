import { generateCategorySample } from "../../shared/generateSampleRunner.js";
import { buildNaturalConditionsTool } from "./sampleTool.js";
import { buildGenerationPrompt } from "./samplePrompt.js";

const CATEGORY_LABEL = "naturalConditions";
const OUTPUT_DIR = `./src/districtSurvey/${CATEGORY_LABEL}/output`;

generateCategorySample({
  categoryLabel: CATEGORY_LABEL,
  outputDir: OUTPUT_DIR,
  tool: buildNaturalConditionsTool(),
  promptText: buildGenerationPrompt(),
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
