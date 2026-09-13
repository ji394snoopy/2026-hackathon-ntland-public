// Shared DB access layer — public surface. Import from here:
//
//   import { getDb, schema, newCaseId, toCaseBundle } from "../shared/db";
//
// getDb()  — process-wide Drizzle handle over the RDS Data API (warm-reused).
// schema   — Drizzle table definitions (appraisalCase / caseSurvey / ...).
// types    — frontend-facing API types (SurveyField[], ComparisonForm, ...).
// mappers  — DB row <-> API type translation (identity-ish today; see ./mappers).
// ids      — caseId minting.

export { getDb, type Db } from "./client";
export { newCaseId } from "./ids";
export {
    REGIONAL_CROSSWALK_KEYS, comparisonFormToContentTree, mapGradedBenchmark, mapGradedMeta, mapIndividualGraded, mapRegionalComparisonToRows,
    regionalRowsToAnalysisContent, surveyToContentTree, toCaseBundle,
    toCaseSummary,
    toComparisonFinal,
    toComparisonSurveyFinal,
    toRegionalFactorsFinal,
    toSurveyFinal
    // 明確指到 ./mappers/index.js:esbuild 打包解得動裸目錄 import,但 invoke-local.ts 用的
    // node ESM loader 不行(ERR_UNSUPPORTED_DIR_IMPORT),會讓每支 invoke-local 一 import 就死。
} from "./mappers/index.js";
export type {
    ComparisonComparable, ComparisonResult, GradedBenchmark, GradedCategory, GradedIndividualItem, GradedItemValue, GradedMeta, GradedRegionalItem, GradedSelectedGrade, IndividualAnalysisContent, IndividualGraded, IndividualGradedResult,
    IndividualGradedRow, RegionalAnalysisContent, RegionalGradedResult, SurveyContentTree
} from "./mappers/index.js";
export {
    appraisalCase,
    caseComparison,
    caseRegionalFactors,
    caseSurvey,
    landOfficialValue,
    landParcel,
    landSection,
    landTransaction,
    schema,
    type AppraisalCaseInsert,
    type AppraisalCaseRow,
    type CaseComparisonInsert,
    type CaseComparisonRow,
    type CaseRegionalFactorsInsert,
    type CaseRegionalFactorsRow,
    type CaseSurveyInsert,
    type CaseSurveyRow,
    type LandOfficialValueInsert,
    type LandOfficialValueRow,
    type LandParcelInsert,
    type LandParcelRow,
    type LandSectionInsert,
    type LandSectionRow,
    type LandTransactionInsert,
    type LandTransactionRow
} from "./schema";
export * from "./types";

