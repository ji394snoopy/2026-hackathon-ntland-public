import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { FONT_SIZE, planDraws, renderDraws } from "./fillEngine.js";
import { buildPipeline, buildGroupedPipeline, GROUPS } from "./pipeline.js";
import type { CategoryPipeline, GroupPipeline } from "./pipeline.js";
import { applyQuantityDefaults } from "./applyQuantityDefaults.js";
import { roundDistanceValues } from "./roundDistanceValues.js";
import { rawToolInputBuffer } from "./rawToolInputBuffer.js";
import { isGrammarTooLargeError, CATEGORY_KEYS } from "./tool.js";
import type { CategoryKey } from "./tool.js";
import { invokeTextOnly } from "../shared/claude.js";
import { extractResult } from "../shared/tool.js";
import { CLAUDE_MODEL_ID } from "../constants.js";

// Bedrock reserves `Total input tokens + max_tokens` against the account's TPM quota the instant
// a request is sent (only replenished down to actual usage once the response completes — see
// https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-token-burndown.md), so requesting
// constants.ts's CLAUDE_MAX_TOKENS (128,000, the model's ceiling) on every one of this pipeline's
// 6 sequential calls reserves ~132,000 tokens per call for an actual output that's consistently
// under 600 (see committed output/result-*.json usage stats) — the single biggest source of TPM
// throttling in this pipeline, well ahead of the shared-instruction-block caching above. Sized at
// roughly 15x the largest observed output_tokens (523) rather than the model max.
const MAX_TOKENS = 8_000;
const CATEGORY_MAX_TOKENS: Partial<Record<CategoryKey, number>> = {
  commercialActivity: 128_000,
};

function maxTokensFor(categoryKey: CategoryKey): number {
  return CATEGORY_MAX_TOKENS[categoryKey] ?? MAX_TOKENS;
}

const MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));
const INPUT_PDF_PATH = `${MODULE_DIR}input/district-survey.pdf`;
const COORDINATES_PATH = `${MODULE_DIR}input/coordinates.json`;
const DEFAULT_RAW_DATA_PATH = `${MODULE_DIR}input/sample-data.json`;
const FONT_PATH = "./assets/ARPLUKaiTW-Book.ttf";
const OUTPUT_DIR = `${MODULE_DIR}output`;
const OUTPUT_PDF_PATH = `${OUTPUT_DIR}/district-survey-filled.pdf`;

// `rawData` accepts an in-memory raw district-survey object (meta/survey/benchmark, see
// input/sample-data.json), a path to a JSON file matching that shape, or (default) this
// module's own worked example at input/sample-data.json — same convention as the old
// content-tree `data` parameter this replaces.
function loadRawData(rawData?: Record<string, any> | string): Record<string, any> {
  if (rawData === undefined) return JSON.parse(readFileSync(DEFAULT_RAW_DATA_PATH, "utf-8"));
  if (typeof rawData === "string") return JSON.parse(readFileSync(rawData, "utf-8"));
  return rawData;
}

// If a call is cut off by max_tokens, the tool_use block's `.input` collapses to `{}` and the
// saved result-*.json alone gives no clue why — dump the SDK's raw (possibly unparseable)
// streamed JSON buffer alongside it so a truncation can actually be diagnosed instead of guessed
// at (see rawToolInputBuffer.ts).
function logIfTruncated(responseBody: Record<string, any>, toolName: string, outputPathBase: string, label: string): void {
  if (responseBody.stop_reason !== "max_tokens") return;
  console.warn(
    `fillDistrictSurvey: ${label} hit stop_reason "max_tokens" (${responseBody.usage?.output_tokens} output ` +
      "tokens) — tool input is likely truncated/incomplete.",
  );
  const toolBlock = (responseBody.content ?? []).find(
    (block: any) => block?.type === "tool_use" && block?.name === toolName,
  );
  const raw = rawToolInputBuffer(toolBlock);
  if (raw !== undefined) {
    writeFileSync(`${outputPathBase}-raw-truncated.txt`, raw);
  }
}

async function invokeCategory(categoryPipeline: CategoryPipeline, note?: string): Promise<Record<string, any>> {
  const { categoryKey, tool, promptText } = categoryPipeline;
  console.log(`Invoking ${CLAUDE_MODEL_ID} (fillDistrictSurvey: ${categoryKey}${note ? `, ${note}` : ""})...`);
  const responseBody = await invokeTextOnly({
    model: CLAUDE_MODEL_ID,
    tool,
    promptText,
    maxTokens: maxTokensFor(categoryKey),
  });
  const outputPathBase = `${OUTPUT_DIR}/result-${categoryKey}`;
  logIfTruncated(responseBody, tool.name, outputPathBase, categoryKey);
  writeFileSync(`${outputPathBase}.json`, JSON.stringify(responseBody, null, 2));
  return { [categoryKey]: extractResult(responseBody, tool.name) };
}

async function invokeGroup(groupPipeline: GroupPipeline): Promise<Record<string, any>> {
  const { categoryKeys, tool, promptText } = groupPipeline;
  const groupLabel = categoryKeys.join("+");
  console.log(`Invoking ${CLAUDE_MODEL_ID} (fillDistrictSurvey: group ${groupLabel})...`);
  const responseBody = await invokeTextOnly({ model: CLAUDE_MODEL_ID, tool, promptText, maxTokens: MAX_TOKENS });
  const outputPathBase = `${OUTPUT_DIR}/result-group-${groupLabel}`;
  logIfTruncated(responseBody, tool.name, outputPathBase, `group ${groupLabel}`);
  writeFileSync(`${outputPathBase}.json`, JSON.stringify(responseBody, null, 2));
  return extractResult(responseBody, tool.name) as Record<string, any>;
}

// Feeds the raw district-survey facts to Claude for semantic parsing into the fixed
// content-tree shape planDraws()/coordinates.json expect. Categories in GROUPS are sent as one
// merged Bedrock call per group; every other category (not listed in any GROUPS entry) is sent
// solo, exactly as before — see pipeline.ts's GROUPS comment for why only that one merge is
// attempted rather than guessing at further ones. Calls run sequentially (not in parallel) to
// avoid bursting Bedrock with simultaneous requests, then merged into a single content tree. A
// merged group call that still hits Bedrock's "compiled grammar is too large" error falls back
// to the original one-call-per-category path for just that group's categories, rather than
// failing the whole run — see tool.ts's isGrammarTooLargeError.
async function extractContent(rawSurveyData: Record<string, any>): Promise<Record<string, any>> {
  const groupPipelines = buildGroupedPipeline(rawSurveyData);
  const categoryPipelines = buildPipeline(rawSurveyData);
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const groupedCategoryKeys = new Set(GROUPS.flat());
  const soloCategoryKeys = CATEGORY_KEYS.filter((categoryKey) => !groupedCategoryKeys.has(categoryKey));

  const content: Record<string, any> = {};
  for (const groupPipeline of groupPipelines) {
    try {
      Object.assign(content, await invokeGroup(groupPipeline));
    } catch (err) {
      if (!isGrammarTooLargeError(err)) throw err;
      console.warn(
        `fillDistrictSurvey: group ${groupPipeline.categoryKeys.join("+")} hit the grammar-too-large ` +
          "wall, falling back to per-category calls for this group...",
      );
      for (const categoryKey of groupPipeline.categoryKeys) {
        const categoryPipeline = categoryPipelines.find((p) => p.categoryKey === categoryKey)!;
        Object.assign(content, await invokeCategory(categoryPipeline, "fallback after grammar-too-large"));
      }
    }
  }

  for (const categoryKey of soloCategoryKeys) {
    const categoryPipeline = categoryPipelines.find((p) => p.categoryKey === categoryKey)!;
    Object.assign(content, await invokeCategory(categoryPipeline));
  }

  if (content.commercialActivity) {
    content.commercialActivity = applyQuantityDefaults(content.commercialActivity);
  }
  roundDistanceValues(content);
  writeFileSync(`${OUTPUT_DIR}/content.json`, JSON.stringify(content, null, 2));
  return content;
}

async function main(rawData?: Record<string, any> | string): Promise<void> {
  const pdfBytes = readFileSync(INPUT_PDF_PATH);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(readFileSync(FONT_PATH), { subset: false });
  const page = pdfDoc.getPages()[0]!;

  const coordinates = JSON.parse(readFileSync(COORDINATES_PATH, "utf-8"));
  const rawSurveyData = loadRawData(rawData);
  const content = await extractContent(rawSurveyData);
  const measureText = (text: string) => font.widthOfTextAtSize(text, FONT_SIZE);

  const instructions = planDraws(content, coordinates, measureText);
  renderDraws(page, font, instructions);

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_PDF_PATH, await pdfDoc.save());
  console.log(`Wrote ${OUTPUT_PDF_PATH}`);
}

export { main };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
