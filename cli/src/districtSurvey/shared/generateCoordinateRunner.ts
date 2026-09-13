import { mkdirSync, writeFileSync } from "node:fs";
import { invoke } from "../../shared/claude.js";
import { extractResult, readPdfAsBase64 } from "../../shared/tool.js";
import type { ToolDefinition } from "../../shared/tool.js";
import { CLAUDE_MODEL_ID, CLAUDE_MAX_TOKENS } from "../../constants.js";

const INPUT_PDF_PATH = "./input/district-survey.pdf";

interface GenerateCategoryCoordinatesParams {
  categoryLabel: string;
  outputDir: string;
  tool: ToolDefinition;
  promptText: string;
}

async function generateCategoryCoordinates(
  params: GenerateCategoryCoordinatesParams,
): Promise<unknown> {
  const { categoryLabel, outputDir, tool, promptText } = params;
  const pdfBase64 = readPdfAsBase64(INPUT_PDF_PATH);

  console.log(`Invoking ${CLAUDE_MODEL_ID} (${categoryLabel}, coordinate calibration)...`);
  const responseBody = await invoke({
    model: CLAUDE_MODEL_ID,
    pdfBase64,
    tool,
    promptText,
    maxTokens: CLAUDE_MAX_TOKENS,
    toolChoice: "any",
  });

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    `${outputDir}/coordinates-result.json`,
    JSON.stringify(responseBody, null, 2),
  );

  const toolInput = extractResult(responseBody, tool.name);
  writeFileSync(
    `${outputDir}/coordinates-extracted.json`,
    JSON.stringify(toolInput, null, 2),
  );

  console.log(`Done. Inspect ${outputDir}/ for the calibrated coordinates.`);
  return toolInput;
}

export { generateCategoryCoordinates };
