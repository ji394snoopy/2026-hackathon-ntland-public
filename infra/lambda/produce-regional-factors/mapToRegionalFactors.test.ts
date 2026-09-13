// produce-regional-factors / mapToRegionalFactors 單元測試 (純函式,不連網、不打 Bedrock)。
// 執行:npm run test:regional (見 infra/package.json;走 register-ts.mjs esbuild ts-loader)。
//
// 用 cli 真正的 regionalFactorGrading/exampleOutput/graded.json 當 fixture (斷點1接線-plan §5):
//   - 當 base (比準地);深拷貝幾份、改 meta.sectionId 當 comparables (比較標的)。
// 驗:assembleRegionalFactorsResponse 串起 buildFillReport → mapRegionalComparisonToRows →
//   契約組裝後 —— 28 列、compare 筆數 = 比較標的數、compare[].rate 一律 null、comparisonCases
//   對回 caseNo/sectionId、regionalTotal 加總正確、N=0 時 compare:[] 空。

import assert from "node:assert/strict";
import { test } from "node:test";
import regionalGraded from "../shared/grading/regionalFactorGrading/exampleOutput/graded.json" with { type: "json" };
import {
    assembleRegionalFactorsResponse,
    computeRegionalTotal,
    type GradedEnvelope,
} from "./mapToRegionalFactors";

// graded.json 頂層帶 { meta, benchmark, regionalFactors, totalScore } —— 恰好符合
// buildFillReport 需要的 GradedResultWithMeta (meta.sectionId + regionalFactors + totalScore)。
const baseGraded = regionalGraded as unknown as GradedEnvelope;

/** 深拷貝一份 graded,改 meta.sectionId (模擬跨區段比較標的)。 */
function cloneGraded(sectionId: string): GradedEnvelope {
  const clone = structuredClone(baseGraded);
  clone.meta = { ...clone.meta, sectionId };
  return clone;
}

const REQUEST = { sectionId: "P002-00", caseCode: "1140901-99-001" } as const;

test("N=3: 攤平 28 列,每列 compare 筆數 = 比較標的數,rate 一律 null", () => {
  const comparableGradeds = [
    { caseNo: "1", graded: cloneGraded("P002-00") },
    { caseNo: "2", graded: cloneGraded("P003-00") },
    { caseNo: "3", graded: cloneGraded("P004-00") },
  ];
  const res = assembleRegionalFactorsResponse(REQUEST, { baseGraded, comparableGradeds });

  assert.equal(res.regionalFactors.length, 28);
  for (const row of res.regionalFactors) {
    assert.equal(row.compare.length, 3, `${row.key} compare 數應等於比較標的數`);
    for (const c of row.compare) {
      assert.equal(c.rate, null, "修正率 % 由前端算 → rate 應為 null");
    }
  }
});

test("comparisonCases 對回 caseNo/sectionId;同區段旗標正確", () => {
  const comparableGradeds = [
    { caseNo: "1", graded: cloneGraded("P002-00") }, // 同區段
    { caseNo: "2", graded: cloneGraded("P003-00") }, // 跨區段
  ];
  const res = assembleRegionalFactorsResponse(REQUEST, { baseGraded, comparableGradeds });

  assert.deepEqual(res.comparisonCases, [
    { caseNo: "1", sectionId: "P002-00" },
    { caseNo: "2", sectionId: "P003-00" },
  ]);

  // 每列第 1 個比較標的與比準地同區段,第 2 個跨區段。
  for (const row of res.regionalFactors) {
    assert.equal(row.compare[0]!.sameSectionAsBenchmark, true);
    assert.equal(row.compare[1]!.sameSectionAsBenchmark, false);
  }
});

test("N=0: 只有比準地,compare:[] 空、comparisonCases 空、regionalTotal 0", () => {
  const res = assembleRegionalFactorsResponse(REQUEST, {
    baseGraded,
    comparableGradeds: [],
  });

  assert.equal(res.regionalFactors.length, 28);
  for (const row of res.regionalFactors) {
    assert.equal(row.compare.length, 0, `${row.key} 無比較標的時 compare 應為空`);
  }
  assert.deepEqual(res.comparisonCases, []);
  assert.equal(res.regionalTotal, 0);
});

test("regionalTotal = 各列 compare[0] 的 delta 加總 (rate 為 null 時)", () => {
  // 比較標的與比準地完全相同 → 每列 delta = 0 → 合計 0。
  const same = assembleRegionalFactorsResponse(REQUEST, {
    baseGraded,
    comparableGradeds: [{ caseNo: "1", graded: cloneGraded("P002-00") }],
  });
  assert.equal(same.regionalTotal, 0);

  // 手工用 computeRegionalTotal 驗加總邏輯:兩列有 delta、一列無 compare。
  const rows = [
    { key: "a", label: "", group: "", subject: { grade: "" }, compare: [{ sectionId: "", sameSectionAsBenchmark: false, grade: "", rate: null, delta: -3 }] },
    { key: "b", label: "", group: "", subject: { grade: "" }, compare: [{ sectionId: "", sameSectionAsBenchmark: false, grade: "", rate: null, delta: 5 }] },
    { key: "c", label: "", group: "", subject: { grade: "" }, compare: [] },
  ];
  assert.equal(computeRegionalTotal(rows as never), 2);
});

test("caseCode:缺 request.caseCode 時 fallback 到 sectionId", () => {
  const res = assembleRegionalFactorsResponse(
    { sectionId: "P002-00" },
    { baseGraded, comparableGradeds: [] },
  );
  assert.equal(res.caseCode, "P002-00");
});

test("regionalFactorRemarks:預設空字串,request.remarks 覆蓋", () => {
  const empty = assembleRegionalFactorsResponse(REQUEST, { baseGraded, comparableGradeds: [] });
  assert.deepEqual(empty.regionalFactorRemarks, { subject: "", cases: "", overall: "" });

  const withRemarks = assembleRegionalFactorsResponse(
    { ...REQUEST, remarks: { subject: "比準地選取理由" } },
    { baseGraded, comparableGradeds: [] },
  );
  assert.equal(withRemarks.regionalFactorRemarks.subject, "比準地選取理由");
  assert.equal(withRemarks.regionalFactorRemarks.cases, "");
});
