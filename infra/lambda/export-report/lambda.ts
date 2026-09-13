// export-report — 匯出報告 orchestrator (= POST /api/export, 流程 H, 斷點3 路 B).
//
// 角色:把「一份完整報告」需要的各段 PDF 依報告順序組好,交給 fill-report 合併成單一
// 可下載 PDF。這支是斷點3 走「路 B(全後端)」的串接者 —— 表1/表2/表3 的 PDF 由後端的三支
// 填表 lambda 產(不再靠前端 Printable 元件),圖片由 image-upload 取回轉成 PDF 頁,只有三張
// Leaflet 地圖仍是瀏覽器才能產、由前端隨 request 附上。
//
// 合併順序(對齊 fill-report / API_INTEGRATION.md §5 預期輸出):
//   ① 表1 勘查表(可多張) ← fill-district-survey   (env FILL_DISTRICT_SURVEY_URL)
//      一份估價案有 N+1 張勘查表 —— 比準地一張、每個比較標的各一張,全部都要進報告。所以這段
//      收的是 `surveys: [...]`,依序各打一次填表 lambda、依序併入(舊的單張 `survey` 仍相容)。
//   ② 表2 區域因素評分   ← fill-regional-analysis (env FILL_REGIONAL_ANALYSIS_URL,依 purpose 選範本)
//   ③ 表3 比較法估價表   ← fill-individual-analysis(env FILL_INDIVIDUAL_ANALYSIS_URL)
//   ④ 三張地圖          ← 前端隨 request 附上(maps[].pdfBase64;Leaflet 只能瀏覽器產)
//   ⑤ 使用者上傳圖片     ← s3Keys 有帶:直接從 dataBucket GetObject(env ASSET_BUCKET)→ 每張轉一頁
//                         沒帶 s3Keys 才看 caseId:image-upload GET ?caseId=(env IMAGE_UPLOAD_URL)
//   ⑥ 全部依序在本支用 pdf-lib copyPages 合併(見 reportParts.ts)
//   ⑦ 合併後的 PDF 寫進 dataBucket 的 case-exports/(env ASSET_BUCKET),回 JSON { url } ——
//      url 走 AssetStack 的 CloudFront(env REPORT_PUBLIC_BASE_URL),前端再用它下載。
//
// 為什麼不再丟 fill-report 合併:那要把所有段落 base64 塞進同一個 JSON 請求,地圖圖片一大就超過
// Function URL 6 MB 請求上限(三張 html2canvas PNG 就 7 MB+)。合併本身只是 copyPages,在這裡做即可。
// 為什麼 PDF 不直接放在回應裡:Function URL 回應同樣上限 6 MB(base64 後 PDF 本體約 4.4 MB 就爆),
// 四張勘查表 + 地圖/照片很容易超過。寫 S3 再給網址就沒有這個上限。
// 為什麼給 CloudFront 網址而不是 presigned URL:dataBucket 前面本來就有 CloudFront(OAC +
// CORS_ALLOW_ALL_ORIGINS),前端 fetch 不用另開 bucket CORS;presigner 也不在 Node 22 runtime 內建
// 的保證清單裡。代價是網址不會過期 —— key 帶 UUID,不猜得到,hackathon 可接受;正式環境改 presigned。
//
// 契約:
//   入(POST body,JSON;body 可能 base64,依 Function URL isBase64Encoded):
//     type ExportReportRequest = {
//       s3Keys?: string[];                            // 圖片/PDF 的 S3 key(image-upload 回的 s3Key),依序併入
//       caseId?: string;                              // 沒帶 s3Keys 時,向 image-upload 取回該案全部圖片併入
//       surveys?: object[];                           // 表1 多張(比準地 + 各比較標的),依序各產一張
//       survey?: object;                              // 表1 單張(向後相容;等同 surveys 只有一筆)
//       regional?: { purpose: Purpose; content?: object } // 表2:用地類別 + content(fill-regional-analysis 的 body)
//       comparison?: object;                          // 表3 content tree(fill-individual-analysis 的 body)
//       maps?: Array<{ name?: string; pdfBase64: string }> // 前端產的三張地圖 PDF(直接併入)
//     };
//   出:200 JSON —— type ExportReportResponse = {
//         url: string;          // CloudFront 下載網址(content-type application/pdf)
//         s3Key: string;        // case-exports/<caseId|no-case>/<時間>-<uuid>.pdf
//         sizeBytes: number;
//         pageCount: number;
//         skippedCount: number; // 讀不到/格式不支援而略過的圖片數(同 x-export-skipped-count)
//       };
//
// surveys 與 survey 同時帶時以 surveys 為準(survey 忽略並記 log),避免同一張表印兩次。
// 缺哪一段就跳過那一段(例如只給 survey + maps 也能出報告),完全沒有可合併內容才回 400。
// 任一上游填表失敗回 502(把上游狀態帶出)。圖片是 best-effort:任一張讀不到/格式不支援只略過那張
// (記 log + x-export-skipped-count header),不影響其他段落。S3 讀取權限只開 case-images/*,
// 寫入權限只開 case-exports/*。

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { assetToPdf, mergeParts, type ReportPart } from "./reportParts.js";
// 前端統一 schema -> 填表 lambda 吃的 content tree 的後端 mapper。前端只送 SurveyField[] /
// RegionalFactorRow[] 定稿,轉換在此 orchestrator 做,填表 lambda 維持只吃 content tree。
import { comparisonFormToContentTree, regionalRowsToAnalysisContent, surveyToContentTree } from "../shared/db/mappers";
import type { ComparisonForm, RegionalFactorRow, SurveyField } from "../shared/db/types";

// Lambda Function URL event/response (subset), same shape as the other infra handlers.
interface FunctionUrlEvent {
  requestContext?: { http?: { method?: string } };
  body?: string | null;
  isBase64Encoded?: boolean;
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}

// CORS 交給 Function URL 原生設定(CDK 的 FunctionUrl cors 屬性,allowedOrigins ["*"],
// 且會自動處理 OPTIONS preflight)。這裡不要再手動加 access-control-allow-origin,否則
// 帶 Origin 的請求會出現兩個 Access-Control-Allow-Origin header,瀏覽器判定 CORS 失敗。
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
} as const;

function errorResponse(statusCode: number, message: string): LambdaResponse {
  return { statusCode, headers: { ...JSON_HEADERS }, body: JSON.stringify({ error: message }) };
}

class BadRequestError extends Error {}
class UpstreamError extends Error {}

const FILL_TIMEOUT_MS = 30_000; // 填表 lambda(純 pdf-lib)很快,但給足餘裕
const IMAGE_TIMEOUT_MS = 20_000; // image-upload 列表 + 逐張抓

/** 匯出 PDF 在 dataBucket 裡的前綴。CDK 只對這個前綴開 PutObject(bedrock-stack.ts)。 */
const EXPORT_PREFIX = "case-exports";

// Module-scope singleton,warm invocation 重用(同 image-upload)。s3Keys 讀圖與匯出寫檔共用。
const s3 = new S3Client({});

/**
 * caseId 會變成 S3 key 的一層路徑:只留英數、底線、連字號,其餘換成底線。
 * 避免 "../" 或 "/" 讓檔案寫到 case-exports/ 以外(IAM 雖然也會擋,但不要靠它)。
 */
function exportKeySegment(caseId: string | undefined): string {
  const cleaned = (caseId ?? "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100);
  return cleaned === "" ? "no-case" : cleaned;
}

/**
 * 把合併好的 PDF 寫進 S3,回前端可下載的網址。
 * key 帶時間 + UUID:每次匯出都是新檔(CloudFront 不會拿到舊快取),網址也猜不到。
 */
async function uploadReport(pdf: Uint8Array, caseId: string | undefined): Promise<{ url: string; s3Key: string }> {
  const bucket = process.env.ASSET_BUCKET?.trim();
  if (!bucket) throw new Error("ASSET_BUCKET 未設定：export-report 需要它才能存匯出的 PDF。");
  const baseUrl = readEnvUrl("REPORT_PUBLIC_BASE_URL").replace(/\/+$/, "");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const s3Key = `${EXPORT_PREFIX}/${exportKeySegment(caseId)}/${stamp}-${randomUUID()}.pdf`;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: pdf,
      ContentType: "application/pdf",
      ContentDisposition: 'inline; filename="report.pdf"',
    }),
  );
  return { url: `${baseUrl}/${s3Key}`, s3Key };
}

interface MapInput {
  name?: string;
  pdfBase64: string;
}

interface RegionalInput {
  purpose: string;
  content?: Record<string, unknown>;
}

interface ExportReportRequest {
  /** 有帶(即使是空陣列)就只用這份清單取圖,不再依 caseId 列 image-upload。 */
  s3Keys?: string[];
  caseId?: string;
  /** 表1 勘查表,依序各產一張。parseRequest 已把舊的單張 `survey` 收斂進來,handler 只看這個。 */
  surveys: Record<string, unknown>[];
  regional?: RegionalInput;
  comparison?: Record<string, unknown>;
  maps?: MapInput[];
}

function readEnvUrl(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`${name} 未設定：export-report 需要它才能組匯出。`);
  }
  return v.trim();
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 取表1 勘查表清單。`surveys: [...]` 為主;沒帶才退回舊的單張 `survey`(包成一筆)。
 *
 * 每一筆接受的形狀與舊 `survey` 完全相同(見 normalizeSurvey):{ meta, survey, benchmark }、
 * 裸 SurveyField[]、或已是 content tree。陣列本身就是 object,所以裸 SurveyField[] 也收得進來。
 * 非 object 的元素(null / 字串)是呼叫端寫錯,直接 400,不要默默少印一張表。
 */
function parseSurveys(b: Record<string, unknown>): Record<string, unknown>[] {
  if (b.surveys != null) {
    if (!Array.isArray(b.surveys)) throw new BadRequestError("surveys, if present, must be an array.");
    const surveys = b.surveys as unknown[];
    surveys.forEach((s, i) => {
      if (!s || typeof s !== "object") {
        throw new BadRequestError(`surveys[${i}] must be an object (表一定稿或 content tree)。`);
      }
    });
    if (b.survey != null) {
      console.warn("[export-report] surveys 與 survey 同時帶,以 surveys 為準,忽略 survey。");
    }
    return surveys as Record<string, unknown>[];
  }
  return b.survey && typeof b.survey === "object" ? [b.survey as Record<string, unknown>] : [];
}

/**
 * 表1 在 fill-report 裡的段名。只有一張時沿用舊名 `table1-survey`;多張時帶上 sectionId 方便
 * 從 log 對出是哪一張(fill-report 只是 copyPages,段名不會印進 PDF)。
 */
function surveyPartName(survey: Record<string, unknown>, index: number, total: number): string {
  if (total <= 1) return "table1-survey";
  const sectionId = (survey as { meta?: { sectionId?: unknown } }).meta?.sectionId;
  return typeof sectionId === "string" && sectionId.trim() !== ""
    ? `table1-survey-${index + 1}:${sectionId.trim()}`
    : `table1-survey-${index + 1}`;
}

function parseRequest(event: FunctionUrlEvent): ExportReportRequest {
  if (!event.body) throw new BadRequestError("A JSON body is required.");
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestError("Request body is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BadRequestError("Request body must be a JSON object.");
  }
  const b = parsed as Record<string, unknown>;

  let maps: MapInput[] | undefined;
  if (b.maps != null) {
    if (!Array.isArray(b.maps)) throw new BadRequestError("maps, if present, must be an array.");
    maps = (b.maps as unknown[])
      .filter((m): m is MapInput => !!m && typeof m === "object" && typeof (m as any).pdfBase64 === "string")
      .map((m) => ({ name: typeof m.name === "string" ? m.name : undefined, pdfBase64: m.pdfBase64 }));
  }

  let regional: RegionalInput | undefined;
  if (b.regional != null) {
    const r = b.regional as Record<string, unknown>;
    if (!r || typeof r !== "object" || typeof r.purpose !== "string") {
      throw new BadRequestError("regional, if present, requires a string `purpose`.");
    }
    regional = {
      purpose: r.purpose,
      content: r.content && typeof r.content === "object" ? (r.content as Record<string, unknown>) : undefined,
    };
  }

  let s3Keys: string[] | undefined;
  if (b.s3Keys != null) {
    if (!Array.isArray(b.s3Keys)) throw new BadRequestError("s3Keys, if present, must be an array of strings.");
    s3Keys = (b.s3Keys as unknown[])
      .filter((k): k is string => typeof k === "string" && k.trim() !== "")
      .map((k) => k.trim());
  }

  return {
    s3Keys,
    caseId: typeof b.caseId === "string" && b.caseId.trim() !== "" ? b.caseId.trim() : undefined,
    surveys: parseSurveys(b),
    regional,
    comparison: b.comparison && typeof b.comparison === "object" ? (b.comparison as Record<string, unknown>) : undefined,
    maps,
  };
}

// ---------------------------------------------------------------------------
// 前端 schema -> content tree 的 sniff + 轉換。前端定稿是 SurveyField[] / RegionalFactorRow[]
// （統一 schema）;填表 lambda 只吃 content tree。這裡偵測輸入形狀:是前端 schema 就用對應
// mapper 轉,否則(已是 content tree)原樣送——兩種輸入都相容。
// ---------------------------------------------------------------------------

/** 是否為前端 SurveyField[]（元素帶 key/label/group/value）。 */
function looksLikeSurveyFields(v: unknown): v is SurveyField[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    typeof v[0] === "object" &&
    v[0] !== null &&
    "key" in v[0] &&
    "value" in v[0] &&
    "group" in v[0]
  );
}

/** 是否為前端 RegionalFactorRow[]（元素帶 key/subject/compare）。 */
function looksLikeRegionalRows(v: unknown): v is RegionalFactorRow[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    typeof v[0] === "object" &&
    v[0] !== null &&
    "key" in v[0] &&
    "subject" in v[0] &&
    "compare" in v[0]
  );
}

/**
 * 表1:把 surveys 的其中一筆正規化成 fill-district-survey 吃的 content tree。
 * 接受:① 前端 { meta?, survey: SurveyField[], benchmark? } → surveyToContentTree 轉；
 *       ② 直接 SurveyField[] → 轉；③ 已是 content tree（其它物件）→ 原樣。
 */
function normalizeSurvey(survey: Record<string, unknown>): unknown {
  if (looksLikeSurveyFields(survey)) return surveyToContentTree(survey);
  const inner = (survey as { survey?: unknown }).survey;
  if (looksLikeSurveyFields(inner)) {
    return surveyToContentTree(
      inner,
      (survey as { meta?: any }).meta,
      (survey as { benchmark?: any }).benchmark,
    );
  }
  return survey; // 已是 content tree
}

/**
 * 表2:把 regional.content 正規化成 fill-regional-analysis 吃的 comparison content tree。
 * 接受:① 前端 RegionalFactorRow[] → regionalRowsToAnalysisContent 轉；
 *       ② { regionalFactors: RegionalFactorRow[], meta? } → 轉（sectionId 取自 meta）；
 *       ③ 已是 comparison content tree（含 categories）→ 原樣。
 * sectionIdBase 盡量從 meta.sectionId 取,取不到留空(fillEngine 只是少畫比準地區段字串)。
 */
function normalizeRegionalContent(content: Record<string, unknown> | undefined): unknown {
  if (!content) return {};
  if (looksLikeRegionalRows(content)) return regionalRowsToAnalysisContent(content, "");
  const rows = (content as { regionalFactors?: unknown }).regionalFactors;
  if (looksLikeRegionalRows(rows)) {
    const sectionId =
      typeof (content as any).meta?.sectionId === "string" ? (content as any).meta.sectionId : "";
    return regionalRowsToAnalysisContent(rows, sectionId);
  }
  return content; // 已是 comparison content tree
}

/** 是否為前端 ComparisonForm（表4 定稿，帶 benchmark + cases[]）。 */
function looksLikeComparisonForm(v: unknown): v is ComparisonForm {
  return (
    typeof v === "object" &&
    v !== null &&
    "benchmark" in v &&
    typeof (v as any).benchmark === "object" &&
    Array.isArray((v as any).cases)
  );
}

/**
 * 表3(表4):把 req.comparison 正規化成 fill-individual-analysis 吃的 content tree。
 * 接受:① 前端 ComparisonForm(benchmark + cases[]) → comparisonFormToContentTree 轉；
 *       ② 已是 content tree(含 categories) → 原樣。
 */
function normalizeComparison(comparison: Record<string, unknown>): unknown {
  // ComparisonForm 的 cases[].rates 是 ComparisonCaseRates（非 Record<string,number>），與 mapper
  // 的寬鬆參數型別不完全相容,但結構一致;用 unknown 中轉避免 nominal 型別噪音。
  if (looksLikeComparisonForm(comparison)) {
    return comparisonFormToContentTree(
      comparison as unknown as { benchmark: Record<string, unknown>; cases: Record<string, unknown>[] },
    );
  }
  return comparison; // 已是 content tree
}

// POST a fill-* lambda a JSON body, expect a base64 PDF back (isBase64Encoded response from
// a Function URL is transparently decoded by the runtime, so res.arrayBuffer() is raw PDF bytes).
async function fillTable(url: string, body: unknown, label: string): Promise<Uint8Array> {
  const res = await fetchWithTimeout(
    url,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    FILL_TIMEOUT_MS,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new UpstreamError(`${label} HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

// Decode a base64 PDF payload, tolerating a data: URL prefix a browser may emit (same as fill-report).
function decodeBase64(value: string): Uint8Array {
  const comma = value.indexOf(",");
  const b64 = value.startsWith("data:") && comma !== -1 ? value.slice(comma + 1) : value;
  return new Uint8Array(Buffer.from(b64, "base64"));
}

interface SkippedAsset {
  source: string;
  reason: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

// s3Keys:直接從 dataBucket 讀,不經 image-upload 的下載路由(那條受 Function URL 回應 6 MB 限制)。
// 每個 key 各自 best-effort —— 讀不到(不存在 / 不在 case-images/* 權限內)或格式不支援就記進
// skipped,不影響其他段落。並行讀,Promise.all 保序,併入順序就是 s3Keys 的順序。
async function s3KeysToParts(keys: string[], skipped: SkippedAsset[]): Promise<ReportPart[]> {
  const bucket = process.env.ASSET_BUCKET?.trim();
  if (!bucket) {
    for (const key of keys) skipped.push({ source: key, reason: "ASSET_BUCKET 未設定" });
    return [];
  }
  const results = await Promise.all(
    keys.map(async (key): Promise<ReportPart | null> => {
      try {
        const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!out.Body) throw new Error("empty object body");
        const pdf = await assetToPdf(await out.Body.transformToByteArray());
        return { name: `image:${key}`, pdf };
      } catch (err) {
        skipped.push({ source: key, reason: errorMessage(err) });
        return null;
      }
    }),
  );
  return results.filter((p): p is ReportPart => p !== null);
}

// 沒帶 s3Keys 時的舊路徑:image-upload GET ?caseId= 列出該案圖片,再逐張從每筆的 `url`(image-upload
// 自己的下載路由)抓。沒有 url 的(舊版 image-upload)與抓不到/轉不了的一樣記進 skipped。
interface ImageItem {
  s3Key: string;
  fileName: string;
  url?: string;
}

async function caseImagesToParts(
  imageUploadUrl: string,
  caseId: string,
  skipped: SkippedAsset[],
): Promise<ReportPart[]> {
  const listUrl = new URL(imageUploadUrl);
  listUrl.searchParams.set("caseId", caseId);
  const res = await fetchWithTimeout(listUrl.toString(), { method: "GET" }, IMAGE_TIMEOUT_MS);
  if (!res.ok) {
    throw new UpstreamError(`image-upload list HTTP ${res.status}`);
  }
  const payload = (await res.json()) as { images?: ImageItem[] };

  const parts: ReportPart[] = [];
  for (const item of payload.images ?? []) {
    if (!item.url) {
      skipped.push({ source: item.s3Key, reason: "image-upload 列表沒有 url(舊版 image-upload)" });
      continue;
    }
    try {
      const imgRes = await fetchWithTimeout(item.url, { method: "GET" }, IMAGE_TIMEOUT_MS);
      if (!imgRes.ok) throw new Error(`download HTTP ${imgRes.status}`);
      const pdf = await assetToPdf(new Uint8Array(await imgRes.arrayBuffer()));
      parts.push({ name: `image:${item.fileName}`, pdf });
    } catch (err) {
      skipped.push({ source: item.s3Key, reason: errorMessage(err) });
    }
  }
  return parts;
}

/**
 * export-report handler (= POST /api/export, 流程 H, 斷點3 路 B).
 *
 * 產表1/表2/表3 的 PDF(打三支填表 lambda)+ 併入前端附的三張地圖 + 圖片頁(s3Keys 直讀 S3,
 * 或 caseId 經 image-upload),在本支依報告順序合併,寫進 S3 後回 JSON { url, s3Key, … }。
 * 缺段就跳過;完全沒東西可合回 400;填表上游失敗回 502;寫 S3 失敗等其他錯誤回 500。
 */
export async function handler(event: FunctionUrlEvent): Promise<LambdaResponse> {
  const method = event.requestContext?.http?.method ?? "GET";
  // OPTIONS preflight 由 Function URL 原生 CORS 處理,通常不會進到 handler;保留一個
  // 極簡分支當保險,但不自己回 CORS header(避免與 Function URL 重複)。
  if (method === "OPTIONS") {
    return { statusCode: 204, headers: {}, body: "" };
  }
  if (method !== "POST") {
    return errorResponse(405, `Method ${method} not allowed.`);
  }

  let req: ExportReportRequest;
  try {
    req = parseRequest(event);
  } catch (err) {
    if (err instanceof BadRequestError) return errorResponse(400, err.message);
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(400, `Invalid request: ${message}`);
  }

  try {
    const parts: ReportPart[] = [];
    const skipped: SkippedAsset[] = [];

    // ① 表1 勘查表(比準地 + 各比較標的):前端定稿 SurveyField[] → content tree(已是 tree 則原樣)。
    // 各張互不相依,並行打填表 lambda;Promise.all 保序,併入順序就是 surveys 的順序。
    if (req.surveys.length > 0) {
      const url = readEnvUrl("FILL_DISTRICT_SURVEY_URL");
      const pdfs = await Promise.all(
        req.surveys.map((s, i) => fillTable(url, normalizeSurvey(s), `fill-district-survey[${i}]`)),
      );
      pdfs.forEach((pdf, i) => {
        parts.push({ name: surveyPartName(req.surveys[i]!, i, req.surveys.length), pdf });
      });
    }
    // ② 表2 區域因素評分(依 purpose 選範本)：前端 RegionalFactorRow[] → comparison content tree。
    if (req.regional) {
      const content = normalizeRegionalContent(req.regional.content);
      const body = { purpose: req.regional.purpose, content };
      const pdf = await fillTable(readEnvUrl("FILL_REGIONAL_ANALYSIS_URL"), body, "fill-regional-analysis");
      parts.push({ name: "table2-regional", pdf });
    }
    // ③ 表3 比較法估價表：前端 ComparisonForm(benchmark+cases) → content tree(已是 tree 則原樣)。
    if (req.comparison) {
      const content = normalizeComparison(req.comparison);
      const pdf = await fillTable(readEnvUrl("FILL_INDIVIDUAL_ANALYSIS_URL"), content, "fill-individual-analysis");
      parts.push({ name: "table3-comparison", pdf });
    }
    // ④ 三張地圖(前端 Leaflet 產,直接併入)
    for (const [i, m] of (req.maps ?? []).entries()) {
      parts.push({ name: m.name ?? `map-${i + 1}`, pdf: decodeBase64(m.pdfBase64) });
    }
    // ⑤ 使用者上傳圖片:s3Keys 有帶就只用它(直讀 S3);否則才依 caseId 經 image-upload 取回
    if (req.s3Keys) {
      parts.push(...(await s3KeysToParts(req.s3Keys, skipped)));
    } else if (req.caseId) {
      parts.push(...(await caseImagesToParts(readEnvUrl("IMAGE_UPLOAD_URL"), req.caseId, skipped)));
    }
    if (skipped.length > 0) {
      console.warn("[export-report] 略過無法併入的圖片:", JSON.stringify(skipped));
    }

    if (parts.length === 0) {
      return errorResponse(
        400,
        "沒有任何可合併的段落。至少要提供 surveys(或 survey) / regional / comparison / maps 之一。",
      );
    }

    // ⑥ 合併 → ⑦ 寫 S3,回下載網址(PDF 不放回應裡,避開 Function URL 6 MB 回應上限)
    const merged = await mergeParts(parts);
    const { url, s3Key } = await uploadReport(merged, req.caseId);
    const pageCount = (await PDFDocument.load(merged, { updateMetadata: false })).getPageCount();
    return {
      statusCode: 200,
      headers: { ...JSON_HEADERS, "x-export-skipped-count": String(skipped.length) },
      body: JSON.stringify({
        url,
        s3Key,
        sizeBytes: merged.length,
        pageCount,
        skippedCount: skipped.length,
      }),
    };
  } catch (err) {
    if (err instanceof UpstreamError) return errorResponse(502, `export-report 上游失敗：${err.message}`);
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(500, message);
  }
}
