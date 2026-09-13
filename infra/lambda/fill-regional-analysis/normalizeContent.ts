// Normalizes the fill-regional-analysis request body before it reaches fillEngine.
//
// fillEngine's planDraws (./fillEngine.ts) expects the content-tree shape: categories[]
// keyed by categoryRaw/itemRaw (the printed Chinese labels, matched via bracket-
// normalization — this PDF has no categoryKey/itemKey vocabulary like fill-individual-
// analysis does), each with base/comparables, plus top-level sectionIdBase/
// comparableSectionIds/comparableTotalScores.
//
// Some callers instead post produce-regional-factors's own output shape directly
// ({ regionalFactors: RegionalFactorRow[], regionalTotal, caseCode, comparisonCases,
// regionalFactorRemarks } — see ../produce-regional-factors), unreshaped. That used to
// silently draw nothing: every content.categories/comparableSectionIds/etc. lookup in
// planDraws came up undefined, so the handler returned a 200 with an unfilled template
// instead of an error (the same bug fill-individual-analysis had — see its
// normalizeContent.ts). This detects that shape and reshapes it via
// regionalRowsToAnalysisContent, the same mapper export-report/lambda.ts already runs
// ahead of this lambda in the real orchestrated pipeline — so a caller that posts
// produce-regional-factors's raw output directly (skipping export-report) still gets a
// filled PDF instead of a blank one.
//
// No field-name adapter is needed: the shared mapper's toGradeCell already emits
// { rate: rank, raw: grade } — `rate` being the 優劣等級序 number fillEngine.ts's
// drawGradeCell reads. (An earlier version of this file renamed a `rank` field onto `rate`
// after reshaping; the mapper has no `rank` field, so that rename wrote `rate: undefined`
// into every base/comparable cell and blanked the grade column. It also failed typecheck.)

import { regionalRowsToAnalysisContent } from "../shared/db/mappers/index.js";
import type { RegionalFactorRow } from "../shared/db/types.js";

interface ProduceRegionalFactorsLike {
  regionalFactors: RegionalFactorRow[];
  caseCode?: unknown;
}

function isProduceRegionalFactorsLike(
  value: unknown,
): value is ProduceRegionalFactorsLike {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>).regionalFactors)
  );
}

/**
 * Reshapes a parsed request body into fillEngine's content-tree shape when it looks like
 * produce-regional-factors's output instead. Already-content-tree-shaped input (has
 * `categories`) and anything unrecognized pass through unchanged.
 */
export function normalizeRegionalAnalysisContent(
  content: Record<string, any> | undefined,
): Record<string, any> | undefined {
  if (content === undefined || content === null) return content;
  if (Array.isArray(content.categories)) return content; // already fillEngine's content-tree shape
  if (!isProduceRegionalFactorsLike(content)) return content;

  const sectionIdBase =
    typeof content.caseCode === "string" ? content.caseCode : "";
  return regionalRowsToAnalysisContent(
    content.regionalFactors,
    sectionIdBase,
  ) as unknown as Record<string, any>;
}
