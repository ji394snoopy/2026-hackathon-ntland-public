import { invoke } from "../shared/claude.js";
import { CLAUDE_MAX_TOKENS, CLAUDE_MODEL_ID } from "../shared/constants.js";
import type { CategoryMapping, ToolDefinition } from "../shared/tool.js";
import { extractResult } from "../shared/tool.js";
import { buildPrompt } from "./prompt.js";
import { buildExtractResultTool } from "./tool.js";

// Vocabulary JSON inlined by esbuild's json loader at build time (see
// infra/scripts/build-lambdas.mjs). pipeline.ts reads these four files via
// readFileSync("./references/...") relative to the CLI's cwd — which doesn't exist in a
// Lambda (cwd is /var/task) — so this handler inlines them and rebuilds the tool + prompt
// itself, leaving pipeline.ts untouched for the CLI path.
import categoryMapping from "../shared/references/zh_en_category_mapping.json" with { type: "json" };
import enumValueMapping from "../shared/references/zh_en_enum_value_mapping.json" with { type: "json" };
import gradeMapping from "../shared/references/zh_en_grade_mapping.json" with { type: "json" };
import itemMapping from "../shared/references/zh_en_item_mapping.json" with { type: "json" };

// AWS Lambda Function URL event/response shapes (subset). Inline so the handler carries
// no aws-lambda type dependency to bundle.
interface FunctionUrlEvent {
  body?: string | null;
  isBase64Encoded?: boolean;
}

interface JsonResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
} as const;

interface Pipeline {
  tool: ToolDefinition;
  promptText: string;
  vocabulary: Record<string, string>;
  categoryMapping: CategoryMapping;
  itemMapping: Record<string, string>;
  gradeMapping: Record<string, string>;
}

// Mirror of factorStandard/pipeline.ts buildPipeline(), but fed the inlined mappings
// instead of reading ./references/*.json off disk (unavailable in Lambda).
function buildPipelineFromInlined(): Pipeline {
  const tool = buildExtractResultTool(
    gradeMapping as Record<string, string>,
    categoryMapping as CategoryMapping,
    itemMapping as Record<string, string>,
  );
  const vocabulary = {
    ...(gradeMapping as Record<string, string>),
    ...(categoryMapping as CategoryMapping).regional,
    ...(categoryMapping as CategoryMapping).individual,
    ...(itemMapping as Record<string, string>),
    ...(enumValueMapping as Record<string, string>),
  };
  return {
    tool,
    promptText: buildPrompt(vocabulary),
    vocabulary,
    categoryMapping: categoryMapping as CategoryMapping,
    itemMapping: itemMapping as Record<string, string>,
    gradeMapping: gradeMapping as Record<string, string>,
  };
}

// The model is asked to copy an enum criteria's `value` from the vocabulary by memory,
// which it sometimes gets wrong (or skips) even when the `raw` Chinese text it also wrote
// down has an exact vocabulary entry. Since raw is what the model reads directly off the
// page, it's far more reliable than a recalled English key — so once extraction is done,
// deterministically overwrite every enum criteria's value with a plain dictionary lookup
// of its own raw text, ignoring whatever the model put there. Only raw text absent from
// the vocabulary keeps the model's (already-instructed-to-be-Chinese-text) fallback.
function applyEnumVocabulary(node: unknown, vocabulary: Record<string, string>): void {
  if (Array.isArray(node)) {
    for (const entry of node) applyEnumVocabulary(entry, vocabulary);
    return;
  }
  if (node === null || typeof node !== "object") return;

  const record = node as Record<string, unknown>;
  if (record.type === "enum" && typeof record.raw === "string" && typeof record.value === "string") {
    const mapped = vocabulary[record.raw];
    if (mapped !== undefined) record.value = mapped;
  }
  for (const value of Object.values(record)) applyEnumVocabulary(value, vocabulary);
}

interface FactorGroupNode {
  categories?: Array<{
    key?: unknown;
    raw?: unknown;
    items?: Array<{
      key?: unknown;
      raw?: unknown;
      grades?: Array<{ key?: unknown; raw?: unknown }>;
    }>;
  }>;
}

// category/item/grade `key` fields are each constrained to a small fixed set by the tool
// schema, so the model can never emit an invalid key — but it can (and sometimes does)
// emit a valid key that's simply the wrong one for this raw text (e.g. tagging the
// 其他影響因素 category with the landImprovement key instead of commercialActivity). raw
// is read straight off the page and is far more reliable than a recalled key, so — same
// reasoning as applyEnumVocabulary above — deterministically overwrite each key with a
// plain dictionary lookup of its own raw text wherever the vocabulary has an exact match.
function correctStructuralKeys(
  extracted: unknown,
  categoryMapping: CategoryMapping,
  itemMapping: Record<string, string>,
  gradeMapping: Record<string, string>,
): void {
  const result = extracted as {
    regionalFactors?: FactorGroupNode;
    individualFactors?: FactorGroupNode;
  } | null;
  if (!result) return;

  const groups: Array<[FactorGroupNode | undefined, Record<string, string>]> = [
    [result.regionalFactors, categoryMapping.regional],
    [result.individualFactors, categoryMapping.individual],
  ];

  for (const [group, catMap] of groups) {
    for (const category of group?.categories ?? []) {
      if (typeof category.raw === "string" && catMap[category.raw] !== undefined) {
        category.key = catMap[category.raw];
      }
      for (const item of category.items ?? []) {
        if (typeof item.raw === "string" && itemMapping[item.raw] !== undefined) {
          item.key = itemMapping[item.raw];
        }
        for (const grade of item.grades ?? []) {
          if (typeof grade.raw === "string" && gradeMapping[grade.raw] !== undefined) {
            grade.key = gradeMapping[grade.raw];
          }
        }
      }
    }
  }
}

function errorResponse(statusCode: number, message: string): JsonResponse {
  return { statusCode, headers: { ...JSON_HEADERS }, body: JSON.stringify({ error: message }) };
}

// The request body is the 評價基準明細表 (base-standard detail) PDF as base64. Accept
// either the raw base64 string as the whole body, or a JSON envelope { pdfBase64 }. A
// Function URL POST body may itself be base64-encoded (isBase64Encoded) when the client
// sends binary; here the client sends text (the PDF's own base64), so decode that outer
// layer to UTF-8 first, then interpret the result.
function parsePdfBase64(event: FunctionUrlEvent): string {
  const raw = event.body;
  if (!raw) throw new Error("Missing request body: POST the base-standard PDF as base64.");
  const text = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf-8") : raw;
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty request body: POST the base-standard PDF as base64.");

  // A JSON envelope starts with '{'; otherwise treat the whole body as the base64 string.
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as { pdfBase64?: string };
    if (!parsed.pdfBase64) throw new Error('JSON body must contain a "pdfBase64" field.');
    return parsed.pdfBase64.trim();
  }
  return trimmed;
}

/**
 * factorStandard as a Lambda Function URL handler (Bedrock, PDF in).
 *
 * POST body = the 評價基準明細表 PDF as base64 (raw string, or { pdfBase64 }) -> the
 * extracted grading/price-correction-rate table as structured JSON. Runs one Bedrock
 * (Claude on Bedrock) call with the PDF as a document block; credentials come from the
 * AWS default chain (the Lambda execution role's bedrock:InvokeModel permission). The
 * vocabulary files are inlined at build time. Bad/missing body -> 400; upstream/model
 * failure -> 502.
 */
export async function handler(event: FunctionUrlEvent): Promise<JsonResponse> {
  let pdfBase64: string;
  try {
    pdfBase64 = parsePdfBase64(event);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(400, message);
  }

  try {
    const {
      tool,
      promptText,
      vocabulary,
      categoryMapping: categories,
      itemMapping: items,
      gradeMapping: grades,
    } = buildPipelineFromInlined();
    const responseBody = await invoke({
      model: CLAUDE_MODEL_ID,
      pdfBase64,
      tool,
      promptText,
      maxTokens: CLAUDE_MAX_TOKENS,
    });
    const extracted = extractResult(responseBody, tool.name);
    applyEnumVocabulary(extracted, vocabulary);
    correctStructuralKeys(extracted, categories, items, grades);
    return { statusCode: 200, headers: { ...JSON_HEADERS }, body: JSON.stringify(extracted) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(502, message);
  }
}
