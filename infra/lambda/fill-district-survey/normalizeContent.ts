// Normalizes the fill-district-survey request body before it reaches fillEngine.
//
// fillEngine's planDraws (./fillEngine.ts) expects the content-tree shape: top-level
// categories (landUseRegulation, trafficAndTransport, naturalConditions, landImprovement,
// publicInfrastructure, specialFacilities, environmentalPollution, commercialActivity,
// otherFactors, buildingCondition, landUseStatus) matching input/coordinates.json.
//
// Some callers instead post the appraiser-facing 表1 勘查表 shape directly
// ({ meta, survey: SurveyField[], benchmark } — see ../shared/db/types.ts's SurveyField
// and CaseSurveyRow), unreshaped — e.g. input/sample-data.json. That used to silently draw
// nothing: every content.landUseRegulation/trafficAndTransport/etc. lookup in planDraws
// came up undefined for a flat `survey` array, so the handler returned a 200 with an
// unfilled template instead of an error (the same bug fill-individual-analysis and
// fill-regional-analysis had — see their own normalizeContent.ts). This detects that shape
// and reshapes it via surveyToContentTree, the same mapper orchestration runs ahead of this
// lambda for the real 表1 case-store pipeline (see shared/db/mappers/survey.ts's own
// docs) — so a caller that posts the flat survey shape directly still gets a filled PDF
// instead of a blank one.

import { surveyToContentTree } from "../shared/db/mappers/index.js";
import type { CaseMeta, ComparisonCondition, SurveyField } from "../shared/db/types.js";

interface RawSurveyDataLike {
  meta?: CaseMeta;
  survey: SurveyField[];
  benchmark?: ComparisonCondition;
}

function isRawSurveyDataLike(value: unknown): value is RawSurveyDataLike {
  if (typeof value !== "object" || value === null) return false;
  return Array.isArray((value as Record<string, unknown>).survey);
}

/**
 * Reshapes a parsed request body into fillEngine's content-tree shape when it looks like
 * the flat `{ meta, survey, benchmark }` 表1 shape instead. Already-content-tree-shaped
 * input (no `survey` array) passes through unchanged.
 */
export function normalizeDistrictSurveyContent(
  content: Record<string, any> | undefined,
): Record<string, any> | undefined {
  if (content === undefined || content === null) return content;
  if (!isRawSurveyDataLike(content)) return content; // already fillEngine's content-tree shape

  return surveyToContentTree(content.survey, content.meta, content.benchmark) as Record<string, any>;
}
