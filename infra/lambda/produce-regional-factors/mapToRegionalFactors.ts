// produce-regional-factors — 表2/表5 區域因素評分 orchestrator 的純函式核心 (無 I/O).
//
// lambda.ts 負責 HTTP 與呼叫上游 regional-factor-grading (N+1 次 Bedrock);本檔只做純資料
// 轉換,方便單元測試 (斷點1接線-plan §5):
//   ① 各份表1 的 graded.json (grading lambda 的輸出) —— 由 lambda.ts 取得後傳入此處;
//   ② buildFillReport(baseGraded, [{label, graded}...])  —— cli 純函式,合成含比較欄的
//      comparison.json (ComparisonResult);比準地 = base,每個比較標的 = 一個 labeled comparable
//      (label = caseNo);
//   ③ mapRegionalComparisonToRows(comparison) —— 既有 mapper,攤平成 RegionalFactorRow[28]、
//      cli key → 前端 {key,label,group}、compare[].rate 一律 null (前端算);
//   ④ 組契約 ProduceRegionalFactorsResponse。
//
// 不改 cli CLI、不改 mapper —— 全是串接既有零件。N=0 (只有比準地) 時 comparables 傳空陣列,
// buildFillReport 回 compare:[] 空的每列,mapper 也支援。
//
// 契約來源:API_INTEGRATION.md §3 (POST /api/produce/regional-factors);型別重用 ../shared/db。

import type { GradedResultWithMeta } from "../shared/grading/gradingComparison/compareGraded";
import { buildFillReport } from "../shared/grading/gradingComparison/compareGraded";
// Value import of the mapper points at the concrete file (not the ../shared/db barrel
// directory) so the esbuild ts-loader can resolve it at test runtime under `node --test`
// (directory ESM imports aren't supported). Types come from the barrel (erased at runtime).
import {
    mapRegionalComparisonToRows,
    type ComparisonResult,
} from "../shared/db/mappers/grading";
import type {
    ComparisonCondition,
    RegionalFactorRemarks,
    RegionalFactorRow,
} from "../shared/db/types";

// --- 契約:request (斷點1接線-plan §3;角色具名分組,已與使用者敲定) ---------------

/** 一份表1 定稿的核心資料 (同 grading lambda 的入參形狀 { meta, survey, benchmark })。 */
export interface Table1Final {
  meta: Record<string, unknown>;
  /** 地價區段勘查表欄位;grading lambda 要求非空 (區域因素評分讀 survey)。 */
  survey: unknown[];
  benchmark: ComparisonCondition;
}

/** 比較標的的表1 定稿 —— 多帶一個 caseNo (當 buildFillReport 的 label + response 身分)。 */
export interface ComparableTable1Final extends Table1Final {
  /** 案號,如 "1" / "2" / "3"。 */
  caseNo: string;
}

/**
 * POST /api/produce/regional-factors 的 request:收 N+1 份表1 定稿的具名分組。
 * benchmark = 比準地那份;comparables = 0~3 份比較標的 (容許空/省略 → N=0)。
 */
export interface ProduceRegionalFactorsRequest {
  /** 比準地區段編號 (頂層,沿用現行契約)。 */
  sectionId: string;
  /** 比準地那份表1 定稿。 */
  benchmark: Table1Final;
  /** 比較標的表1 定稿 (最多 3 份;空/省略代表 N=0)。 */
  comparables?: ComparableTable1Final[];
  /** 案號 (可選);缺則由 lambda 以 sectionId 帶入 response.caseCode。 */
  caseCode?: string;
  /** 備註欄 (可選);前端可帶入,缺則回空字串。 */
  remarks?: Partial<RegionalFactorRemarks>;
}

// --- 契約:response (API_INTEGRATION.md §3;不變) ------------------------------

export interface ProduceRegionalFactorsResponse {
  regionalFactors: RegionalFactorRow[];
  regionalTotal: number;
  caseCode: string;
  comparisonCases: Array<{ caseNo: string; sectionId: string }>;
  regionalFactorRemarks: RegionalFactorRemarks;
}

// --- grading lambda 的輸出 (= buildFillReport 的 base/comparable 入參) ---------

/**
 * regional-factor-grading 回的 graded JSON:{ meta, benchmark, regionalFactors, totalScore }
 * (同 CLI graded.json)。頂層帶 meta.sectionId,恰好符合 buildFillReport 需要的
 * GradedResultWithMeta ({ regionalFactors, totalScore } & { meta: { sectionId } })。
 */
export interface GradedEnvelope extends GradedResultWithMeta {
  benchmark?: ComparisonCondition;
}

/** 比準地 graded + 各比較標的 (caseNo + graded)，作為純函式組裝的輸入。 */
export interface GradedInputs {
  baseGraded: GradedEnvelope;
  comparableGradeds: Array<{ caseNo: string; graded: GradedEnvelope }>;
}

// --- 純函式組裝 ---------------------------------------------------------------

const EMPTY_REMARKS: RegionalFactorRemarks = { subject: "", cases: "", overall: "" };

/**
 * regionalTotal (契約 §3「總修正率」):依契約定義為「各比較標的第 1 筆的修正率加總」。
 * 修正率 % 由前端算 (compare[].rate 一律 null),此處以每列 compare[0] 的等級點數差 delta
 * 加總近似總修正量 —— rate 為 null 時當 0,沒有比較標的 (N=0) 時為 0。
 * (前端拿到 rate 後可自行重算;這裡回一個後端可算出的合計,避免留 null。)
 */
function computeRegionalTotal(rows: RegionalFactorRow[]): number {
  let total = 0;
  for (const row of rows) {
    const first = row.compare[0];
    if (!first) continue;
    if (typeof first.rate === "number") {
      total += first.rate;
    } else if (typeof first.delta === "number") {
      total += first.delta;
    }
  }
  return total;
}

/**
 * 組裝 ProduceRegionalFactorsResponse:buildFillReport → mapRegionalComparisonToRows → 契約。
 * 純資料轉換,無 I/O。N=0 (comparableGradeds 空) 時 comparison.comparables 皆空,每列 compare:[]。
 */
export function assembleRegionalFactorsResponse(
  request: Pick<ProduceRegionalFactorsRequest, "sectionId" | "caseCode" | "remarks">,
  inputs: GradedInputs,
): ProduceRegionalFactorsResponse {
  // ② 合成含比較欄 (cli 純函式)。label = caseNo,mapper 靠它對回 sectionId/身分。
  const comparison = buildFillReport(
    inputs.baseGraded,
    inputs.comparableGradeds.map(({ caseNo, graded }) => ({ label: caseNo, graded })),
  ) as unknown as ComparisonResult;

  // ③ 轉畫面格式 (既有 mapper,不改)。
  const regionalFactors = mapRegionalComparisonToRows(comparison);

  // ④ 組契約。
  const comparisonCases = comparison.comparableSectionIds.map((c) => ({
    caseNo: c.label,
    sectionId: c.sectionId,
  }));

  return {
    regionalFactors,
    regionalTotal: computeRegionalTotal(regionalFactors),
    caseCode: request.caseCode ?? request.sectionId,
    comparisonCases,
    regionalFactorRemarks: { ...EMPTY_REMARKS, ...(request.remarks ?? {}) },
  };
}

export { computeRegionalTotal };
