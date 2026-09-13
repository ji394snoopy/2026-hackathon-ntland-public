// Local dev runner for produce-comparison (= POST /api/produce/comparison, 表4 比較法).
//
// Orchestrator(v2 合併鏈):對「比準地 + N 個比較標的」各自打 individual-factor-grading
// (env INDIVIDUAL_FACTOR_GRADING_URL,Bedrock),buildFillReport 合成 comparison,再打
// land-transaction(env LAND_TRANSACTION_URL)取正常單價,依價格鏈算試算價。
// 兩個上游 URL 都是「必填」——沒設 env 會 throw(不像 produce-survey 有降級)。
//
// 本機測試不想每次都燒 4 次 Bedrock (比準地 + 3 個比較標的) 也不想接 land-transaction 的
// RDS Data API,所以這支改成用 input/individual-factor-grading-Pxxx-*.json 當
// 「individual-factor-grading 已經評完」的樣本(真實 graded.json 形狀,由
// individual-factor-grading/invoke-local.ts 產生並複製到這裡的 input/ —— 檔名帶時間戳,
// 同一個 Pxxx 若有多份取最新的一份;P001 固定當比準地,其餘依 Pxxx 排序當比較標的)。
// land-transaction 則用下方內建的一筆假資料頂替,mock 掉 global.fetch,依 URL 前綴
// (INDIVIDUAL_FACTOR_GRADING_URL 前綴 → 依呼叫順序回評分樣本;LAND_TRANSACTION_URL 前綴 →
// 回土地交易樣本) 分派 —— 這樣可以不打真的上游端點、不用 AWS 憑證,純測 lambda.ts 這支
// orchestrator 自己的組裝邏輯 (parseRequest → gradeParcel/fetchNormalPrice → buildFillReport
// → mergeComparison → 契約)。
//
// Run(不需要 env,也不需要 AWS 憑證):
//   cd infra
//   node --import ./scripts/register-ts.mjs lambda/produce-comparison/invoke-local.ts
//
// 想測「打真的上游」可改設 INDIVIDUAL_FACTOR_GRADING_URL / LAND_TRANSACTION_URL 並移除下方
// 的 fetch mock,用法同 local-deploy-steps.txt。

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { postEvent, runLocal } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";

const INPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "input");
const EXPORT_DIR = resolve(import.meta.dirname, "export");

// individual-factor-grading graded.json(單一 parcel)最小形狀,同 lambda.ts 的 GradedWithMeta。
interface GradedWithMeta {
  meta: { sectionId: string };
  benchmark: Record<string, unknown>;
  individualFactors: unknown;
  totalScore: number;
}

// 檔名形如 individual-factor-grading-P001-00-<timestamp>.json(individual-factor-grading/
// invoke-local.ts 產出後複製過來的)。依 Pxxx 前綴分組,同一 Pxxx 有多份時間戳只取最新
// (timestamp 最大)的一份 —— 這樣重跑 individual-factor-grading 產生新檔名後,這支不用改。
const GRADED_FILE_RE = /^individual-factor-grading-(P\d+)-.*\.json$/;

function findLatestGradedFiles(): Map<string, string> {
  const latestByPrefix = new Map<string, { file: string; ts: number }>();
  for (const file of readdirSync(INPUT_DIR)) {
    const match = file.match(GRADED_FILE_RE);
    if (!match) continue;
    const prefix = match[1]!;
    const tsMatch = file.match(/(\d+)\.json$/);
    const ts = tsMatch ? Number(tsMatch[1]) : 0;
    const existing = latestByPrefix.get(prefix);
    if (!existing || ts > existing.ts) latestByPrefix.set(prefix, { file, ts });
  }
  return new Map([...latestByPrefix].map(([prefix, { file }]) => [prefix, file]));
}

function loadGraded(file: string): GradedWithMeta {
  return JSON.parse(readFileSync(join(INPUT_DIR, file), "utf-8"));
}

const gradedFileByPrefix = findLatestGradedFiles();
const prefixes = [...gradedFileByPrefix.keys()].sort(); // "P001", "P002", ... — P001 固定當比準地
if (!prefixes.includes("P001")) {
  throw new Error(`no individual-factor-grading-P001-*.json found in ${INPUT_DIR}`);
}

const mainGraded = loadGraded(gradedFileByPrefix.get("P001")!); // 比準地
const comparableGradeds = prefixes
  .filter((prefix) => prefix !== "P001")
  .map((prefix) => loadGraded(gradedFileByPrefix.get(prefix)!));

// land-transaction 樣本(正常單價來源):本機測試用內建假資料頂替,不接 RDS Data API。
const LAND_TRANSACTION_SAMPLE = {
  district: "新北市金山區",
  segment: "金美段",
  kind: "land",
  count: 1,
  landCount: 1,
  houseLandCount: 0,
  cases: [
    {
      id: "mock-1",
      district: "新北市金山區",
      segment: "金美段",
      lid: "489",
      tradeDate: "2025-06-15",
      kind: "土地",
      isLandOnly: true,
      landArea: 113.21,
      buildingArea: null,
      totalPrice: 20904763,
      unitPrice: 184700,
      urbanUse: "第二種商業區",
      nonUrbanUse: null,
      buildingType: null,
      structure: null,
      totalFloors: null,
      buildDate: null,
      buildingAgeYears: null,
      note: "mock fixture,供 produce-comparison invoke-local 本機測試用",
    },
  ],
};

// ProduceComparisonRequest。benchmark/comparisonSurveys[].benchmark 直接借用樣本的
// benchmark(已是 ComparisonCondition 形狀);regionalFactors 給空陣列 ⇒ regionalTotal 對齊
// 修正為 0(與 lambda.ts 註解的「N=0」慣例一致,這裡是「無表5」慣例)。
const REQUEST = {
  sectionId: mainGraded.meta.sectionId,
  benchmark: mainGraded.benchmark,
  regionalFactors: [],
  regionalTotal: 0,
  comparisonSurveys: comparableGradeds.map((g) => ({
    address: g.benchmark.location as string,
    benchmark: g.benchmark,
  })),
};

// --- mock fetch --------------------------------------------------------------
// gradeParcel() 打 INDIVIDUAL_FACTOR_GRADING_URL:依呼叫順序回樣本 (lambda.ts 先打
// 比準地、再依序打各比較標的)。fetchNormalPrice() 打 LAND_TRANSACTION_URL(GET,帶查詢
// 參數):一律回同一份土地交易樣本。用 URL 前綴分派兩者。
const INDIVIDUAL_FACTOR_GRADING_URL = "http://mock-grading.local/";
const LAND_TRANSACTION_URL = "http://mock-transaction.local/";
process.env.INDIVIDUAL_FACTOR_GRADING_URL = INDIVIDUAL_FACTOR_GRADING_URL;
process.env.LAND_TRANSACTION_URL = LAND_TRANSACTION_URL;

const gradingQueue: GradedWithMeta[] = [mainGraded, ...comparableGradeds];
let gradingCallCount = 0;
let transactionCallCount = 0;

function mockResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, _init?: RequestInit) => {
  const urlStr = String(url);
  if (urlStr.startsWith(INDIVIDUAL_FACTOR_GRADING_URL)) {
    const graded = gradingQueue[gradingCallCount];
    gradingCallCount++;
    if (!graded) throw new Error(`[mock fetch] unexpected extra grading call #${gradingCallCount}`);
    return mockResponse(graded);
  }
  if (urlStr.startsWith(LAND_TRANSACTION_URL)) {
    transactionCallCount++;
    return mockResponse(LAND_TRANSACTION_SAMPLE);
  }
  throw new Error(`[mock fetch] unexpected url: ${urlStr}`);
}) as typeof fetch;

try {
  const res = await runLocal(handler, postEvent(REQUEST), "produce-comparison");
  console.log(
    `\n[produce-comparison] mock grading calls: ${gradingCallCount} (expect ${gradingQueue.length}), ` +
      `mock land-transaction calls: ${transactionCallCount}`,
  );

  // On success, also drop the response in export/ for inspection/reuse.
  if (res.statusCode === 200) {
    mkdirSync(EXPORT_DIR, { recursive: true });
    const outFile = resolve(EXPORT_DIR, `produce-comparison-${Date.now()}.json`);
    writeFileSync(outFile, JSON.stringify(JSON.parse(res.body), null, 2));
    console.log(`[produce-comparison] wrote result -> ${outFile}`);
  }
} finally {
  globalThis.fetch = originalFetch;
}
