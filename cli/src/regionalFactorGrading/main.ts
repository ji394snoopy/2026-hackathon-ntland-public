import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildPipeline } from "./pipeline.js";
import { resolveGrades } from "./resolveGrades.js";
import { invokeTextOnly } from "../shared/claude.js";
import { extractResult } from "../shared/tool.js";
import { CLAUDE_MODEL_ID, CLAUDE_MAX_TOKENS } from "../constants.js";
import type { EvidenceExtraction } from "./resolveGrades.js";

const OUTPUT_DIR = "./src/regionalFactorGrading/output";
const DEFAULT_SAMPLE_DATA_PATH =
  "./src/regionalFactorGrading/input/sample-data.json";

async function main() {
  const [, , sampleDataPath = DEFAULT_SAMPLE_DATA_PATH] = process.argv;

  const { tool, promptText, regionalFactors, meta, benchmark } =
    buildPipeline(sampleDataPath);

  console.log(`Invoking ${CLAUDE_MODEL_ID} (regionalFactorGrading)...`);
  const responseBody = await invokeTextOnly({
    model: CLAUDE_MODEL_ID,
    tool,
    promptText,
    maxTokens: CLAUDE_MAX_TOKENS,
  });

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(
    `${OUTPUT_DIR}/result.json`,
    JSON.stringify(responseBody, null, 2),
  );

  const toolInput = extractResult(responseBody, tool.name) as {
    extractions: EvidenceExtraction[];
  };
  const graded = resolveGrades(regionalFactors, toolInput.extractions);
  writeFileSync(
    `${OUTPUT_DIR}/graded.json`,
    JSON.stringify({ meta, benchmark, ...graded }, null, 2),
  );

  console.log(`Done. Inspect ${OUTPUT_DIR}/ for the result.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
