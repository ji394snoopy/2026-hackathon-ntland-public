import { mkdirSync, writeFileSync } from "node:fs";
import { invokeTextOnly } from "../../shared/claude.js";
import { extractResult } from "../../shared/tool.js";
import type { ToolDefinition } from "../../shared/tool.js";
import { CLAUDE_MODEL_ID, CLAUDE_MAX_TOKENS } from "../../constants.js";

interface GenerateCategorySampleParams {
  categoryLabel: string;
  outputDir: string;
  tool: ToolDefinition;
  promptText: string;
}

async function generateCategorySample(
  params: GenerateCategorySampleParams,
): Promise<unknown> {
  const { categoryLabel, outputDir, tool, promptText } = params;

  console.log(`Invoking ${CLAUDE_MODEL_ID} (${categoryLabel}, synthetic generation)...`);
  const responseBody = await invokeTextOnly({
    model: CLAUDE_MODEL_ID,
    tool,
    promptText,
    maxTokens: CLAUDE_MAX_TOKENS,
  });

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(`${outputDir}/result.json`, JSON.stringify(responseBody, null, 2));

  const toolInput = extractResult(responseBody, tool.name);
  writeFileSync(`${outputDir}/extracted.json`, JSON.stringify(toolInput, null, 2));

  console.log(`Done. Inspect ${outputDir}/ for the generated sample.`);
  return toolInput;
}

export { generateCategorySample };
