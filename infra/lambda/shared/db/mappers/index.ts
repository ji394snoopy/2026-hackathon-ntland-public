// Mapper layer — the single place that translates between DB rows and the frontend-facing
// API types (./types). Today the jsonb columns already hold the frontend shapes, so most
// of these are close to identity; they exist on purpose (plan §5):
//   1. When cli's internal schema is wired in later, the conversion lives here, not
//      scattered across handlers.
//   2. They isolate "how it's stored" from "how it's served" — a stored-column rename
//      never leaks to the API.
//
// The one non-identity bit today: regional_total is stored as a Postgres numeric (read
// back as a string by the driver) but served as a number.
//
// The grading mappers (./grading) are the non-trivial exception: they translate cli's
// grading CLI `graded.json` (nested, cli-keyed) into the frontend RegionalFactorRow[] /
// an infra-side individual grading shape. Re-exported below.

import type {
    AppraisalCaseRow,
    CaseComparisonRow,
    CaseRegionalFactorsRow,
    CaseSurveyRow,
} from "../schema";
import type {
    CaseBundle,
    CaseSummary,
    ComparisonFinal,
    ComparisonSurveyFinal,
    RegionalFactorsFinal,
    SurveyFinal,
} from "../types";

/** appraisal_case row -> lightweight summary (list/detail metadata). */
export function toCaseSummary(row: AppraisalCaseRow): CaseSummary {
  return {
    caseId: row.caseId,
    sectionId: row.sectionId,
    status: row.status,
    meta: row.meta ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/**
 * case_survey row -> 表1 定稿 payload(宗地與比較標的同一份格式,故共用這個 mapper)。
 *
 * 宗地身分欄是 nullable 的:DB 的 null 轉成 undefined,好讓「沒有這個值」在 JSON 上
 * 就是欄位不存在 —— 與 CaseBundle 裡「沒存過的 *Final 整個不出現」同一個慣例。
 */
export function toSurveyFinal(row: CaseSurveyRow): SurveyFinal {
  const final: SurveyFinal = { survey: row.survey, benchmark: row.benchmark };
  if (row.district != null) final.district = row.district;
  if (row.section != null) final.section = row.section;
  if (row.sectno != null) final.sectno = row.sectno;
  if (row.parcelNo != null) final.parcelNo = row.parcelNo;
  if (row.lat != null) final.lat = row.lat;
  if (row.lng != null) final.lng = row.lng;
  if (row.areaM2 != null) final.areaM2 = row.areaM2;
  return final;
}

/** case_survey row (role='comparison') -> 表1 定稿 + 比較標的序號。 */
export function toComparisonSurveyFinal(row: CaseSurveyRow): ComparisonSurveyFinal {
  return { targetIndex: row.targetIndex, ...toSurveyFinal(row) };
}

/** case_regional_factors row -> 表5 定稿 payload (numeric string -> number). */
export function toRegionalFactorsFinal(row: CaseRegionalFactorsRow): RegionalFactorsFinal {
  return {
    regionalFactors: row.regionalFactors,
    regionalTotal: row.regionalTotal != null ? Number(row.regionalTotal) : 0,
    remarks: row.remarks ?? { subject: "", cases: "", overall: "" },
  };
}

/** case_comparison row -> 表4 定稿 payload. */
export function toComparisonFinal(row: CaseComparisonRow): ComparisonFinal {
  return {
    comparison: row.comparison,
    comparisonForm: row.comparisonForm,
    computed: row.computed ?? {
      dateAdj: 0,
      regionalTotal: 0,
      individualTotal: 0,
      trialPrice: 0,
    },
  };
}

/** Assembles a full case bundle from the base row + whichever 定稿 rows exist. */
export function toCaseBundle(
  base: AppraisalCaseRow,
  parts: {
    survey?: CaseSurveyRow;
    regional?: CaseRegionalFactorsRow;
    comparison?: CaseComparisonRow;
  },
): CaseBundle {
  const bundle: CaseBundle = toCaseSummary(base);
  if (parts.survey) bundle.surveyFinal = toSurveyFinal(parts.survey);
  if (parts.regional) bundle.regionalFactorsFinal = toRegionalFactorsFinal(parts.regional);
  if (parts.comparison) bundle.comparisonFinal = toComparisonFinal(parts.comparison);
  return bundle;
}

// timestamptz comes back from the driver as a Date (or occasionally a string, depending on
// driver internals) — normalize to an ISO string for the API.
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// Survey mapper: frontend SurveyField[] (表1 定稿) -> fill-district-survey content tree
// (see ./survey). Reverse of produce-survey/mapToSurvey.ts.
export { GROUP_TO_CATEGORY, SURVEY_CROSSWALK, SURVEY_CROSSWALK_KEYS, surveyToContentTree } from "./survey";
export type { SurveyContentTree } from "./survey";

// Grading mappers: cli graded.json -> frontend / case-store shapes (see ./grading).
// Plus the reverse regionalRowsToAnalysisContent: RegionalFactorRow[] -> 表5 PDF content tree.
export {
    comparisonFormToContentTree, mapGradedBenchmark, mapGradedMeta, mapIndividualGraded, mapRegionalComparisonToRows, REGIONAL_CROSSWALK_KEYS, regionalRowsToAnalysisContent
} from "./grading";
export type {
    ComparisonComparable, ComparisonResult, GradedBenchmark, GradedCategory, GradedIndividualItem, GradedItemValue, GradedMeta, GradedRegionalItem, GradedSelectedGrade, IndividualAnalysisContent, IndividualGraded, IndividualGradedResult,
    IndividualGradedRow, RegionalAnalysisContent, RegionalGradedResult
} from "./grading";

