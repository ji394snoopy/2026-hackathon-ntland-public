// image-upload — 案件圖片上傳/列表 (流程 G).
//
// 上傳使用者在「結果報告前」要一併呈現的圖片到 S3,並依 caseId 列出某案已上傳的圖片。
// 由「線 B」建立 infra(此檔前身為回 501 的 stub);C-G 在此填實作,**不碰共用 infra 檔**
// (bedrock-stack.ts / bin/app.ts / lambdas.json / build-lambdas.mjs)。
//
// infra(B 已備妥,C 不動):
//   - env  ASSET_BUCKET  圖片存這個 bucket(= AssetStack dataBucket)
//   - env  S3_PREFIX     前綴(如 "case-images"),圖片落在 <S3_PREFIX>/<caseId>/ 下
//   - IAM  props.dataBucket.grantReadWrite(fn)  => PutObject / GetObject / ListBucket
//   - @aws-sdk/client-s3 走 Node 22 runtime 內建、external(不 bundle)。
//
// 契約(以本檔頭為準;API_INTEGRATION.md 未定義流程 G):
//   POST  { caseId, fileName, contentType, dataBase64 }
//         -> PutObject 到 s3://<ASSET_BUCKET>/<S3_PREFIX>/<caseId>/<fileName>
//         -> { ok: true, s3Key }
//   GET   ?caseId=
//         -> ListObjectsV2(Prefix = <S3_PREFIX>/<caseId>/)
//         -> { caseId, images: ImageItem[] }
//   GET   ?caseId=&fileName=
//         -> GetObject -> 直接回二進位圖片(isBase64Encoded)
//   OPTIONS -> 204
//   錯誤:缺欄位 / 非法檔名 400、找不到圖片 404、S3 失敗 502、其他 method 405。
//
// 為什麼要有下載路由:dataBucket 是 private(CloudFront OAC),export-report 拿不到可直接抓的
// url 就會把每張圖都略過,匯出的報告就少了整個圖片段落。與其發簽名 URL 或串 CloudFront domain,
// 這裡直接讓本支自己當圖片來源 —— Function URL 是 authType NONE,export-report fetch 得到,
// 而且讀檔權限就是 lambda 既有的 dataBucket.grantReadWrite,不必再開 bucket 或加 IAM。
// 因此列表的每一筆會多回 url(指回本支的下載路由)+ contentType(ListObjectsV2 拿不到,依副檔名推導)。
//
// 型別(草案,若前端確認後再調整):
//   type ImageUploadRequest  = { caseId: string; fileName: string; contentType: string; dataBase64: string };
//   type ImageUploadResponse = { ok: boolean; s3Key: string };
//   type ImageItem           = { s3Key: string; fileName: string; size?: number; lastModified?: string; contentType?: string; url?: string };
//   type ListImagesResponse  = { caseId: string; images: ImageItem[] };

import {
    GetObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";

// Lambda Function URL event/response (subset), same shape as the other infra handlers.
// domainName is the Function URL's own host (`<id>.lambda-url.<region>.on.aws`) — used to
// build the self-referencing download url returned by the list route.
interface FunctionUrlEvent {
  requestContext?: { http?: { method?: string }; domainName?: string };
  queryStringParameters?: Record<string, string | undefined> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}

interface ImageItem {
  s3Key: string;
  fileName: string;
  size?: number;
  lastModified?: string;
  contentType?: string;
  url?: string;
}

// CORS 交給 Function URL 原生設定(CDK 的 FunctionUrl cors 屬性,allowedOrigins ["*"]),
// 這裡不要再手動加 access-control-allow-origin,否則帶 Origin 的請求會出現兩個
// Access-Control-Allow-Origin header,瀏覽器判定 CORS 失敗。
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
} as const;

function json(statusCode: number, payload: unknown): LambdaResponse {
  return { statusCode, headers: { ...JSON_HEADERS }, body: JSON.stringify(payload) };
}

class BadRequestError extends Error {}
class NotFoundError extends Error {}

// Module-scope singleton S3 client — reused across warm invocations (mirrors the
// facilities / case-store / factor-standard-store client-reuse pattern). Region and
// credentials come from the Lambda execution environment.
const s3 = new S3Client({});

// Prefix without trailing slashes, from env (defaults to "case-images" to match the
// bucket layout B provisioned). ASSET_BUCKET is required at request time, not import time,
// so a misconfigured env surfaces as a clean 502 rather than a cold-start crash.
function prefix(): string {
  return (process.env.S3_PREFIX ?? "case-images").replace(/\/+$/, "");
}

function requireBucket(): string {
  const bucket = process.env.ASSET_BUCKET;
  if (!bucket) throw new Error("ASSET_BUCKET is not configured.");
  return bucket;
}

// Parses the POST body as a JSON object (base64-decoding first when the Function URL
// flagged the whole body as base64 — distinct from the inner dataBase64 image payload).
function readBody(event: FunctionUrlEvent): Record<string, unknown> {
  if (!event.body) throw new BadRequestError("POST requires a JSON body.");
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

function query(event: FunctionUrlEvent): Record<string, string | undefined> {
  return event.queryStringParameters ?? {};
}

// Rejects any path-traversal attempt in a single S3 key segment. caseId and fileName each
// become one segment of <prefix>/<caseId>/<fileName>, so they must not contain "/" (which
// would inject extra segments), ".." (parent escape), NUL, or leading dots/whitespace.
// Anything unsafe is a 400 rather than a silently rewritten key — the bucket is shared
// with facilities geojson and the 缺口① PDFs, so we don't want writes leaking outside
// <prefix>/<caseId>/.
function sanitizeSegment(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BadRequestError(`${field} (non-empty string) is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new BadRequestError(`${field} must not be blank.`);
  }
  if (
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0") ||
    trimmed.split(/[/\\]/).includes("..") ||
    trimmed === ".." ||
    trimmed === "." ||
    trimmed.startsWith(".")
  ) {
    throw new BadRequestError(`${field} contains an illegal path segment.`);
  }
  return trimmed;
}

// Best-effort content type from a file extension. ListObjectsV2 doesn't return an object's
// ContentType, so the list route derives it this way; the download route only falls back to
// it when the stored object has no (or a generic) ContentType. Consumers that embed images
// into PDFs (export-report) need image/png or image/jpeg specifically — pdf-lib supports
// nothing else — so anything unrecognised is left undefined rather than guessed.
function guessContentType(fileName: string): string | undefined {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return undefined;
}

// POST: upload one image to <prefix>/<caseId>/<fileName>.
async function handlePost(event: FunctionUrlEvent): Promise<LambdaResponse> {
  const body = readBody(event);
  const caseId = sanitizeSegment(body.caseId, "caseId");
  const fileName = sanitizeSegment(body.fileName, "fileName");
  const contentType =
    typeof body.contentType === "string" && body.contentType.length > 0
      ? body.contentType
      : "application/octet-stream";
  if (typeof body.dataBase64 !== "string" || body.dataBase64.length === 0) {
    throw new BadRequestError("dataBase64 (base64 image content) is required.");
  }

  const bucket = requireBucket();
  const s3Key = `${prefix()}/${caseId}/${fileName}`;
  const data = Buffer.from(body.dataBase64, "base64");

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: data,
      ContentType: contentType,
    }),
  );

  // Key only; the fetchable url comes from the list route (GET ?caseId=), which knows the
  // Function URL domain for every item at once.
  return json(200, { ok: true, s3Key });
}

// The public download url for one image — this same lambda's Function URL with both query
// params set. domainName is absent when invoked outside a Function URL (invoke-local, direct
// SDK invoke), in which case the list route simply omits `url`.
function downloadUrl(event: FunctionUrlEvent, caseId: string, fileName: string): string | undefined {
  const domain = event.requestContext?.domainName;
  if (!domain) return undefined;
  return `https://${domain}/?caseId=${encodeURIComponent(caseId)}&fileName=${encodeURIComponent(fileName)}`;
}

// GET ?caseId= : list the images already uploaded for a case.
async function handleList(event: FunctionUrlEvent, caseId: string): Promise<LambdaResponse> {
  const bucket = requireBucket();
  const keyPrefix = `${prefix()}/${caseId}/`;

  const images: ImageItem[] = [];
  let continuationToken: string | undefined;
  do {
    const out = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: keyPrefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of out.Contents ?? []) {
      const key = obj.Key;
      if (!key || key === keyPrefix) continue; // skip the (rare) prefix placeholder
      const fileName = key.slice(keyPrefix.length);
      images.push({
        s3Key: key,
        fileName,
        size: obj.Size,
        lastModified: obj.LastModified?.toISOString(),
        contentType: guessContentType(fileName),
        url: downloadUrl(event, caseId, fileName),
      });
    }
    continuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (continuationToken);

  return json(200, { caseId, images });
}

// GET ?caseId=&fileName= : stream one image back as raw bytes, so consumers (export-report)
// can fetch it straight from the `url` the list route hands out without the bucket being
// public. fileName goes through the same sanitizeSegment as the upload path, so a crafted
// name can't read outside <prefix>/<caseId>/.
//
// Function URL responses are capped at 6 MB and base64 inflates by ~33%, so this tops out
// around a 4.5 MB image; anything larger fails at the Function URL, not here.
async function handleDownload(caseId: string, fileName: string): Promise<LambdaResponse> {
  const bucket = requireBucket();
  const s3Key = `${prefix()}/${caseId}/${fileName}`;

  let out;
  try {
    out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    const name = err instanceof Error ? err.name : "";
    if (status === 404 || name === "NoSuchKey" || name === "NotFound") {
      throw new NotFoundError(`No image at ${s3Key}.`);
    }
    throw err;
  }

  if (!out.Body) throw new NotFoundError(`No image at ${s3Key}.`);
  const bytes = await out.Body.transformToByteArray();
  // Prefer what was stored, but fall back to the extension when the upload didn't declare a
  // type (POST defaults to application/octet-stream) — an octet-stream PNG is unembeddable.
  const stored = out.ContentType;
  const contentType =
    stored && stored !== "application/octet-stream"
      ? stored
      : guessContentType(fileName) ?? "application/octet-stream";

  return {
    statusCode: 200,
    headers: {
      "content-type": contentType,
      "content-disposition": `inline; filename="${encodeURIComponent(fileName)}"`,
    },
    body: Buffer.from(bytes).toString("base64"),
    isBase64Encoded: true,
  };
}

// GET routing: ?caseId=&fileName= downloads one image, ?caseId= alone lists them.
async function handleGet(event: FunctionUrlEvent): Promise<LambdaResponse> {
  const params = query(event);
  const caseId = sanitizeSegment(params.caseId, "caseId");
  if (params.fileName != null && params.fileName !== "") {
    return await handleDownload(caseId, sanitizeSegment(params.fileName, "fileName"));
  }
  return await handleList(event, caseId);
}

/**
 * image-upload handler (流程 G).
 *
 * POST 上傳一張圖到 <ASSET_BUCKET>/<S3_PREFIX>/<caseId>/<fileName>;GET ?caseId= 列該案
 * 已上傳圖片(每筆含指回本支的 url);GET ?caseId=&fileName= 直接回該張圖的二進位內容,
 * 讓 export-report 抓得到、能把圖併進匯出的報告 PDF。
 */
export async function handler(event: FunctionUrlEvent): Promise<LambdaResponse> {
  const method = event.requestContext?.http?.method ?? "GET";
  try {
    if (method === "OPTIONS") return json(204, {});
    if (method === "POST") return await handlePost(event);
    if (method === "GET") return await handleGet(event);
    return json(405, { error: `Method ${method} not allowed.` });
  } catch (err) {
    if (err instanceof BadRequestError) return json(400, { error: err.message });
    if (err instanceof NotFoundError) return json(404, { error: err.message });
    const message = err instanceof Error ? err.message : String(err);
    return json(502, { error: `image-upload failed: ${message}` });
  }
}
