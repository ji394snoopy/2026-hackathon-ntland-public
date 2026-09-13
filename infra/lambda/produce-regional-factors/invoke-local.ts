// Local dev runner for produce-regional-factors (= POST /api/produce/regional-factors, 表5).
//
// Orchestrator:對「比準地 + N 個比較標的」各自打 regional-factor-grading(env
// REGIONAL_FACTOR_GRADING_URL,一次一筆 Bedrock),再 buildFillReport 合成 → RegionalFactorRow[]。
// 這支的上游 URL 是「必填」——沒設 env 會回 500(不像 produce-survey 有降級)。
//
// 本機測試不想每次都燒 4 次 Bedrock (比準地 + 3 個比較標的),所以這支改成用
// input/regional-factor-grading-{P001-00,P002-00,P003-00,P004-00}-*.json 當「grading
// lambda 已經評完」的樣本 (即 regional-factor-grading/invoke-local.ts 那支批次跑出的
// export/ 產物,複製進這裡的 input/ 當固定樣本) —— P001-00 當比準地、P002/P003/P004
// 依序當比較標的 1/2/3。mock 掉 global.fetch,依呼叫順序 (main 先、1/2/3 依序) 直接回傳
// 對應樣本 —— 這樣可以不打真的 regional-factor-grading endpoint、不用 AWS 憑證,純測
// lambda.ts 這支 orchestrator 自己的組裝邏輯 (parseRequest → allSettled → buildFillReport
// → mapper → 契約)。
//
// 樣本本身是 GradedEnvelope 形狀 ({ meta, benchmark, regionalFactors, totalScore}),同
// regional-factor-grading 的輸出;這裡借用其 meta/benchmark 組成送進 orchestrator 的
// Table1Final 請求 (survey 隨便給非空 stub,因為 fetch 被 mock 掉,不會真的送到上游)。
//
// Run(不需要 env,也不需要 AWS 憑證):
//   cd infra
//   node --import ./scripts/register-ts.mjs lambda/produce-regional-factors/invoke-local.ts
//
// 想測「打真的上游」可改設 REGIONAL_FACTOR_GRADING_URL 並移除下方的 fetch mock,
// 用法同 local-deploy-steps.txt。

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { postEvent, runLocal } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";
import type {
  ComparableTable1Final,
  GradedEnvelope,
  Table1Final,
} from "./mapToRegionalFactors.js";

const INPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "input");
const EXPORT_DIR = resolve(import.meta.dirname, "export");

// P001-00 = 比準地 (main), P002-00/P003-00/P004-00 = 比較標的 1/2/3. Filenames carry a batch
// timestamp (regional-factor-grading-<sectionId>-<ts>.json, as produced by
// regional-factor-grading/invoke-local.ts) — find whichever one is on disk per sectionId
// rather than hardcoding the timestamp.
const SECTION_IDS = ["P001-00", "P002-00", "P003-00", "P004-00"];

function loadSample(sectionId: string): GradedEnvelope {
  const prefix = `regional-factor-grading-${sectionId}-`;
  const match = readdirSync(INPUT_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .sort()
    .at(-1);
  if (!match) {
    throw new Error(`No input file found matching ${prefix}*.json in ${INPUT_DIR}`);
  }
  return JSON.parse(readFileSync(join(INPUT_DIR, match), "utf-8"));
}

const mainSample = loadSample(SECTION_IDS[0]!); // 比準地 P001-00
const comparableSamples = SECTION_IDS.slice(1).map((sectionId, i) => ({
  caseNo: String(i + 1),
  sample: loadSample(sectionId),
}));

// survey 只需非空即可通過 parseRequest 的 isTable1Final 檢查;內容不影響結果,因為
// gradeOne() 打出去的 fetch 被下面 mock 掉了,樣本才是真正決定評分結果的東西。
const SURVEY_STUB = [
  {
    key: "zone_type",
    label: "使用分區",
    group: "土地使用管制",
    value: "第二種商業區",
  },
];

function toTable1Final(sample: GradedEnvelope): Table1Final {
  return {
    meta: sample.meta as unknown as Record<string, unknown>,
    survey: SURVEY_STUB,
    benchmark: sample.benchmark!,
  };
}

const REQUEST = {
  sectionId: mainSample.meta.sectionId,
  benchmark: toTable1Final(mainSample),
  comparables: comparableSamples.map(
    ({ caseNo, sample }): ComparableTable1Final => ({
      caseNo,
      ...toTable1Final(sample),
    }),
  ),
};

// --- mock fetch:依呼叫順序回樣本 (lambda.ts 先打 benchmark,再依序打各 comparable) ------
const gradedQueue: GradedEnvelope[] = [
  mainSample,
  ...comparableSamples.map((c) => c.sample),
];
let callCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (_url: string, _init?: RequestInit) => {
  const graded = gradedQueue[callCount];
  callCount++;
  if (!graded)
    throw new Error(`[mock fetch] unexpected extra call #${callCount}`);
  return {
    ok: true,
    status: 200,
    json: async () => graded,
    text: async () => JSON.stringify(graded),
  } as Response;
}) as typeof fetch;

process.env.REGIONAL_FACTOR_GRADING_URL = "http://mock-grading.local/";

try {
  const res = await runLocal(
    handler,
    postEvent(REQUEST),
    "produce-regional-factors",
  );
  console.log(
    `\n[produce-regional-factors] mock fetch calls: ${callCount} (expect ${gradedQueue.length})`,
  );

  // On success, also drop the response in export/ for inspection/reuse.
  if (res.statusCode === 200) {
    mkdirSync(EXPORT_DIR, { recursive: true });
    const outFile = resolve(
      EXPORT_DIR,
      `produce-regional-factors-${Date.now()}.json`,
    );
    writeFileSync(outFile, JSON.stringify(JSON.parse(res.body), null, 2));
    console.log(`[produce-regional-factors] wrote result -> ${outFile}`);
  }
} finally {
  globalThis.fetch = originalFetch;
}
