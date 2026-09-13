// land-value — 土地公告地價/公告土地現值查詢 + 年度比較 (= GET /api/land/value).
//
// 給一筆地號(段小段 + 地號),回傳:
//   - 最近有資料年份的 公告土地現值(official_value)與 公告地價(official_price)
//   - 往前逐年找到的「前一個有資料年份」(不必剛好差一年)
//   - 兩年的漲幅%(現值、地價各一個)
//
// 用途:比較法調查估價表(表4)的「土地正常單價」來源。現值/地價是政府逐年公告值,
// 逐年一列存在 land_official_value(99~115 年),見 infra/lambda/shared/db/schema.ts。
//
// 走共用 DB 存取層(../shared/db,Drizzle over RDS Data API),同 case-store。純讀取。
//
// 路由(Function URL):
//   GET ?district=&segment=&lid=   -> LandValueResponse (200)
//     - segment + lid 必填;district 選填(同名段跨區時用來消歧義)
//     - 找不到任何年份 -> 404
//     - 只有一年(找不到前一年)-> previous:null, growth 為 null

import { and, desc, eq } from "drizzle-orm";
import { getDb, landOfficialValue } from "../shared/db";

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
class NotFoundError extends Error {}

function query(event: FunctionUrlEvent): Record<string, string | undefined> {
  return event.queryStringParameters ?? {};
}

/** 單一年份的公告值(numeric 欄由 Data API 讀回為 string,轉成 number;缺值 null)。 */
interface YearValue {
  year: number;
  officialValue: number | null; // 公告土地現值(元/㎡)
  officialPrice: number | null; // 公告地價(元/㎡)
}

interface LandValueResponse {
  district: string | null;
  segment: string;
  lid: string;
  latest: YearValue;
  previous: YearValue | null;
  /** 現值漲幅%:(latest - previous)/previous × 100;缺前一年或前一年為 0/缺值 → null。 */
  valueGrowthPct: number | null;
  /** 地價漲幅%:同上,用公告地價。 */
  priceGrowthPct: number | null;
}

function toNum(v: string | number | null): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 漲幅%,四捨五入到小數 2 位。base 為 null/0 時無法計算 → null。 */
function growthPct(latest: number | null, base: number | null): number | null {
  if (latest === null || base === null || base === 0) return null;
  return Math.round(((latest - base) / base) * 10000) / 100;
}

async function handleLookup(event: FunctionUrlEvent): Promise<JsonResponse> {
  const q = query(event);
  const segment = (q.segment ?? "").trim();
  const lid = (q.lid ?? "").trim();
  const district = (q.district ?? "").trim() || undefined;

  if (!segment) throw new BadRequestError("segment (段小段) is required.");
  if (!lid) throw new BadRequestError("lid (地號) is required.");

  const db = getDb();
  const where = district
    ? and(
        eq(landOfficialValue.segment, segment),
        eq(landOfficialValue.lid, lid),
        eq(landOfficialValue.district, district),
      )
    : and(eq(landOfficialValue.segment, segment), eq(landOfficialValue.lid, lid));

  // 依年份 desc 取回該地號所有年份;最近年 = 第一列,前一年 = 下一列(逐年往前,
  // 資料若跳年也會取到真正的前一個有資料年份,符合「逐年往前找」的需求)。
  const rows = await db
    .select({
      district: landOfficialValue.district,
      year: landOfficialValue.year,
      officialValue: landOfficialValue.officialValue,
      officialPrice: landOfficialValue.officialPrice,
    })
    .from(landOfficialValue)
    .where(where)
    .orderBy(desc(landOfficialValue.year));

  if (rows.length === 0) {
    throw new NotFoundError(
      `No land value found for segment=${segment} lid=${lid}` +
        (district ? ` district=${district}` : "") + ".",
    );
  }

  const toYearValue = (r: (typeof rows)[number]): YearValue => ({
    year: r.year,
    officialValue: toNum(r.officialValue),
    officialPrice: toNum(r.officialPrice),
  });

  const latest = toYearValue(rows[0]);
  const previous = rows.length > 1 ? toYearValue(rows[1]) : null;

  const response: LandValueResponse = {
    district: rows[0].district,
    segment,
    lid,
    latest,
    previous,
    valueGrowthPct: previous
      ? growthPct(latest.officialValue, previous.officialValue)
      : null,
    priceGrowthPct: previous
      ? growthPct(latest.officialPrice, previous.officialPrice)
      : null,
  };

  return json(200, response);
}

/**
 * land-value handler.
 *
 * GET ?district=&segment=&lid= — 查最近年公告現值/地價 + 前一年 + 漲幅%。純讀取,
 * 走 Data API(grantDataApiAccess)。錯誤慣例比照 case-store。
 */
export async function handler(event: FunctionUrlEvent): Promise<JsonResponse> {
  const method = event.requestContext?.http?.method ?? "GET";
  try {
    if (method === "OPTIONS") return json(204, {});
    if (method === "GET") return await handleLookup(event);
    return json(405, { error: `Method ${method} not allowed.` });
  } catch (err) {
    if (err instanceof BadRequestError) return json(400, { error: err.message });
    if (err instanceof NotFoundError) return json(404, { error: err.message });
    const message = err instanceof Error ? err.message : String(err);
    return json(502, { error: `land-value failed: ${message}` });
  }
}
