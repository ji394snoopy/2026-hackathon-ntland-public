import { invokeTextOnly } from "../shared/claude.js";
import { CLAUDE_MAX_TOKENS, CLAUDE_MODEL_ID } from "../shared/constants.js";
import type { EvidenceExtraction, GradedResult, RegionalFactorsTree } from "../shared/grading/regionalFactorGrading/resolveGrades.js";
import { resolveGrades } from "../shared/grading/regionalFactorGrading/resolveGrades.js";
import type { ToolDefinition } from "../shared/tool.js";
import { extractResult } from "../shared/tool.js";
import type { Benchmark, Meta } from "./pipeline.js";
import { buildPrompt } from "./prompt.js";
import { buildGradeRegionalFactorsTool } from "./tool.js";

// factor-standard.json inlined by esbuild's json loader at build time (see
// infra/scripts/build-lambdas.mjs). pipeline.ts reads it via readFileSync("./src/...")
// relative to the CLI's cwd — which doesn't exist in a Lambda (cwd is /var/task) — so this
// handler inlines the canonical reference (which carries BOTH regionalFactors and
// individualFactors) and rebuilds the tool + prompt itself, leaving pipeline.ts untouched
// for the CLI path. Exactly the pattern factorStandard/lambda.ts uses for its vocabulary.
import factorStandard from "../shared/references/factor-standard.json" with { type: "json" };

const REGIONAL_FACTORS = (factorStandard as { regionalFactors: RegionalFactorsTree })
  .regionalFactors;

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
// sample-data.json has ({ meta, survey, benchmark }). 區域因素評分 grades off the district
// survey (地價區段勘查表, the `survey` array), so it MUST be forwarded into the prompt just
// as the CLI does (pipeline.ts under-declares SampleData as { meta, benchmark }, but
// buildPrompt JSON.stringify's the whole parsed object at runtime, survey included). The
// grading table (區域因素評價基準明細表) is inlined, NOT taken from the request (stage 1; a
// request-supplied factorStandard to use a factor-standard-store version is a later step —
// plan §2.3/§5).
interface GradingRequest {
  meta: Meta;
  // 地價區段勘查表 fields (SurveyField[]-shaped); passed through verbatim to the prompt.
  // Optional so a caller can still POST { meta, benchmark } — but regional grading will be
  // starved of evidence without it, so we warn (see parseRequest).
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
  if (!Array.isArray(survey) || survey.length === 0) {
    // 區域因素評分 reads the district survey, not the benchmark — without it the model has
    // almost nothing to grade off. Reject rather than silently returning empty grades.
    throw new Error(
      'Request body must contain a non-empty "survey" array (地價區段勘查表 fields). ' +
        "區域因素評分 grades off the survey, not the benchmark.",
    );
  }
  return { meta, survey, benchmark };
}

interface Pipeline {
  tool: ToolDefinition;
  promptText: string;
}

// Mirror of pipeline.ts buildPipeline(), but fed the inlined regionalFactors + the
// request's own parcel data instead of reading ./src/.../{factor-standard,sample-data}.json
// off disk (unavailable in Lambda). Leaves pipeline.ts (the CLI path) untouched.
function buildPipelineFromRequest(request: GradingRequest): Pipeline {
  const tool = buildGradeRegionalFactorsTool(REGIONAL_FACTORS);
  // Feed the whole parcel object (meta + survey + benchmark) to the prompt, exactly as the
  // CLI passes its parsed sample-data.json. buildPrompt JSON.stringify's it wholesale.
  const promptText = buildPrompt(request, REGIONAL_FACTORS);
  return { tool, promptText };
}

/**
 * regionalFactorGrading (表五 區域因素評分) as a Lambda Function URL handler
 * (Bedrock, text-only — no PDF).
 *
 * POST body = { meta, benchmark } (this parcel's 勘查資料, same shape as the CLI's
 * sample-data.json) -> the graded result JSON: { meta, benchmark, regionalFactors: {...},
 * totalScore } (identical to the CLI's graded.json). Runs one Bedrock (Claude on Bedrock)
 * call to extract evidence, then resolves grades in code from that evidence against the
 * inlined factor-standard grading table. Credentials come from the AWS default chain (the
 * Lambda execution role's bedrock:InvokeModel permission). Bad/missing body -> 400;
 * upstream/model failure -> 502.
 *
 * The graded.json -> RegionalFactorRow[] mapping (frontend/case-store shape) is applied by
 * the infra-side caller (shared/db/mappers.mapRegionalGradedToRows), NOT here — cli must
 * not depend on the infra frontend-key crosswalk.
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
    const graded: GradedResult = resolveGrades(REGIONAL_FACTORS, toolInput.extractions);
    return {
      statusCode: 200,
      headers: { ...JSON_HEADERS },
      body: JSON.stringify({ meta: request.meta, benchmark: request.benchmark, ...graded }),
    };
  } catch (err) {
    return errorResponse(502, err instanceof Error ? err.message : String(err));
  }
}
