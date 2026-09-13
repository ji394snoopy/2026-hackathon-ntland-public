// land-easymap — 地籍圖資便民系統即時查詢 (= GET /api/land/easymap)。
//
// 給 (縣市, 行政區, 段名, 地號),即時打 easymap.moi.gov.tw 回:
//   - 宗地定位點(WGS84 經緯度;是「定位點」不是界址點)
//   - 面積(㎡ / 坪)、公告現值、公告地價,以及兩者 × 面積的總價
//   - 地政事務所 / 行政區 / 地段(代碼 + 名稱)/ 土地參考資訊 / 該宗地上的建號清單
//
// 與現有三支 land-* 的分工(都不重疊,可互補):
//   - land-locate      我們自己匯入的 KML 幾何 → 宗地 polygon,但**只有公有地**,私有地會退段中心點。
//   - land-value       我們自己匯入的 land_official_value → 逐年公告現值/地價 + 漲幅%,離線、可比較年度。
//   - land-easymap(本支) 即時爬官方系統 → **任何地號**(含私有地)都查得到當年度公告值 + 定位點 + 面積。
//     代價是依賴上游可用性與版面(HTML 解析),所以定位/明細任一段失敗都只降級標 note,不整支 502。
//
// 無 DB、無 S3、無 Bedrock —— 純對外 HTTP,因此住在 NtlandLambdaStack(與 wind-condition 同類),
// 不在 NtlandBedrockStack。
//
// 路由(Function URL):
//   GET  ?district=金山區&section=金美段&lid=489          縣市預設新北市;town/segment/parcel 為別名
//   GET  ?q=金山區金美段489地號                            自由字串(沿用 land-locate 的解析器)
//   POST { "parcels": [ { district, section, lid }, ... ] } 批次(序列送,最多 MAX_BATCH 筆)
//
// ⚠️ 上游 token 是 session 級的一次性資源,批次一定要序列送,不能 Promise.all。

import {
  DISCLAIMER,
  EasymapClient,
  NotFoundError as EasymapNotFound,
  PRICE_YEAR,
  SOURCE,
  hasLandData,
  type EasymapRecord,
  type LandFields,
} from "./easymap.js";
// 地號/段名正規化與 ?q= 自由字串解析,直接重用 land-locate 那份(純字串處理,不碰 DB)。
import { parseFreeText } from "../land-locate/freeText.js";
import { normalizeParcelId, normalizeSectionName } from "../land-locate/parcelId.js";

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

// CORS 交給 Function URL 原生設定;handler 不要再自己加 access-control-allow-origin,
// 否則帶 Origin 的請求會出現兩個 header,瀏覽器判定 CORS 失敗(同 land-value / land-locate)。
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(statusCode: number, payload: unknown): JsonResponse {
  return { statusCode, headers: { ...JSON_HEADERS }, body: JSON.stringify(payload) };
}

class BadRequestError extends Error {}

/** 預設縣市:本專案只做新北市,所以 county 可省略。 */
const DEFAULT_COUNTY = process.env.EASYMAP_DEFAULT_COUNTY ?? "新北市";

/** 批次上限。每筆要 4~5 次上游往返又必須序列送,太多筆會撞 lambda timeout。 */
const MAX_BATCH = Number(process.env.EASYMAP_MAX_BATCH ?? 5);

/** 批次中每筆之間的間隔(毫秒),避免打太快被上游擋。 */
const BATCH_DELAY_MS = Number(process.env.EASYMAP_BATCH_DELAY_MS ?? 800);

// ---------------------------------------------------------------------------
// 輸入
// ---------------------------------------------------------------------------

/** 正規化後的一筆查詢。 */
interface ParcelInput {
  county: string;
  district: string;
  section: string;
  /** 使用者寫法收斂後的標準地號('489' / '31-1')。 */
  lid: string;
  /** 送給 easymap 的 landNo 候選,依序試(見 landNoCandidates)。 */
  landNos: string[];
}

/**
 * easymap 的 landNo 要送哪種寫法。
 *
 * 明細回來的 parcelNo 是 8 碼(母號 4 + 子號 4,如 '04890000'),補零 8 碼就是上游的原生格式,
 * 實測母號('489' → '04890000')與子號('31-1' → '00310001')都吃得到。另外實測短寫法
 * 「489」上游也接受,所以留作退路:先送 8 碼,查無資料再用原寫法試一次(見 queryParcel)。
 *
 * 母號/子號超過 4 位數就不是合法地號(地籍是 4+4),補零只會得到亂碼,這時只送原寫法。
 */
function landNoCandidates(masterNo: number, subNo: number): string[] {
  const plain = subNo === 0 ? String(masterNo) : `${masterNo}-${subNo}`;
  if (masterNo > 9999 || subNo > 9999) return [plain];
  const padded = `${String(masterNo).padStart(4, "0")}${String(subNo).padStart(4, "0")}`;
  return padded === plain ? [padded] : [padded, plain];
}

/** 把「一組原始欄位」收斂成 ParcelInput;缺欄位或格式錯 → 400。 */
function toParcelInput(raw: {
  county?: string;
  district?: string;
  section?: string;
  lid?: string;
}): ParcelInput {
  const county = (raw.county ?? "").trim() || DEFAULT_COUNTY;
  const district = (raw.district ?? "").trim();
  const section = normalizeSectionName(raw.section ?? "");
  const lidRaw = (raw.lid ?? "").trim();

  if (!district) throw new BadRequestError("district(行政區,如 金山區)為必填。");
  if (!section) throw new BadRequestError("section(段名,如 金美段)為必填。");
  if (!lidRaw) throw new BadRequestError("lid(地號,如 489 或 31-1)為必填。");

  const parcelId = normalizeParcelId(lidRaw);
  if (!parcelId) {
    throw new BadRequestError(`地號 "${lidRaw}" 解析失敗,預期格式為 489 / 31-1 / 31之1。`);
  }

  return {
    county,
    district,
    section,
    lid: parcelId.canonical,
    landNos: landNoCandidates(parcelId.masterNo, parcelId.subNo),
  };
}

/** GET 路由:?q= 自由字串,或 district/section/lid(town/segment/parcel 為別名)。 */
function readQuery(q: Record<string, string | undefined>): ParcelInput {
  const free = q.q ? parseFreeText(q.q) : null;
  if (q.q && !free) {
    throw new BadRequestError(
      `無法從 q="${q.q}" 解析出「段」。請改用明確參數 ?district=&section=&lid=。`,
    );
  }

  return toParcelInput({
    county: q.county ?? free?.county,
    district: q.district ?? q.town ?? free?.district,
    section: q.section ?? q.segment ?? free?.section,
    lid: q.lid ?? q.parcel ?? q.landNo ?? free?.lid,
  });
}

/** POST 路由:{ parcels: [...] }(也相容裸陣列與單筆物件)。 */
function readBody(event: FunctionUrlEvent): ParcelInput[] {
  const raw = event.body ?? "";
  const text = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
  if (!text.trim()) throw new BadRequestError("POST 需要 JSON body:{ parcels: [...] }。");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BadRequestError("POST body 不是合法 JSON。");
  }

  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { parcels?: unknown }).parcels)
      ? ((parsed as { parcels: unknown[] }).parcels)
      : [parsed];

  if (list.length === 0) throw new BadRequestError("parcels 是空陣列。");
  if (list.length > MAX_BATCH) {
    throw new BadRequestError(
      `一次最多 ${MAX_BATCH} 筆(上游 token 是一次性的,必須序列查);收到 ${list.length} 筆。`,
    );
  }

  return list.map((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const str = (...keys: string[]): string | undefined => {
      for (const k of keys) if (typeof o[k] === "string") return o[k] as string;
      return undefined;
    };
    return toParcelInput({
      county: str("county"),
      district: str("district", "town"),
      section: str("section", "segment", "sectionName"),
      lid: str("lid", "parcel", "landNo"),
    });
  });
}

// ---------------------------------------------------------------------------
// 回應
// ---------------------------------------------------------------------------

export interface LandEasymapResponse {
  query: { county: string; district: string; section: string; lid: string };
  /** NLSC 解出的上游代碼,方便除錯/直接打 easymap 對照。 */
  resolved: { cityCode: string; townCode: string; office: string; sectno: string; landNo: string };
  /** 宗地定位點(非界址點);locate 失敗為 null。 */
  center: { lat: number; lng: number } | null;
  /** 面積/公告現值/公告地價等已正規化的欄位(數值欄已轉 number,並補坪數與總價)。 */
  fields: LandFields;
  /** 該宗地上的建號(8 碼)。 */
  buildings: string[];
  source: string;
  fetchedAt: string;
  /** 公告現值/地價的年度(民國)。 */
  priceYear: string;
  disclaimer: string;
  /** 部分降級的說明(例如只拿到明細、定位失敗);全部正常為 null。 */
  note: string | null;
}

/** 回音使用者問的是哪一筆(landNos 是內部候選,不外露)。 */
function queryEcho(input: ParcelInput): LandEasymapResponse["query"] {
  return {
    county: input.county,
    district: input.district,
    section: input.section,
    lid: input.lid,
  };
}

function toResponse(input: ParcelInput, rec: EasymapRecord): LandEasymapResponse {
  return {
    query: queryEcho(input),
    resolved: {
      cityCode: rec.query.cityCode,
      townCode: rec.query.townCode,
      office: rec.query.office,
      sectno: rec.query.sectNo,
      landNo: rec.query.parcel,
    },
    // 上游回的是 { X: lon, Y: lat };對外一律用 {lat,lng}(同 land-locate 的 center)。
    center: rec.lon !== null && rec.lat !== null ? { lat: rec.lat, lng: rec.lon } : null,
    fields: rec.fields,
    buildings: rec.buildings,
    source: SOURCE,
    fetchedAt: rec.fetchedAt,
    priceYear: PRICE_YEAR,
    disclaimer: DISCLAIMER,
    note: rec.error,
  };
}

/** 明細沒有任何實質欄位 = 這個地號在上游查無資料(或版面變了)。見 hasLandData。 */
function isEmpty(rec: EasymapRecord): boolean {
  return !hasLandData(rec.fields);
}

/**
 * 查一筆:依序試 landNo 的候選寫法,第一個解析得到明細的就採用。
 * 全部候選都空 → 回最後一次的結果(呼叫端據此回 404)。
 */
async function queryParcel(client: EasymapClient, input: ParcelInput): Promise<EasymapRecord> {
  let last: EasymapRecord | null = null;
  for (const landNo of input.landNos) {
    const rec = await client.query({
      county: input.county,
      town: input.district,
      sectionName: input.section,
      parcel: landNo,
    });
    if (!isEmpty(rec)) return rec;
    last = rec;
  }
  return last!;
}

// ---------------------------------------------------------------------------
// handler
// ---------------------------------------------------------------------------

async function handleSingle(input: ParcelInput): Promise<JsonResponse> {
  const client = new EasymapClient();
  const rec = await queryParcel(client, input);

  // 明細沒有實質欄位 = 這個地號在上游查不到(段是對的,地號不存在)。
  // 刻意不把「有沒有座標」算進來:實測上游對不存在的地號有時仍回一個點(該段附近),
  // 定位成功不能當作地號存在的證據,只有明細算數。
  if (isEmpty(rec)) {
    return json(404, {
      error: `easymap 查無 ${input.county}${input.district}${input.section} ${input.lid} 的資料。`,
      query: queryEcho(input),
      detail: rec.error,
    });
  }
  return json(200, toResponse(input, rec));
}

async function handleBatch(inputs: ParcelInput[]): Promise<JsonResponse> {
  const client = new EasymapClient();
  const results: Array<LandEasymapResponse | { query: unknown; error: string }> = [];

  // 序列送:上游 token 一次性,並行會互相把對方的 token 作廢。
  for (const [i, input] of inputs.entries()) {
    try {
      const rec = await queryParcel(client, input);
      if (isEmpty(rec)) {
        results.push({ query: queryEcho(input), error: rec.error ?? "查無資料" });
      } else {
        results.push(toResponse(input, rec));
      }
    } catch (err) {
      // 單筆失敗不影響其他筆(整批 200,失敗的那筆帶 error)。
      results.push({
        query: queryEcho(input),
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (i < inputs.length - 1 && BATCH_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  return json(200, { count: results.length, results });
}

/**
 * land-easymap handler。純對外 HTTP(easymap + NLSC),無 DB / S3 / Bedrock。
 * 錯誤慣例比照 land-locate:BadRequest → 400、查無段/縣市/鄉鎮 → 404、其他 → 502;OPTIONS → 204。
 */
export async function handler(event: FunctionUrlEvent): Promise<JsonResponse> {
  const method = event.requestContext?.http?.method ?? "GET";
  try {
    if (method === "OPTIONS") return json(204, {});
    if (method === "GET") return await handleSingle(readQuery(event.queryStringParameters ?? {}));
    if (method === "POST") return await handleBatch(readBody(event));
    return json(405, { error: `Method ${method} not allowed.` });
  } catch (err) {
    if (err instanceof BadRequestError) return json(400, { error: err.message });
    // NLSC 查無縣市/鄉鎮/地段 —— 是查不到,不是上游壞掉。
    if (err instanceof EasymapNotFound) return json(404, { error: err.message });
    const message = err instanceof Error ? err.message : String(err);
    return json(502, { error: `land-easymap failed: ${message}` });
  }
}
