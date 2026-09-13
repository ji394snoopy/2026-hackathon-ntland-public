// Normalizes the fill-individual-analysis request body before it reaches fillEngine.
//
// fillEngine's planDraws (./fillEngine.ts) expects the content-tree shape: categories[]
// of items[] keyed by categoryKey/itemKey, each with base/comparables, plus top-level
// sectionIdBase/locationBase/comparableIdentities/comparableTotalScores.
//
// Some callers instead post produce-comparison's own output envelope
// ({ comparison, comparisonForm, computed } — see ../produce-comparison/mergeComparison.ts)
// or its comparisonForm alone ({ benchmark, cases, ... } — shared/db/types.ts's
// ComparisonForm), unreshaped. Both used to silently draw nothing: every content.categories/
// comparableIdentities/etc. lookup in planDraws came up undefined, so the handler returned
// a 200 with an unfilled template instead of an error (the same bug invoke-local.ts had —
// see its fix). This detects that shape and reshapes it via comparisonFormToContentTree,
// the same mapper export-report/lambda.ts already runs ahead of this lambda in the real
// orchestrated pipeline — so a caller that posts produce-comparison's raw output directly
// (skipping export-report) still gets a filled PDF instead of a blank one.

import { comparisonFormToContentTree } from "../shared/db/mappers/index.js";

interface ComparisonFormLike {
  benchmark: Record<string, unknown>;
  cases: unknown[];
}

function isComparisonFormLike(value: unknown): value is ComparisonFormLike {
  if (typeof value !== "object" || value === null) return false;
  const { benchmark, cases } = value as Record<string, unknown>;
  return typeof benchmark === "object" && benchmark !== null && Array.isArray(cases);
}

/**
 * Reshapes a parsed request body into fillEngine's content-tree shape when it looks like
 * produce-comparison's output instead. Already-content-tree-shaped input (has `categories`)
 * and anything unrecognized pass through unchanged.
 */
export function normalizeIndividualAnalysisContent(
  content: Record<string, any> | undefined,
): Record<string, any> | undefined {
  if (content === undefined || content === null) return content;
  if (Array.isArray(content.categories)) return content; // already fillEngine's content-tree shape

  // produce-comparison's envelope ({ comparison, comparisonForm, computed }) -> unwrap;
  // otherwise `content` may itself be a bare ComparisonForm ({ benchmark, cases }).
  const comparisonForm = isComparisonFormLike(content.comparisonForm) ? content.comparisonForm : content;
  if (isComparisonFormLike(comparisonForm)) {
    return comparisonFormToContentTree(comparisonForm as any) as unknown as Record<string, any>;
  }
  return content;
}
