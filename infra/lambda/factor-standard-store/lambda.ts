import { S3Client } from "@aws-sdk/client-s3";
import { closeRepo, getRepo } from "./db.js";
import {
    getFactorStandard,
    listFactorStandard,
    saveFactorStandard,
    type S3Config,
} from "./store.js";

// Re-exported for local test harnesses to release the repo and exit cleanly. Unused by
// the Lambda runtime itself (it freezes/reuses the execution environment between calls).
export { closeRepo };

// Lambda Function URL event/response (subset). Routing:
//   POST                         -> save one record ({ fileName, extracted, label?, pdfBase64?, s3Key? })
//   GET  ?id= | ?fileName=&version= | ?fileName=   -> get one full record (incl. extracted)
//   GET  (no id, no fileName, or only filters)      -> list metadata (?fileName= and/or ?label=)
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

// Parses the POST body as a JSON object (base64-decoding first if the Function URL flagged
// it). GET has no body — POST is the only method that carries one here.
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

// Builds the S3 config from env. Returns null when no bucket is configured (pdfBase64
// uploads then error out in store.ts, but callers can still pass a pre-made s3Key).
function s3ConfigFromEnv(): S3Config | null {
  const bucket = process.env.ASSET_BUCKET;
  if (!bucket) return null;
  return {
    client: new S3Client({}),
    bucket,
    prefix: (process.env.S3_PREFIX ?? "factor-standard").replace(/\/+$/, ""),
  };
}

async function handlePost(event: FunctionUrlEvent): Promise<JsonResponse> {
  const body = readBody(event);
  const fileName = body.fileName;
  const extracted = body.extracted;
  if (typeof fileName !== "string" || fileName.length === 0) {
    return json(400, { error: "fileName (non-empty string) is required." });
  }
  if (extracted === undefined || extracted === null) {
    return json(400, { error: "extracted (the digitization result JSON) is required." });
  }
  const label = typeof body.label === "string" ? body.label : null;
  const pdfBase64 = typeof body.pdfBase64 === "string" ? body.pdfBase64 : undefined;
  const s3Key = typeof body.s3Key === "string" ? body.s3Key : undefined;

  const repo = getRepo();
  const meta = await saveFactorStandard(repo, s3ConfigFromEnv(), {
    fileName,
    extracted,
    label,
    pdfBase64,
    s3Key,
  });
  return json(200, meta);
}

async function handleGet(event: FunctionUrlEvent): Promise<JsonResponse> {
  const q = query(event);
  const repo = getRepo();

  // Single-record fetch: ?id=, or ?fileName= (+ optional &version=).
  if (q.id != null && q.id !== "") {
    const id = Number(q.id);
    if (!Number.isInteger(id)) return json(400, { error: "id must be an integer." });
    const record = await getFactorStandard(repo, { id });
    if (!record) return json(404, { error: `No factor_standard with id=${id}.` });
    return json(200, record);
  }

  const fileName = q.fileName;
  const hasVersion = q.version != null && q.version !== "";

  // ?fileName= (with or without &version=) -> single full record.
  // ?fileName= is also a list filter, but when present alone we treat it as "get the
  // latest version for this file" (the common reuse path). To list all versions of a
  // file without fetching extracted, callers can still use it as a filter — but since a
  // fileName resolves to one record, list mode is entered only when no fileName is given
  // OR only ?label= is given. See below.
  if (fileName != null && fileName !== "" && (hasVersion || q.list !== "1")) {
    const version = hasVersion ? Number(q.version) : undefined;
    if (version !== undefined && !Number.isInteger(version)) {
      return json(400, { error: "version must be an integer." });
    }
    const record = await getFactorStandard(repo, { fileName, version });
    if (!record) {
      const suffix = version !== undefined ? ` version=${version}` : " (latest)";
      return json(404, { error: `No factor_standard for fileName=${fileName}${suffix}.` });
    }
    return json(200, record);
  }

  // List mode: no id, and either no fileName or an explicit ?list=1. Filters: fileName,
  // label. Returns lightweight metadata (no extracted).
  const list = await listFactorStandard(repo, {
    fileName: fileName || undefined,
    label: q.label || undefined,
  });
  return json(200, list);
}

/**
 * factor-standard-store CRUD.
 *
 * Stores and retrieves digitization results of 評價基準明細表 (the output of the separate
 * factor-standard-extract lambda) so users can reuse a previously extracted version
 * instead of re-invoking Bedrock each time. Persists to the `factor_standard` table in
 * the gis DB via the RDS Data API, and the original PDF to the AssetStack dataBucket.
 *
 *   POST  { fileName, extracted, label?, pdfBase64?, s3Key? }  -> save, returns metadata
 *   GET   ?id= | ?fileName=(&version=)                          -> get one full record
 *   GET   ?fileName=&list=1 | ?label= | (nothing)               -> list metadata
 */
export async function handler(event: FunctionUrlEvent): Promise<JsonResponse> {
  const method = event.requestContext?.http?.method ?? "GET";

  try {
    if (method === "OPTIONS") return json(204, {});
    if (method === "POST") return await handlePost(event);
    if (method === "GET") return await handleGet(event);
    return json(405, { error: `Method ${method} not allowed.` });
  } catch (err) {
    if (err instanceof BadRequestError) return json(400, { error: err.message });
    const message = err instanceof Error ? err.message : String(err);
    return json(502, { error: `factor-standard-store failed: ${message}` });
  }
}
