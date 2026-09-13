import { closeRepo, getRepo } from "./db.js";
import { InvalidInputError, parseArea } from "./input.js";
import { queryFacilities } from "./query.js";

// Re-exported for local test harnesses to release the repo and exit cleanly. Unused by
// the Lambda runtime itself (it freezes/reuses the execution environment rather than
// tearing it down between invocations). Aliased to closePool for run-local.mjs, which
// still imports { closePool } — keeps the harness working without a change.
export { closeRepo as closePool, closeRepo };

// Lambda Function URL event/response (subset). Supports both:
//   GET  ?lon=&lat=&radius=   or  ?poly=lon,lat;lon,lat;...
//   POST { "center":[lon,lat], "radius":500 }  or  { "polygon": <GeoJSON Polygon> }
// A polygon WITH a radius means "search the radius around this polygon's centroid"; either
// form may add "point": [lon,lat] to get a second distance per hit (see input.ts).
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

function readInput(event: FunctionUrlEvent): Record<string, unknown> {
  const method = event.requestContext?.http?.method ?? "GET";
  if (method === "POST" && event.body) {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
      throw new InvalidInputError("Request body must be a JSON object.");
    } catch (err) {
      if (err instanceof InvalidInputError) throw err;
      throw new InvalidInputError("Request body is not valid JSON.");
    }
  }
  // GET: query-string params (all strings) feed the same parser.
  return (event.queryStringParameters ?? {}) as Record<string, unknown>;
}

/**
 * facilities-in-area query.
 *
 * Give it an area (polygon, center + radius, or polygon + radius = the polygon's centroid
 * + radius) and it returns the point facilities (metro / HSR / bus stops) inside it with
 * each one's distance to the area center — and, when the caller names a `point`, a second
 * distance to that point — plus a door-plate address summary (count + nearest few). Queries
 * the PostGIS DB through a swappable repo (FACILITIES_DB_DRIVER): direct `pg` locally, RDS
 * Data API when deployed.
 */
export async function handler(event: FunctionUrlEvent): Promise<JsonResponse> {
  let area;
  try {
    area = parseArea(readInput(event));
  } catch (err) {
    if (err instanceof InvalidInputError) return json(400, { error: err.message });
    return json(400, { error: err instanceof Error ? err.message : String(err) });
  }

  // NLSC live-API enrichment is on by default; set FACILITIES_INCLUDE_NLSC to
  // 0/false/off to skip it (offline demo, or DB-only tests without network).
  const nlscEnv = (process.env.FACILITIES_INCLUDE_NLSC ?? "").toLowerCase();
  const includeNlsc = !["0", "false", "off", "no"].includes(nlscEnv);

  try {
    const repo = await getRepo();
    const result = await queryFacilities(repo, area, { includeNlsc });
    return json(200, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json(502, { error: `query failed: ${message}` });
  }
}
