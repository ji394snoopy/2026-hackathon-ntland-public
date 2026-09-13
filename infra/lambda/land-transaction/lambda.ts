// land-transaction — 實價登錄土地/房地交易歷史查詢 (= GET /api/land/transaction).
//
// 給一個地段(行政區 + 段小段),回傳該段的歷史交易案例,供比較法調查估價表(表4)求取
// 「土地正常單價」時挑參考案例用(交易日期 / 歷史交易案例)。
//
// 為什麼要同時回土地與房地(估價實務):估價師求土地正常單價時,兩類案例都要看——
//   - 交易標的「土地」:最直接的基準,可直接比較修正求土地單價;但都市內純土地案例稀少。
//   - 交易標的「房地(土地+建物)」:案例最多,需以「房地分配法」拆分——房地總價扣掉建物
//     現值(重建成本 × 折舊),回推土地貢獻價值,再除土地持分面積得土地單價。
// 故預設 kind=landhouse:同時回土地與房地(排除純車位),且**土地案例排序優先**,房地在後。
// 本支只負責「把案例與拆分所需欄位撈齊」,房地→土地的拆分/折舊計算交給下游(預計走 LLM)。
//
// 走共用 DB 存取層(../shared/db,Drizzle over RDS Data API),同 case-store。純讀取。
//
// 路由(Function URL):
//   GET ?district=&segment=[&kind=land|landhouse|all][&from=YYYY-MM-DD][&to=YYYY-MM-DD][&limit=]
//     -> LandTransactionResponse (200)
//     - segment 必填;district 選填(同名段跨區時消歧義)
//     - kind:land=只土地 / landhouse(預設)=土地+房地(排除純車位) / all=全部(含車位)
//     - from/to:交易日期區間(含邊界);limit:最多回傳筆數(預設 50,上限 200)

import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, landTransaction } from "../shared/db";

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

function query(event: FunctionUrlEvent): Record<string, string | undefined> {
  return event.queryStringParameters ?? {};
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// rps01 交易標的分類(來源實際值)。
const KIND_LAND = "土地";
const KIND_HOUSE_LAND = "房地(土地+建物)";
const KIND_HOUSE_LAND_PARKING = "房地(土地+建物)+車位";
// landhouse:土地 + 兩種房地(含房地+車位),排除純「車位」。
const LANDHOUSE_KINDS = [KIND_LAND, KIND_HOUSE_LAND, KIND_HOUSE_LAND_PARKING];

type KindMode = "land" | "landhouse" | "all";

function toNum(v: string | number | null): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function parseIsoDate(v: string | undefined, label: string): string | undefined {
  if (!v) return undefined;
  const s = v.trim();
  if (!ISO_DATE.test(s)) throw new BadRequestError(`${label} must be YYYY-MM-DD.`);
  return s;
}

/** 交易時屋齡(年):交易日期 − 建築完成日期,取整數年;任一缺值 → null。 */
function buildingAgeYears(tradeDate: string | null, buildDate: string | null): number | null {
  if (!tradeDate || !buildDate) return null;
  const t = Date.parse(tradeDate);
  const b = Date.parse(buildDate);
  if (!Number.isFinite(t) || !Number.isFinite(b) || t < b) return null;
  const years = (t - b) / (365.25 * 24 * 3600 * 1000);
  return Math.floor(years);
}

/**
 * 單筆歷史交易案例。土地案例可直接比較;房地案例需下游用「房地分配法」拆分,故一併回傳
 * 拆分所需的建物欄位(建材/樓層/型態/屋齡/建物面積)+ 房地總價 + 土地移轉面積。
 */
interface TransactionCase {
  id: string;
  district: string | null;
  segment: string | null;
  lid: string | null;
  tradeDate: string | null; // 交易日期(西元 YYYY-MM-DD)
  kind: string | null; // rps01 交易標的
  isLandOnly: boolean; // 是否為純土地(true 直接比較;false 需房地拆分)
  // --- 面積 / 價格 ---
  landArea: number | null; // rps03 土地移轉總面積(㎡)
  buildingArea: number | null; // rps15 建物移轉總面積(㎡)— 房地拆分:建物現值 ÷ 面積
  totalPrice: number | null; // rps21 總價(元)— 房地拆分:房地總價
  unitPrice: number | null; // rps22 單價(元/㎡)— 純土地可直接當土地正常單價
  // --- 分區 ---
  urbanUse: string | null; // rps04 都市土地使用分區
  nonUrbanUse: string | null; // rps05 非都市土地使用分區
  // --- 建物(房地拆分:重建成本 × 折舊 用)---
  buildingType: string | null; // rps11 建物型態(透天/公寓/大樓)
  structure: string | null; // rps13 主要建材(RC/SC…)→ 營造施工費標準
  totalFloors: string | null; // rps10 總樓層數
  buildDate: string | null; // rps14 建築完成日期(西元)
  buildingAgeYears: number | null; // 交易時屋齡(交易日 − 建築完成日)→ 折舊
  note: string | null; // rps26 備註
}

interface LandTransactionResponse {
  district: string | null;
  segment: string;
  kind: KindMode;
  count: number;
  /** 土地案例數(排序在前)。 */
  landCount: number;
  /** 房地案例數(排序在後,需拆分)。 */
  houseLandCount: number;
  cases: TransactionCase[];
}

function parseKind(raw: string | undefined): KindMode {
  const k = (raw ?? "landhouse").trim().toLowerCase();
  if (k === "land" || k === "landhouse" || k === "all") return k;
  throw new BadRequestError('kind must be "land", "landhouse", or "all".');
}

async function handleLookup(event: FunctionUrlEvent): Promise<JsonResponse> {
  const q = query(event);
  const segment = (q.segment ?? "").trim();
  const district = (q.district ?? "").trim() || undefined;
  const kind = parseKind(q.kind);
  const from = parseIsoDate(q.from, "from");
  const to = parseIsoDate(q.to, "to");

  let limit = DEFAULT_LIMIT;
  if (q.limit != null && q.limit !== "") {
    const n = Number(q.limit);
    if (!Number.isInteger(n) || n <= 0) {
      throw new BadRequestError("limit must be a positive integer.");
    }
    limit = Math.min(n, MAX_LIMIT);
  }
  if (!segment) throw new BadRequestError("segment (段小段) is required.");

  const conds = [eq(landTransaction.segment, segment)];
  if (district) conds.push(eq(landTransaction.district, district));
  if (kind === "land") conds.push(eq(landTransaction.rps01, KIND_LAND));
  else if (kind === "landhouse") conds.push(inArray(landTransaction.rps01, LANDHOUSE_KINDS));
  // kind === "all": 不加 rps01 條件(含車位)。
  if (from) conds.push(gte(landTransaction.tradeDate, from));
  if (to) conds.push(lte(landTransaction.tradeDate, to));

  // 土地案例優先:rps01='土地' 排 0、其餘排 1;同類內再依交易日期新到舊。
  const landFirst = sql`CASE WHEN ${landTransaction.rps01} = ${KIND_LAND} THEN 0 ELSE 1 END`;

  const db = getDb();
  const rows = await db
    .select({
      id: landTransaction.id,
      district: landTransaction.district,
      segment: landTransaction.segment,
      lid: landTransaction.lid,
      tradeDate: landTransaction.tradeDate,
      kind: landTransaction.rps01,
      landArea: landTransaction.rps03Area,
      buildingArea: landTransaction.rps15Area,
      totalPrice: landTransaction.rps21Amount,
      unitPrice: landTransaction.rps22Unit,
      urbanUse: landTransaction.rps04,
      nonUrbanUse: landTransaction.rps05,
      buildingType: landTransaction.rps11,
      structure: landTransaction.rps13,
      totalFloors: landTransaction.rps10,
      buildDate: landTransaction.buildDate,
      note: landTransaction.rps26,
    })
    .from(landTransaction)
    .where(and(...conds))
    // 土地優先 → 交易日期新到舊(desc)→ id 穩定排序。
    .orderBy(landFirst, sql`${landTransaction.tradeDate} DESC NULLS LAST`, asc(landTransaction.id))
    .limit(limit);

  const cases: TransactionCase[] = rows.map((r) => {
    const isLandOnly = r.kind === KIND_LAND;
    return {
      id: r.id,
      district: r.district,
      segment: r.segment,
      lid: r.lid,
      tradeDate: r.tradeDate,
      kind: r.kind,
      isLandOnly,
      landArea: toNum(r.landArea),
      buildingArea: toNum(r.buildingArea),
      totalPrice: toNum(r.totalPrice),
      unitPrice: toNum(r.unitPrice),
      urbanUse: r.urbanUse,
      nonUrbanUse: r.nonUrbanUse,
      buildingType: r.buildingType,
      structure: r.structure,
      totalFloors: r.totalFloors,
      buildDate: r.buildDate,
      buildingAgeYears: isLandOnly ? null : buildingAgeYears(r.tradeDate, r.buildDate),
      note: r.note,
    };
  });

  const landCount = cases.filter((c) => c.isLandOnly).length;

  const response: LandTransactionResponse = {
    district: district ?? null,
    segment,
    kind,
    count: cases.length,
    landCount,
    houseLandCount: cases.length - landCount,
    cases,
  };
  return json(200, response);
}

/**
 * land-transaction handler.
 *
 * GET ?district=&segment= — 查該段歷史交易案例(土地優先、房地在後,依交易日期排序;
 * 預設 kind=landhouse 同時回土地與房地,排除純車位)。純讀取,走 Data API
 * (grantDataApiAccess)。錯誤慣例比照 case-store。
 */
export async function handler(event: FunctionUrlEvent): Promise<JsonResponse> {
  const method = event.requestContext?.http?.method ?? "GET";
  try {
    if (method === "OPTIONS") return json(204, {});
    if (method === "GET") return await handleLookup(event);
    return json(405, { error: `Method ${method} not allowed.` });
  } catch (err) {
    if (err instanceof BadRequestError) return json(400, { error: err.message });
    const message = err instanceof Error ? err.message : String(err);
    return json(502, { error: `land-transaction failed: ${message}` });
  }
}
