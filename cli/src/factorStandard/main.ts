import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildPipeline } from "./pipeline.js";
import { invoke } from "../shared/claude.js";
import { extractResult, readPdfAsBase64 } from "../shared/tool.js";
import { CLAUDE_MODEL_ID, CLAUDE_MAX_TOKENS } from "../constants.js";

const OUTPUT_DIR = "./src/factorStandard/output";

async function main() {
  const [, , pdfPath] = process.argv;
  if (!pdfPath) {
    throw new Error("Usage: tsx src/factorStandard/main.ts <pdf-path>");
  }

  const { tool, promptText } = buildPipeline();
  console.log(`Reading ${pdfPath}...`);
  const pdfBase64 = readPdfAsBase64(pdfPath);

  console.log(`Invoking ${CLAUDE_MODEL_ID} (factorStandard)...`);
  const responseBody = await invoke({
    model: CLAUDE_MODEL_ID,
    pdfBase64,
    tool,
    promptText,
    maxTokens: CLAUDE_MAX_TOKENS,
  });

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(
    `${OUTPUT_DIR}/result.json`,
    JSON.stringify(responseBody, null, 2),
  );

  const toolInput = extractResult(responseBody, tool.name);
  writeFileSync(
    `${OUTPUT_DIR}/extracted.json`,
    JSON.stringify(toolInput, null, 2),
  );

  console.log(`Done. Inspect ${OUTPUT_DIR}/ for the result.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
