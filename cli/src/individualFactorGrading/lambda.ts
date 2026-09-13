import { CLAUDE_MAX_TOKENS, CLAUDE_MODEL_ID } from "../constants.js";
import { invokeTextOnly } from "../shared/claude.js";
import type { ToolDefinition } from "../shared/tool.js";
import { extractResult } from "../shared/tool.js";
import type { Benchmark, Meta } from "./pipeline.js";
import { buildPrompt } from "./prompt.js";
import type { EvidenceExtraction, GradedResult, IndividualFactorsTree } from "./resolveGrades.js";
import { resolveGrades } from "./resolveGrades.js";
import { buildGradeIndividualFactorsTool } from "./tool.js";

// factor-standard.json inlined by esbuild's json loader at build time (see
// infra/scripts/build-lambdas.mjs). pipeline.ts reads it via readFileSync("./src/...")
// relative to the CLI's cwd — which doesn't exist in a Lambda (cwd is /var/task) — so this
// handler inlines the canonical reference (which carries BOTH regionalFactors and
// individualFactors) and rebuilds the tool + prompt itself, leaving pipeline.ts untouched
// for the CLI path. Exactly the pattern factorStandard/lambda.ts uses for its vocabulary.
import factorStandard from "../../references/factor-standard.json" with { type: "json" };

const INDIVIDUAL_FACTORS = (factorStandard as { individualFactors: IndividualFactorsTree })
  .individualFactors;

// AWS Lambda Function URL event/response shapes (subset). Inline so the handler carries no
// aws-lambda type dependency to bundle.
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

// The request carries this parcel's own case facts — the same shape the CLI's
// sample-data.json has ({ meta, survey, benchmark }). individualFactorGrading is
// benchmark-driven (resolveGrades takes the benchmark as a 3rd arg to derive each item's
// display value, and the model reads the benchmark facts), so `survey` is OPTIONAL here —
// but the CLI still passes the whole parsed sample-data (survey included) to the prompt, so
// we forward it verbatim when present to match CLI behavior. The grading table
// (個別因素評價基準明細表) is inlined, NOT taken from the request (stage 1).
interface GradingRequest {
  meta: Meta;
  survey?: unknown[];
  benchmark: Benchmark;
}

function errorResponse(statusCode: number, message: string): JsonResponse {
  return {
    statusCode,
    headers: { ...JSON_HEADERS },
    body: JSON.stringify({ error: message }),
  };
}

/**
 * Parse the POST body into { meta, benchmark }. A Function URL POST body may itself be
 * base64-encoded (isBase64Encoded) when the client sends binary; here the client sends
 * JSON text, so decode that outer layer first, then JSON.parse. Missing/invalid -> throw.
 */
function parseRequest(event: FunctionUrlEvent): GradingRequest {
  const raw = event.body;
  if (!raw) throw new Error("Missing request body: POST { meta, benchmark } as JSON.");
  const text = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf-8") : raw;
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty request body: POST { meta, benchmark } as JSON.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Request body is not valid JSON.");
  }
  const { meta, survey, benchmark } = (parsed ?? {}) as Partial<GradingRequest>;
  if (!meta || typeof meta !== "object") {
    throw new Error('Request body must contain a "meta" object (勘查資料 meta).');
  }
  if (!benchmark || typeof benchmark !== "object") {
    throw new Error('Request body must contain a "benchmark" object (比準地宗地條件).');
  }
  // survey is optional for individual grading (it grades off benchmark), but forward it when
  // present so the prompt matches the CLI's sample-data.
  return Array.isArray(survey) ? { meta, survey, benchmark } : { meta, benchmark };
}

interface Pipeline {
  tool: ToolDefinition;
  promptText: string;
}

// Mirror of pipeline.ts buildPipeline(), but fed the inlined individualFactors + the
// request's own parcel data instead of reading ./src/.../{factor-standard,sample-data}.json
// off disk (unavailable in Lambda). Leaves pipeline.ts (the CLI path) untouched.
function buildPipelineFromRequest(request: GradingRequest): Pipeline {
  const tool = buildGradeIndividualFactorsTool(INDIVIDUAL_FACTORS);
  // Feed the whole parcel object (meta + optional survey + benchmark) to the prompt, exactly
  // as the CLI passes its parsed sample-data.json. buildPrompt JSON.stringify's it wholesale.
  const promptText = buildPrompt(request, INDIVIDUAL_FACTORS);
  return { tool, promptText };
}

/**
 * individualFactorGrading (表四 個別因素評分) as a Lambda Function URL handler
 * (Bedrock, text-only — no PDF).
 *
 * POST body = { meta, benchmark } (this parcel's 勘查/宗地條件, same shape as the CLI's
 * sample-data.json) -> the graded result JSON: { meta, benchmark, individualFactors: {...},
 * totalScore } (identical to the CLI's graded.json). Runs one Bedrock (Claude on Bedrock)
 * call to extract evidence, then resolves grades in code from that evidence against the
 * inlined factor-standard grading table — passing benchmark through so each item carries its
 * own display value. Credentials come from the AWS default chain (the Lambda execution
 * role's bedrock:InvokeModel permission). Bad/missing body -> 400; upstream failure -> 502.
 *
 * The graded.json -> grading-shaped rows mapping (case-store shape) is applied by the
 * infra-side caller (shared/db/mappers.mapIndividualGraded), NOT here.
 */
export async function handler(event: FunctionUrlEvent): Promise<JsonResponse> {
  let request: GradingRequest;
  try {
    request = parseRequest(event);
  } catch (err) {
    return errorResponse(400, err instanceof Error ? err.message : String(err));
  }

  try {
    const { tool, promptText } = buildPipelineFromRequest(request);
    const responseBody = await invokeTextOnly({
      model: CLAUDE_MODEL_ID,
      tool,
      promptText,
      maxTokens: CLAUDE_MAX_TOKENS,
    });
    const toolInput = extractResult(responseBody, tool.name) as {
      extractions: EvidenceExtraction[];
    };
    const graded: GradedResult = resolveGrades(
      INDIVIDUAL_FACTORS,
      toolInput.extractions,
      request.benchmark,
    );
    return {
      statusCode: 200,
      headers: { ...JSON_HEADERS },
      body: JSON.stringify({ meta: request.meta, benchmark: request.benchmark, ...graded }),
    };
  } catch (err) {
    return errorResponse(502, err instanceof Error ? err.message : String(err));
  }
}
