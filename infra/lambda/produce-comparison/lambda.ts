// produce-comparison — 表4 比較法調查估價表產製 (= POST /api/produce/comparison, 流程 ③, E).
//
// v2 合併鏈(見 infra/docs/表3合併-plan.md):以 cli 個別因素鏈為主體,不再用佔位規則。
//   ① 對「比準地 + 每個比較標的」各自打 individual-factor-grading(env INDIVIDUAL_FACTOR_GRADING_URL)
//      → 各自 graded.json(單一 parcel)。比較標的各自帶「自己的表1(survey+benchmark)」。
//   ② buildFillReport(baseGraded, [{label, graded}...])(cli individualComparison 純 code)
//      → comparison.json(每項 base + comparables[].delta;delta 即修正率%)。
//   ③ 打 land-transaction(env LAND_TRANSACTION_URL)取「最近一筆土地案例」unitPrice = 正常單價。
//   ④ 依 compute.ts 價格鏈公式(日期調整預設 0% + 表2 區域因素修正 + Σdelta)算試算價。
//   ⑤ mergeComparison 組契約 ProduceComparisonResponse 回傳。
//
// 契約:API_INTEGRATION.md §4(response 型別不變;request 擴充 comparisonSurveys[])。
// cli CLI 邏輯不改:只 import 其 buildFillReport(純 code)。graded 各 parcel 由本支 HTTP orchestrate。
//
// 路由:
//   POST  ProduceComparisonRequest  -> ProduceComparisonResponse (200)

// cli individualComparison 的純合成函式。build-lambdas.mjs 的 cliJsToTsPlugin 會把
// 這個 ".js" specifier 解析回 cli 的 .ts 源碼(NodeNext 慣例),bundle 時一起打包。
import type {
    ComparisonCondition,
    RegionalFactorRow,
    SurveyField,
} from "../shared/db";
import { buildFillReport } from "../shared/grading/individualComparison/compareGraded.js";
import {
    mergeComparison,
    type CaseMarketInput,
    type CliFillReport,
} from "./mergeComparison";

// Lambda Function URL event/response (subset), same shape as the other infra handlers.
interface FunctionUrlEvent {
  requestContext?: { http?: { method?: string } };
  queryStringParameters?: Record<string, string | undefined> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
}

interface JsonResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

// CORS 交給 Function URL 原生設定(CDK 的 FunctionUrl cors 屬性,allowedOrigins ["*"]),
// 這裡不要再手動加 access-control-allow-origin,否則帶 Origin 的請求會出現兩個
// Access-Control-Allow-Origin header,瀏覽器判定 CORS 失敗。
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
} as const;

function json(statusCode: number, payload: unknown): JsonResponse {
  return { statusCode, headers: { ...JSON_HEADERS }, body: JSON.stringify(payload) };
}

class BadRequestError extends Error {}

const MAX_CASES = 3; // §4：比較標的最多 3 筆
const GRADING_TIMEOUT_MS = 60_000; // Bedrock 評分,放寬
const TRANSACTION_TIMEOUT_MS = 15_000;

// CaseMeta 的 cli graded 需要的最小形狀(handler 內組,轉發給 individual-factor-grading)。
interface GradingMeta {
  sectionId: string;
  [k: string]: unknown;
}

// §4(v2)ProduceComparisonRequest。
//   - comparisonLocations:座標/地址(圖台定位用;沿用契約)。
//   - comparisonSurveys:v2 新增,每個比較標的「自己的表1」(survey + benchmark),供各自評分。
//     label 對齊 comparisonLocations 的順序;沒帶 survey 就退化(該標的評分證據少)。
interface ComparisonSurveyInput {
  address?: string;
  lat?: number;
  lng?: number;
  survey?: SurveyField[];
  benchmark: ComparisonCondition;
  /** 交易日期/正常單價覆寫(選填);缺則由 land-transaction 補正常單價。 */
  tradeDate?: string;
  normalPrice?: number;
  weight?: number;
}

interface LocationInput {
  address: string;
  lat: number;
  lng: number;
}

interface ProduceComparisonRequest {
  sectionId: string;
  regionalFactors: RegionalFactorRow[];
  regionalTotal: number;
  benchmark: ComparisonCondition;
  benchmarkSurvey?: SurveyField[];
  meta?: GradingMeta;
  comparisonLocations?: LocationInput[];
  comparisonSurveys?: ComparisonSurveyInput[];
}

// cli individual-factor-grading graded.json(單一 parcel);buildFillReport 吃這個。
interface GradedWithMeta {
  meta: { sectionId: string };
  benchmark: { location: string };
  individualFactors: unknown;
  totalScore: number;
}

function readEnvUrl(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`${name} 未設定：produce-comparison 需要它才能產表4。`);
  }
  return v.trim();
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function readBody(event: FunctionUrlEvent): Record<string, unknown> {
  if (!event.body) throw new BadRequestError("A JSON body is required.");
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestError("Request body is not valid JSON.");
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  throw new BadRequestError("Request body must be a JSON object.");
}

function parseRequest(body: Record<string, unknown>): ProduceComparisonRequest {
  const sectionId = typeof body.sectionId === "string" ? body.sectionId : "";

  const benchmark = body.benchmark;
  if (!benchmark || typeof benchmark !== "object" || Array.isArray(benchmark)) {
    throw new BadRequestError("benchmark (ComparisonCondition object) is required.");
  }

  const regionalFactors = Array.isArray(body.regionalFactors)
    ? (body.regionalFactors as RegionalFactorRow[])
    : [];
  const regionalTotal =
    typeof body.regionalTotal === "number" && Number.isFinite(body.regionalTotal)
      ? body.regionalTotal
      : 0;

  let comparisonLocations: LocationInput[] | undefined;
  if (body.comparisonLocations != null) {
    if (!Array.isArray(body.comparisonLocations)) {
      throw new BadRequestError("comparisonLocations, if present, must be an array.");
    }
    if (body.comparisonLocations.length > MAX_CASES) {
      throw new BadRequestError(`comparisonLocations supports at most ${MAX_CASES} items.`);
    }
    comparisonLocations = body.comparisonLocations as LocationInput[];
  }

  let comparisonSurveys: ComparisonSurveyInput[] | undefined;
  if (body.comparisonSurveys != null) {
    if (!Array.isArray(body.comparisonSurveys)) {
      throw new BadRequestError("comparisonSurveys, if present, must be an array.");
    }
    if (body.comparisonSurveys.length > MAX_CASES) {
      throw new BadRequestError(`comparisonSurveys supports at most ${MAX_CASES} items.`);
    }
    for (const s of body.comparisonSurveys as ComparisonSurveyInput[]) {
      if (!s || typeof s !== "object" || !s.benchmark || typeof s.benchmark !== "object") {
        throw new BadRequestError(
          "each comparisonSurveys[] item requires a benchmark (ComparisonCondition).",
        );
      }
    }
    comparisonSurveys = body.comparisonSurveys as ComparisonSurveyInput[];
  }

  return {
    sectionId,
    regionalFactors,
    regionalTotal,
    benchmark: benchmark as ComparisonCondition,
    benchmarkSurvey: Array.isArray(body.benchmarkSurvey)
      ? (body.benchmarkSurvey as SurveyField[])
      : undefined,
    meta: (body.meta ?? undefined) as GradingMeta | undefined,
    comparisonLocations,
    comparisonSurveys,
  };
}

// 表2 → 每個比較標的的區域因素調整率:regionalAdjRate[i] = Σ regionalFactors[].compare[i].rate。
// null(需人工複核)視為 0。與前端 api/index.ts 一致。
function regionalAdjRatePerCase(
  regionalFactors: RegionalFactorRow[],
  caseCount: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < caseCount; i++) {
    out.push(regionalFactors.reduce((sum, row) => sum + (row.compare?.[i]?.rate ?? 0), 0));
  }
  return out;
}

/** 對單一 parcel 打 individual-factor-grading,回 graded.json。失敗 throw(整支 502)。 */
async function gradeParcel(
  gradingUrl: string,
  meta: GradingMeta,
  benchmark: ComparisonCondition,
  survey: SurveyField[] | undefined,
): Promise<GradedWithMeta> {
  const payload: Record<string, unknown> = { meta, benchmark };
  if (survey && survey.length > 0) payload.survey = survey;
  const res = await fetchWithTimeout(
    gradingUrl,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
    GRADING_TIMEOUT_MS,
  );
  if (!res.ok) {
    throw new Error(`individual-factor-grading HTTP ${res.status}`);
  }
  return (await res.json()) as GradedWithMeta;
}

/**
 * 查該段「最近一筆土地案例」的 unitPrice 當正常單價。查無土地案例回 0(結構正確,數字待調整)。
 * segment 由 benchmark.sectionId 推(v1;來源格式後續調整)。district 從 benchmark.location 粗抓「XX區」。
 */
async function fetchNormalPrice(
  transactionUrl: string,
  benchmark: ComparisonCondition,
): Promise<{ normalPrice: number; tradeDate: string }> {
  const segment = benchmark.sectionId?.trim();
  if (!segment) return { normalPrice: 0, tradeDate: "" };
  try {
    const url = new URL(transactionUrl);
    url.searchParams.set("segment", segment);
    url.searchParams.set("kind", "land");
    url.searchParams.set("limit", "1");
    const districtMatch = benchmark.location?.match(/(\S+?[市縣]\S+?區)/);
    if (districtMatch) url.searchParams.set("district", districtMatch[1]);
    const res = await fetchWithTimeout(url.toString(), { method: "GET" }, TRANSACTION_TIMEOUT_MS);
    if (!res.ok) return { normalPrice: 0, tradeDate: "" };
    const data = (await res.json()) as {
      cases?: { unitPrice: number | null; tradeDate: string | null; isLandOnly: boolean }[];
    };
    const first = data.cases?.find((c) => c.isLandOnly && typeof c.unitPrice === "number");
    return {
      normalPrice: first?.unitPrice ?? 0,
      tradeDate: first?.tradeDate ?? "",
    };
  } catch {
    return { normalPrice: 0, tradeDate: "" };
  }
}

async function handleProduce(event: FunctionUrlEvent): Promise<JsonResponse> {
  const req = parseRequest(readBody(event));
  const gradingUrl = readEnvUrl("INDIVIDUAL_FACTOR_GRADING_URL");
  const transactionUrl = readEnvUrl("LAND_TRANSACTION_URL");

  const baseMeta: GradingMeta = req.meta ?? { sectionId: req.sectionId };
  if (!baseMeta.sectionId) baseMeta.sectionId = req.sectionId;

  // 比較標的清單:以 comparisonSurveys 為主(帶各自表1);缺 survey 時仍可用其 benchmark 評分。
  const targets = req.comparisonSurveys ?? [];
  const regionalPerCase = regionalAdjRatePerCase(req.regionalFactors, targets.length);

  // ① 評分:比準地 + 各比較標的(並行)。
  const [baseGraded, ...compGraded] = await Promise.all([
    gradeParcel(gradingUrl, baseMeta, req.benchmark, req.benchmarkSurvey),
    ...targets.map((t, i) =>
      gradeParcel(
        gradingUrl,
        { ...baseMeta, sectionId: t.benchmark.sectionId || `${baseMeta.sectionId}-C${i + 1}` },
        t.benchmark,
        t.survey,
      ),
    ),
  ]);

  // ② buildFillReport(純 code):label = caseNo("1".."3")。
  const bEntries = compGraded.map((graded, i) => ({
    label: String(i + 1),
    graded: graded as unknown as Parameters<typeof buildFillReport>[1][number]["graded"],
  }));
  const report = buildFillReport(
    baseGraded as unknown as Parameters<typeof buildFillReport>[0],
    bEntries,
  ) as unknown as CliFillReport;

  // ③ 正常單價:v1 全案共用「該段最近一筆土地案例」(各比較標的可由自己 request 覆寫)。
  const { normalPrice: segNormalPrice, tradeDate: segTradeDate } = await fetchNormalPrice(
    transactionUrl,
    req.benchmark,
  );

  // ④+⑤ 組每個比較標的的市場面輸入 → mergeComparison。
  const cases: CaseMarketInput[] = targets.map((t, i) => {
    const loc = req.comparisonLocations?.[i];
    return {
      label: String(i + 1),
      address: t.address ?? loc?.address ?? `比較標的${i + 1}`,
      latLng:
        loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)
          ? { lat: loc.lat, lng: loc.lng }
          : t.lat != null && t.lng != null
            ? { lat: t.lat, lng: t.lng }
            : undefined,
      condition: t.benchmark,
      normalPrice: t.normalPrice ?? segNormalPrice,
      tradeDate: t.tradeDate ?? segTradeDate,
      dateAdjRate: 0, // 預設 0%,前端可覆寫
      regionalAdjRate: regionalPerCase[i] ?? 0,
      weight: t.weight ?? 100,
    };
  });

  const { comparison, comparisonForm, computed } = mergeComparison({
    report,
    benchmark: req.benchmark,
    sectionId: req.sectionId,
    cases,
    regionalTotal: req.regionalTotal,
  });

  return json(200, { comparison, comparisonForm, computed });
}

/**
 * produce-comparison handler (v2 合併鏈)。
 *
 * = POST /api/produce/comparison(流程 ③,E)。POST 解析 ProduceComparisonRequest →
 * 個別因素評分 + buildFillReport + 正常單價 + 價格鏈 → 回 ProduceComparisonResponse。
 * 錯誤慣例比照 case-store。
 */
export async function handler(event: FunctionUrlEvent): Promise<JsonResponse> {
  const method = event.requestContext?.http?.method ?? "GET";
  try {
    if (method === "OPTIONS") return json(204, {});
    if (method === "POST") return await handleProduce(event);
    return json(405, { error: `Method ${method} not allowed.` });
  } catch (err) {
    if (err instanceof BadRequestError) return json(400, { error: err.message });
    const message = err instanceof Error ? err.message : String(err);
    return json(502, { error: `produce-comparison failed: ${message}` });
  }
}
