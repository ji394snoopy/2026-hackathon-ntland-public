import { CLAUDE_MAX_TOKENS, CLAUDE_MODEL_ID } from "../constants.js";
import { invokeTextOnly } from "../shared/claude.js";
import type { ToolDefinition } from "../shared/tool.js";
import { extractResult } from "../shared/tool.js";
import type { CategoryName } from "./shared/categories.js";
import { CATEGORY_NAMES } from "./shared/categories.js";

// Each of the 8 main-category blocks of 表1 地價區段勘查表 has its own tool builder and
// generation prompt under <category>/sample/. They're the same two names per file
// (buildXxxTool + buildGenerationPrompt), so alias each on import and wire them into a
// registry keyed by CategoryName. We use the sample/ generation path (invent a plausible
// draft) — NOT generateSampleRunner.ts, which writes files (read-only FS in Lambda).
import {
    buildGenerationPrompt as commercialActivityPrompt,
    buildGenerationPromptFromFacts as commercialActivityPromptFromFacts,
} from "./commercialActivity/sample/samplePrompt.js";
import { buildCommercialActivityTool } from "./commercialActivity/sample/sampleTool.js";
import {
    buildGenerationPrompt as environmentalPollutionPrompt,
    buildGenerationPromptFromFacts as environmentalPollutionPromptFromFacts,
} from "./environmentalPollution/sample/samplePrompt.js";
import { buildEnvironmentalPollutionTool } from "./environmentalPollution/sample/sampleTool.js";
import {
    buildGenerationPrompt as landImprovementPrompt,
    buildGenerationPromptFromFacts as landImprovementPromptFromFacts,
} from "./landImprovement/sample/samplePrompt.js";
import { buildLandImprovementTool } from "./landImprovement/sample/sampleTool.js";
import {
    buildGenerationPrompt as landUseRegulationPrompt,
    buildGenerationPromptFromFacts as landUseRegulationPromptFromFacts,
} from "./landUseRegulation/sample/samplePrompt.js";
import { buildLandUseRegulationTool } from "./landUseRegulation/sample/sampleTool.js";
import {
    buildGenerationPrompt as naturalConditionsPrompt,
    buildGenerationPromptFromFacts as naturalConditionsPromptFromFacts,
} from "./naturalConditions/sample/samplePrompt.js";
import { buildNaturalConditionsTool } from "./naturalConditions/sample/sampleTool.js";
import {
    buildGenerationPrompt as publicInfrastructurePrompt,
    buildGenerationPromptFromFacts as publicInfrastructurePromptFromFacts,
} from "./publicInfrastructure/sample/samplePrompt.js";
import { buildPublicInfrastructureTool } from "./publicInfrastructure/sample/sampleTool.js";
import { pickFactsForCategory, type NearbyFacilitiesFacts } from "./shared/facts.js";
import {
    buildGenerationPrompt as specialFacilitiesPrompt,
    buildGenerationPromptFromFacts as specialFacilitiesPromptFromFacts,
} from "./specialFacilities/sample/samplePrompt.js";
import { buildSpecialFacilitiesTool } from "./specialFacilities/sample/sampleTool.js";
import {
    buildGenerationPrompt as trafficAndTransportPrompt,
    buildGenerationPromptFromFacts as trafficAndTransportPromptFromFacts,
} from "./trafficAndTransport/sample/samplePrompt.js";
import { buildTrafficAndTransportTool } from "./trafficAndTransport/sample/sampleTool.js";

interface CategoryDraftBuilder {
  tool: () => ToolDefinition;
  // The no-facts (invent) prompt — used for backward compatibility when no facts are given.
  prompt: () => string;
  // The fact-aware prompt — receives this category's already-filtered facts slice. Each
  // builder itself falls back to invent when its slice is empty (see samplePrompt.ts).
  promptFromFacts: (facts: ReturnType<typeof pickFactsForCategory>) => string;
}

const REGISTRY: Record<CategoryName, CategoryDraftBuilder> = {
  landImprovement: {
    tool: buildLandImprovementTool,
    prompt: landImprovementPrompt,
    promptFromFacts: landImprovementPromptFromFacts,
  },
  specialFacilities: {
    tool: buildSpecialFacilitiesTool,
    prompt: specialFacilitiesPrompt,
    promptFromFacts: specialFacilitiesPromptFromFacts,
  },
  commercialActivity: {
    tool: buildCommercialActivityTool,
    prompt: commercialActivityPrompt,
    promptFromFacts: commercialActivityPromptFromFacts,
  },
  landUseRegulation: {
    tool: buildLandUseRegulationTool,
    prompt: landUseRegulationPrompt,
    promptFromFacts: landUseRegulationPromptFromFacts,
  },
  trafficAndTransport: {
    tool: buildTrafficAndTransportTool,
    prompt: trafficAndTransportPrompt,
    promptFromFacts: trafficAndTransportPromptFromFacts,
  },
  publicInfrastructure: {
    tool: buildPublicInfrastructureTool,
    prompt: publicInfrastructurePrompt,
    promptFromFacts: publicInfrastructurePromptFromFacts,
  },
  environmentalPollution: {
    tool: buildEnvironmentalPollutionTool,
    prompt: environmentalPollutionPrompt,
    promptFromFacts: environmentalPollutionPromptFromFacts,
  },
  naturalConditions: {
    tool: buildNaturalConditionsTool,
    prompt: naturalConditionsPrompt,
    promptFromFacts: naturalConditionsPromptFromFacts,
  },
};

// AWS Lambda Function URL event/response shapes (subset). Inline so the handler carries
// no aws-lambda type dependency to bundle.
interface FunctionUrlEvent {
  body?: string | null;
  isBase64Encoded?: boolean;
  queryStringParameters?: Record<string, string | undefined> | null;
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

function errorResponse(statusCode: number, message: string): JsonResponse {
  return { statusCode, headers: { ...JSON_HEADERS }, body: JSON.stringify({ error: message }) };
}

function isCategoryName(value: string): value is CategoryName {
  return (CATEGORY_NAMES as readonly string[]).includes(value);
}

interface ResolvedRequest {
  category: CategoryName;
  // The nearby-facilities context from A, if provided. POST body only (query strings can't
  // carry it). When absent, the handler runs the backward-compatible invent path.
  facts?: NearbyFacilitiesFacts;
}

// Resolve the requested category (and optional facts) from either a POST JSON body
// { category, facts? } (the body may be base64-encoded by the Function URL) or a
// ?category= query-string param. facts is only read from the POST body.
function resolveRequest(event: FunctionUrlEvent): ResolvedRequest {
  const fromQuery = event.queryStringParameters?.category;

  let fromBody: string | undefined;
  let facts: NearbyFacilitiesFacts | undefined;
  const raw = event.body;
  if (raw) {
    const text = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf-8") : raw;
    const trimmed = text.trim();
    if (trimmed) {
      const parsed = JSON.parse(trimmed) as { category?: string; facts?: NearbyFacilitiesFacts };
      fromBody = parsed.category;
      // Only accept a non-null object as facts; anything else is treated as "no facts".
      if (parsed.facts && typeof parsed.facts === "object") {
        facts = parsed.facts;
      }
    }
  }

  const category = (fromBody ?? fromQuery)?.trim();
  if (!category) {
    throw new Error(
      `Missing "category". POST { "category": "..." } or pass ?category=. One of: ${CATEGORY_NAMES.join(", ")}.`,
    );
  }
  if (!isCategoryName(category)) {
    throw new Error(
      `Unknown category "${category}". Expected one of: ${CATEGORY_NAMES.join(", ")}.`,
    );
  }
  return { category, facts };
}

/**
 * districtSurvey draft generator as a Lambda Function URL handler (Bedrock, text-only).
 *
 * POST { category, facts? } (or ?category=) -> a plausible, editable draft of that one
 * 表3 / 表1 main-category content block, as structured JSON. One Bedrock text-only call
 * per request; do one category at a time to stay well under the Function URL timeout (see
 * plan §3).
 *
 * When `facts` (the nearby-facilities result from the A / facilities API — see
 * API_INTEGRATION.md's NearbyFacilitiesResponse) is present, the draft is grounded in those
 * real surrounding facilities for this category. When `facts` is omitted, the handler runs
 * the original invent path with identical behaviour (backward compatible). `usedFacts` in
 * the response reports whether real facilities actually fed this category's draft.
 *
 * Credentials come from the AWS default chain (the execution role's bedrock:InvokeModel).
 * Bad JSON / unknown category -> 400; model failure -> 502.
 */
export async function handler(event: FunctionUrlEvent): Promise<JsonResponse> {
  let category: CategoryName;
  let facts: NearbyFacilitiesFacts | undefined;
  try {
    ({ category, facts } = resolveRequest(event));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(400, message);
  }

  try {
    const { tool, prompt, promptFromFacts } = REGISTRY[category];
    const toolDef = tool();

    // Route: with facts, pick this category's slice and use the fact-aware prompt; without,
    // use the invent prompt. usedFacts reflects whether the picked slice had any facilities
    // (an empty slice means the fact-aware builder itself fell back to invent).
    let promptText: string;
    let usedFacts = false;
    if (facts) {
      const categoryFacts = pickFactsForCategory(category, facts);
      promptText = promptFromFacts(categoryFacts);
      usedFacts = categoryFacts.facilities.length > 0;
    } else {
      promptText = prompt();
    }

    const responseBody = await invokeTextOnly({
      model: CLAUDE_MODEL_ID,
      tool: toolDef,
      promptText,
      maxTokens: CLAUDE_MAX_TOKENS,
    });
    const draft = extractResult(responseBody, toolDef.name);
    return {
      statusCode: 200,
      headers: { ...JSON_HEADERS },
      body: JSON.stringify({ category, content: draft, usedFacts }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(502, message);
  }
}
