// Local dev runner for district-survey-draft (表1 產草稿, Bedrock 純文字).
// NEEDS AWS creds + Bedrock access to jp.anthropic.claude-sonnet-4-6.
//
// Run:
//   cd infra
//   AWS_PROFILE=PROFILE AWS_REGION=us-east-1 \
//     node --import ./scripts/register-ts.mjs lambda/district-survey-draft/invoke-local.ts
//
// Endpoint: POST { category }  (or ?category=)。一次一類避免逾時。
//   category ∈ landImprovement | specialFacilities | commercialActivity | landUseRegulation
//           | trafficAndTransport | publicInfrastructure | environmentalPollution | naturalConditions
//   選填 facts:A 階段(facilities API)回的周邊設施,帶了草稿會 grounding 在真實設施上。
// 回:{ category, content: <該類可編輯 content JSON>, usedFacts }。改 category 就改下面 EXAMPLE。

import { postEvent, runLocal } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";

const EXAMPLE = { category: "landImprovement" };

await runLocal(handler, postEvent(EXAMPLE), "district-survey-draft");
