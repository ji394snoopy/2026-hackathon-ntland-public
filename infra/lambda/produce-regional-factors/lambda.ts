// produce-regional-factors — 表2/表5 區域因素評分產製對外端點 (= POST /api/produce/regional-factors).
//
// 斷點 1 的 orchestrator。收 N+1 份表1 定稿 (比準地 1 + 比較標的 ≤3) →
//   ① 對每一份打 regional-factor-grading (env REGIONAL_FACTOR_GRADING_URL,一次一筆 Bedrock)
//      拿各自的 graded.json;
//   ② buildFillReport 合成含比較欄的 comparison.json (cli 純函式);
//   ③ mapRegionalComparisonToRows 轉 RegionalFactorRow[28] (既有 mapper);
//   ④ 組契約 ProduceRegionalFactorsResponse 回傳。
// ②③④ 全在 mapToRegionalFactors.ts 的純函式,本檔只負責 HTTP + 呼叫上游。
//
// 沒有缺新功能 API,全是串接既有零件 —— 不改 cli CLI、不改 mapper。compare[].rate 一律 null
// (前端算)。容許 N=0 (只有比準地,compare:[] 空)。存檔時機:orchestrator 只回草稿、不碰
// case-store (與其他表一致,前端按「確認」時才存) —— 故不掛 DB env、不 grant DB IAM。
//
// 契約來源:API_INTEGRATION.md §3。型別重用 ../shared/db。並行 N+1 次 Bedrock、逐份容錯:
// 某份失敗只影響該欄 (comparable 失敗 → 該比較標的整支不納入;比準地失敗 → 502,無 base 無從合成)。

import {
    assembleRegionalFactorsResponse,
    type ComparableTable1Final,
    type GradedEnvelope,
    type ProduceRegionalFactorsRequest,
    type Table1Final,
} from "./mapToRegionalFactors";

// Lambda Function URL event/response (subset),同其他 infra handler。
interface FunctionUrlEvent {
  requestContext?: { http?: { method?: string } };
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

// --- 設定 -------------------------------------------------------------------

/** 比較標的最多筆數 (斷點1接線-plan 決策 1)。 */
const MAX_COMPARABLES = 3;
/** 單次 grading = 一次 Bedrock,放寬逾時吸收模型延遲 (對齊 grading lambda 的 120s)。 */
const GRADING_TIMEOUT_MS = 110_000;

function readEnvUrl(name: string): string | null {
  const v = process.env[name];
  if (!v || v.trim() === "") return null;
  return v.trim();
}

/** fetch + AbortController 逾時;回 Response 或 throw。 */
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

// --- 上游呼叫 ---------------------------------------------------------------

/**
 * 對一份表1 打 regional-factor-grading。成功回 graded envelope;失敗 throw
 * (由呼叫端決定容錯:比準地失敗 → 502,比較標的失敗 → 略過該筆)。
 */
async function gradeOne(base: string, table1: Table1Final): Promise<GradedEnvelope> {
  const res = await fetchWithTimeout(
    base,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        meta: table1.meta,
        survey: table1.survey,
        benchmark: table1.benchmark,
      }),
    },
    GRADING_TIMEOUT_MS,
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`regional-factor-grading HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json()) as GradedEnvelope;
}

// --- 請求解析 ---------------------------------------------------------------

function parseBody(event: FunctionUrlEvent): unknown {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return null; // 無法解析 → 400
  }
}

function isTable1Final(v: unknown): v is Table1Final {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    !!o.meta &&
    typeof o.meta === "object" &&
    Array.isArray(o.survey) &&
    o.survey.length > 0 &&
    !!o.benchmark &&
    typeof o.benchmark === "object"
  );
}

/** 解析並驗證 request;不合法回 { error } 供呼叫端回 400。 */
function parseRequest(
  event: FunctionUrlEvent,
): { request: ProduceRegionalFactorsRequest } | { error: string } {
  const body = parseBody(event);
  if (body === null) return { error: "Request body is not valid JSON." };
  const b = (body ?? {}) as Record<string, unknown>;

  const sectionId = typeof b.sectionId === "string" ? b.sectionId.trim() : "";
  if (!sectionId) return { error: "Missing sectionId (比準地區段編號)。" };

  if (!isTable1Final(b.benchmark)) {
    return {
      error:
        "Missing/invalid benchmark: 需 { meta, survey (非空陣列), benchmark } (比準地表1 定稿)。",
    };
  }

  const rawComparables = Array.isArray(b.comparables) ? b.comparables : [];
  if (rawComparables.length > MAX_COMPARABLES) {
    return { error: `comparables 最多 ${MAX_COMPARABLES} 份 (收到 ${rawComparables.length})。` };
  }
  const comparables: ComparableTable1Final[] = [];
  for (let i = 0; i < rawComparables.length; i++) {
    const c = rawComparables[i] as Record<string, unknown>;
    if (!isTable1Final(c)) {
      return { error: `comparables[${i}] 需 { caseNo, meta, survey (非空), benchmark }。` };
    }
    const caseNo =
      typeof c.caseNo === "string" && c.caseNo.trim() ? c.caseNo.trim() : String(i + 1);
    comparables.push({
      caseNo,
      meta: c.meta as Record<string, unknown>,
      survey: c.survey as unknown[],
      benchmark: c.benchmark as ComparableTable1Final["benchmark"],
    });
  }

  const request: ProduceRegionalFactorsRequest = {
    sectionId,
    benchmark: b.benchmark as Table1Final,
    comparables,
    caseCode: typeof b.caseCode === "string" ? b.caseCode : undefined,
    remarks:
      b.remarks && typeof b.remarks === "object"
        ? (b.remarks as ProduceRegionalFactorsRequest["remarks"])
        : undefined,
  };
  return { request };
}

// --- handler ----------------------------------------------------------------

/**
 * produce-regional-factors handler。POST ProduceRegionalFactorsRequest →
 * ProduceRegionalFactorsResponse。orchestrate N+1 次 regional-factor-grading (並行),
 * buildFillReport 合成、mapper 轉換,組表5 回前端。
 */
export async function handler(event: FunctionUrlEvent): Promise<JsonResponse> {
  const method = event.requestContext?.http?.method ?? "POST";
  if (method === "OPTIONS") return json(204, {});
  if (method !== "POST") return json(405, { error: `Method ${method} not allowed.` });

  const parsed = parseRequest(event);
  if ("error" in parsed) return json(400, { error: parsed.error });
  const { request } = parsed;

  const gradingUrl = readEnvUrl("REGIONAL_FACTOR_GRADING_URL");
  if (!gradingUrl) {
    return json(500, {
      error: "REGIONAL_FACTOR_GRADING_URL 未設定,無法呼叫評分上游。",
    });
  }

  // ① N+1 次評分,並行拉。逐份容錯:用 allSettled,比準地失敗 → 502;比較標的失敗 → 略過該筆。
  const comparables = request.comparables ?? [];
  const [baseSettled, ...comparableSettled] = await Promise.allSettled([
    gradeOne(gradingUrl, request.benchmark),
    ...comparables.map((c) => gradeOne(gradingUrl, c)),
  ]);

  if (baseSettled.status !== "fulfilled") {
    const reason =
      baseSettled.reason instanceof Error
        ? baseSettled.reason.message
        : String(baseSettled.reason);
    return json(502, { error: `比準地評分失敗,無從合成:${reason}` });
  }

  const comparableGradeds: Array<{ caseNo: string; graded: GradedEnvelope }> = [];
  const failedComparables: Array<{ caseNo: string; error: string }> = [];
  comparableSettled.forEach((settled, i) => {
    const caseNo = comparables[i]!.caseNo;
    if (settled.status === "fulfilled") {
      comparableGradeds.push({ caseNo, graded: settled.value });
    } else {
      const reason =
        settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
      console.warn(`[produce-regional-factors] comparable「${caseNo}」評分失敗,略過:${reason}`);
      failedComparables.push({ caseNo, error: reason });
    }
  });

  // ②③④ 純函式組裝。
  const response = assembleRegionalFactorsResponse(request, {
    baseGraded: baseSettled.value,
    comparableGradeds,
  });

  // 部分比較標的失敗時,附帶告知 (不影響已成功的欄位)。
  const payload =
    failedComparables.length > 0 ? { ...response, failedComparables } : response;
  return json(200, payload);
}
