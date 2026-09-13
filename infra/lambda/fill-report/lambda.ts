// fill-report — 匯出用 PDF 合併器 (流程 H, 純 pdf-lib).
//
// 角色:把前端各段已各自產好的 PDF(表1 勘查表 / 表5 區域因素分析明細表 / 表4 比較法調查
// 估價表 + 地價區段略圖 / 使用分區圖 / 查估地價區段圖)合併成「同一份」PDF 回傳。
//
// 為什麼是「合併」而不是「重畫」:
//   - 前端(frontend/src/lib/exportPdf.ts)已用 html2canvas + jsPDF 把每一段官方版式各自產成
//     PDF;三張圖是 Leaflet 地圖,只能在瀏覽器產,後端無法從資料重建。因此後端唯一能產出
//     「完整三表三圖合一」的作法就是收各段 PDF、串接成一份 —— 不重造版式、不碰字型/範本/座標。
//   - 表1 版式由 fill-district-survey 處理、表5/表4 版式由前端 Printable* 元件處理;本支只負責
//     把它們「合併成同一份」。
//
// 契約(對齊 API_INTEGRATION.md §5 /api/export → PDF,本支聚焦「輸出單一合併 PDF」):
//   入(POST body,JSON;body 可能 base64,依 Function URL isBase64Encoded):
//     type FillReportRequest = {
//       files: Array<{ name?: string; pdfBase64: string }>; // 依陣列順序合併,每份可多頁
//     };
//     // 相容:body 也可直接是 { pdfBase64 } 單筆、或 [{ pdfBase64 }, ...] 裸陣列。
//   出:合併後的單一 base64 PDF(isBase64Encoded: true, content-type: application/pdf)。
//     順序 = 傳入 files 的順序(前端目前用:勘查表→區域因素→比較法→略圖→分區圖→區段圖)。
//     各來源頁面的尺寸/方向(直式表格、橫式地圖)原樣保留。
//
// infra:純運算,無額外 IAM / env。bundle pdf-lib(esbuild;@aws-sdk/* external,pdf-lib 會被打包)。
//   合併走 PDFDocument.create + copyPages,不需字型/fontkit。output_type = PDF。

import { PDFDocument } from "pdf-lib";

// AWS Lambda Function URL event/response shapes (subset), same shape as the other infra
// handlers (see fill-district-survey). Inline so the handler carries no aws-lambda type
// dependency to bundle.
interface FunctionUrlEvent {
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext?: { http?: { method?: string } };
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

interface InputFile {
  name?: string;
  pdfBase64: string;
}

// Normalize the many accepted body shapes into a flat, ordered list of source PDFs:
//   - { files: [{ name?, pdfBase64 }, ...] }  (canonical)
//   - [{ pdfBase64 }, ...]                    (bare array)
//   - { pdfBase64 }                           (single file)
// Anything else -> [] (caller error, surfaced as 400 upstream).
function collectFiles(parsed: unknown): InputFile[] {
  const pick = (v: any): InputFile | null =>
    v && typeof v === "object" && typeof v.pdfBase64 === "string"
      ? { name: typeof v.name === "string" ? v.name : undefined, pdfBase64: v.pdfBase64 }
      : null;

  if (Array.isArray(parsed)) {
    return parsed.map(pick).filter((f): f is InputFile => f !== null);
  }
  if (parsed && typeof parsed === "object") {
    const files = (parsed as any).files;
    if (Array.isArray(files)) {
      return files.map(pick).filter((f): f is InputFile => f !== null);
    }
    const single = pick(parsed);
    if (single) return [single];
  }
  return [];
}

// Parse the request body into the source-file list. The Function URL POST body may be
// base64-encoded (isBase64Encoded); empty body -> [] (surfaced as a 400 by the handler).
function parseFiles(event: FunctionUrlEvent): InputFile[] {
  const raw = event.body;
  if (!raw) return [];
  const text = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf-8") : raw;
  const trimmed = text.trim();
  if (!trimmed) return [];
  return collectFiles(JSON.parse(trimmed));
}

// Decode one file's base64 PDF payload, tolerating a data: URL prefix
// (e.g. "data:application/pdf;base64,....") that a browser FileReader/canvas may emit.
function decodePdf(pdfBase64: string): Uint8Array {
  const comma = pdfBase64.indexOf(",");
  const b64 = pdfBase64.startsWith("data:") && comma !== -1 ? pdfBase64.slice(comma + 1) : pdfBase64;
  return new Uint8Array(Buffer.from(b64, "base64"));
}

// Merge source PDFs into one document, preserving input order and each source's own page
// sizes/orientations. copyPages carries vector/text/image content over losslessly (not a
// raster snapshot) and brings every page of a multi-page source.
async function mergePdfs(files: InputFile[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    let src: PDFDocument;
    try {
      src = await PDFDocument.load(decodePdf(files[i].pdfBase64), { ignoreEncryption: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const label = files[i].name ? `"${files[i].name}"` : `#${i + 1}`;
      throw new Error(`Failed to load source PDF ${label}: ${message}`);
    }
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return merged.save();
}

/**
 * fill-report handler — merge exported section PDFs into a single downloadable PDF.
 *
 * POST (JSON body: { files: [{ name?, pdfBase64 }] } or a bare array / single {pdfBase64})
 * -> one merged PDF returned as base64 (isBase64Encoded). Pure pdf-lib, no Bedrock / AWS /
 * DB / fonts. Invalid JSON or no usable files is a 400; anything else is a 500.
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

  let files: InputFile[];
  try {
    files = parseFiles(event);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(400, `Invalid JSON body: ${message}`);
  }

  if (files.length === 0) {
    return errorResponse(400, "No PDF files to merge. Expected { files: [{ pdfBase64 }] }.");
  }

  try {
    const outBytes = await mergePdfs(files);
    return {
      statusCode: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'inline; filename="report-merged.pdf"',
      },
      body: Buffer.from(outBytes).toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(500, message);
  }
}
