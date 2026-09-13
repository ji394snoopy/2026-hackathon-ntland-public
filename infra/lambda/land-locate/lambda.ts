// land-locate — (縣市, 區, 段名 或 段代碼, 地號) → 經緯度 + 宗地邊界 (= GET /api/land/locate)。
//
// ⚠️⚠️ DEPRECATED —— 新功能不要接這支,改用 ../land-easymap。
//
// 停用原因就是下面那條覆蓋率警告:幾何只有**公有土地**,私有地地號查不到、只能退段中心點,
// 而估價實務上比較標的大多是私有地 —— 退段中心點等於定位失敗。land-easymap 即時爬
// easymap.moi.gov.tw,任何地號都查得到,還一併回面積與公告值。表一的定位流程
// (輸入 行政區+段+地號 → 取經緯度與面積 → 存進 case-store 的宗地身分欄)一律走那支。
//
// 唯一還贏的是**真實宗地 polygon 邊界**(land-easymap 只有定位點),所以端點暫時留著沒拆
// CDK:前端地籍圖層若真的要畫多邊形而不是標點,還可以打。
//
// ⚠️ 這個資料夾**不要刪**:parcelId.ts / freeText.ts(地號正規化、段名正規化、?q= 自由字串
// 解析)是純字串工具,land-easymap 直接 import 它們。退場的是這個 HTTP 端點,不是那些工具。
//
// 一支同時餵兩個下游:
//   - produce-survey 的 benchmarkLocation(只需要 center)
//   - 前端地籍圖層(需要 boundary / bbox / radiusHint)
//
// 資料來自 gis 的 land_section(段層 1,874 列)/ land_parcel(宗地層 22.8 萬列),由
// assets/新北市公有土地資料供應/ 的 KML 轉入(見 infra/docs/land-locate-plan.md)。
//
// ⚠️ 覆蓋率:來源是「**公有土地**資料供應」,不是完整地籍圖 —— 段層覆蓋 1,318/1,869 ≈ 70%,
// 宗地層只含公有地。**私有地地號查不到是預期行為**,不是 bug。所以本支遵循「保證永遠有
// 答案」:查不到地號就退回段中心點並標 precision:"section" + note,而不是直接 404。
//
// 路由(Function URL,皆為 GET):
//   ?district=樹林區&section=樹德段&lid=31-1   段名查(段名跨區重複,district 必填)
//   ?sectno=1904&lid=31-1                      段代碼查(代碼歧義時 district 選填補刀)
//   ?q=樹林區大同段31-1地號                     自由字串(見 ./freeText)
//   lid 省略 → 只回段中心點(precision:"section")
//
// 三層 fallback:
//   地號命中 land_parcel            → 200 precision:"parcel"
//   段有幾何但地號不在公有地集合     → 200 precision:"section" + note
//   段存在但 has_geometry = false   → 404 { sectionExists: true, ... }
//   段不存在                        → 404 { sectionExists: false }
//
// 走共用 DB 存取層(../shared/db,Drizzle over RDS Data API),同 land-value。純讀取。

import { and, eq, like, sql, type SQL } from "drizzle-orm";
// 寫成 ".../index.js"(而非其他 lambda 慣用的裸目錄 "../shared/db"):esbuild 兩種都解得動,
// 但 invoke-local.ts 走的 node ESM loader 不支援目錄 import,裸寫法會讓本機 runner 一 import
// 就 ERR_UNSUPPORTED_DIR_IMPORT。副檔名寫 .js 是這個 repo 既有的 TS 慣例(見 invoke-local)。
import { getDb, landParcel, landSection } from "../shared/db/index.js";
import { parseFreeText } from "./freeText";
import { normalizeParcelId, normalizeSectionName, normalizeSectno } from "./parcelId";

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
// 否則帶 Origin 的請求會出現兩個 header,瀏覽器判定 CORS 失敗(同 land-value)。
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

function json(statusCode: number, payload: unknown): JsonResponse {
  return { statusCode, headers: { ...JSON_HEADERS }, body: JSON.stringify(payload) };
}

class BadRequestError extends Error {
  constructor(message: string, readonly extra?: Record<string, unknown>) {
    super(message);
  }
}
class NotFoundError extends Error {
  constructor(message: string, readonly extra?: Record<string, unknown>) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// 回應型別
// ---------------------------------------------------------------------------

export interface LandLocateResponse {
  county: string;
  district: string;
  /** 段名;5 個「對照表查無」的段為 null(只能用 sectno 查得到)。 */
  section: string | null;
  sectno: string;
  /** 正規化後的地號('31-1');未給 lid 或退回段層時為 null。 */
  lid: string | null;
  precision: "parcel" | "section";
  center: { lat: number; lng: number };
  /** [minLng, minLat, maxLng, maxLat] */
  bbox: [number, number, number, number];
  /** GeoJSON;precision 為 section 時是該段的 bbox polygon。 */
  boundary: unknown;
  /** 宗地面積(㎡);段層為 null。 */
  areaM2: number | null;
  /** 建議誤差圈半徑(公尺):宗地 = sqrt(area/π);段 = bbox 對角線一半。 */
  radiusHint: number;
  source: string;
  /** 退回段層或其他需要說明的情況;正常命中為 null。 */
  note: string | null;
}

function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// 段層查詢
// ---------------------------------------------------------------------------

// 幾何欄一律在 DB 端投影成座標/GeoJSON —— Data API 直接讀 geometry 只會回 WKB hex。
const sectionColumns = {
  county: landSection.county,
  district: landSection.district,
  sectno: landSection.sectno,
  section: landSection.section,
  hasGeometry: landSection.hasGeometry,
  parcelCount: landSection.parcelCount,
  lng: sql<number>`ST_X(${landSection.centroid})`,
  lat: sql<number>`ST_Y(${landSection.centroid})`,
  boundary: sql<string>`ST_AsGeoJSON(${landSection.bbox})`,
  minLng: sql<number>`ST_XMin(${landSection.bbox})`,
  minLat: sql<number>`ST_YMin(${landSection.bbox})`,
  maxLng: sql<number>`ST_XMax(${landSection.bbox})`,
  maxLat: sql<number>`ST_YMax(${landSection.bbox})`,
  // bbox 對角線一半(公尺),當段層的誤差圈半徑。用 geography 算真實距離。
  radiusHint: sql<number>`
    ST_Distance(
      ST_SetSRID(ST_MakePoint(ST_XMin(${landSection.bbox}), ST_YMin(${landSection.bbox})), 4326)::geography,
      ST_SetSRID(ST_MakePoint(ST_XMax(${landSection.bbox}), ST_YMax(${landSection.bbox})), 4326)::geography
    ) / 2`,
};

type SectionRow = {
  [K in keyof typeof sectionColumns]: K extends "section"
    ? string | null
    : K extends "hasGeometry"
      ? boolean
      : K extends "county" | "district" | "sectno" | "boundary"
        ? string
        : number;
};

/** 查詢入口參數(三種路由正規化後的共同形狀)。 */
interface LocateInput {
  county?: string;
  district?: string;
  section?: string;
  sectno?: string;
  lid?: string;
}

async function selectSections(db: ReturnType<typeof getDb>, where: SQL): Promise<SectionRow[]> {
  return (await db.select(sectionColumns).from(landSection).where(where).limit(20)) as SectionRow[];
}

/**
 * 解析出唯一一個段。回 0 筆 → 呼叫端丟 404;回多筆 → 400 附候選清單(絕不挑第一筆)。
 *
 * 段名比對三段式(容錯「少打一個段字」,但不改寫使用者輸入):
 *   1. 完全相等
 *   2. 輸入沒有以「段/小段」結尾時,補一個「段」再試('大同' → '大同段')
 *   3. 前綴 LIKE('大同段' → '大同段%',吃得到 '大同段一小段' 這種)
 */
async function resolveSection(
  db: ReturnType<typeof getDb>,
  input: LocateInput,
): Promise<SectionRow[]> {
  const countyEq = input.county ? eq(landSection.county, input.county) : undefined;
  const districtEq = input.district ? eq(landSection.district, input.district) : undefined;

  if (input.sectno) {
    const conds = [eq(landSection.sectno, input.sectno), districtEq, countyEq].filter(Boolean);
    return selectSections(db, and(...(conds as SQL[]))!);
  }

  const section = input.section!;
  const attempts: SQL[] = [eq(landSection.section, section)];
  if (!/(小?段)$/.test(section)) attempts.push(eq(landSection.section, `${section}段`));
  attempts.push(like(landSection.section, `${section}%`));

  for (const attempt of attempts) {
    const conds = [attempt, districtEq, countyEq].filter(Boolean);
    const rows = await selectSections(db, and(...(conds as SQL[]))!);
    if (rows.length > 0) return rows;
  }
  return [];
}

// ---------------------------------------------------------------------------
// 宗地層查詢
// ---------------------------------------------------------------------------

const parcelColumns = {
  parcelno: landParcel.parcelno,
  areaM2: landParcel.areaM2,
  source: landParcel.source,
  lng: sql<number>`ST_X(${landParcel.centroid})`,
  lat: sql<number>`ST_Y(${landParcel.centroid})`,
  boundary: sql<string>`ST_AsGeoJSON(${landParcel.geom})`,
  minLng: sql<number>`ST_XMin(ST_Envelope(${landParcel.geom}))`,
  minLat: sql<number>`ST_YMin(ST_Envelope(${landParcel.geom}))`,
  maxLng: sql<number>`ST_XMax(ST_Envelope(${landParcel.geom}))`,
  maxLat: sql<number>`ST_YMax(ST_Envelope(${landParcel.geom}))`,
};

// ---------------------------------------------------------------------------
// 路由解析
// ---------------------------------------------------------------------------

/** 把三種路由的 query string 收斂成同一個 LocateInput。 */
function readInput(q: Record<string, string | undefined>): LocateInput {
  const free = q.q ? parseFreeText(q.q) : null;
  if (q.q && !free) {
    throw new BadRequestError(
      `無法從 q="${q.q}" 解析出「段」。請改用明確參數 ?district=&section=&lid= 或 ?sectno=&lid=。`,
    );
  }

  const sectno = normalizeSectno(q.sectno ?? undefined) ?? undefined;
  const section = normalizeSectionName(q.section ?? free?.section ?? "") || undefined;
  const district = (q.district ?? free?.district ?? "").trim() || undefined;
  const county = (q.county ?? free?.county ?? "").trim() || undefined;
  const lid = (q.lid ?? free?.lid ?? "").trim() || undefined;

  if (!sectno && !section) {
    throw new BadRequestError("需要 section(段名,搭配 district)或 sectno(段代碼)或 q(自由字串)。");
  }
  // 段名跨區重複很常見('大同段' 就有板橋/汐止/中和/樹林 4 個),沒有 district 不猜。
  if (!sectno && section && !district) {
    throw new BadRequestError(
      `段名 "${section}" 可能跨多個行政區,請一併給 district(或改用 sectno 段代碼)。`,
    );
  }

  return { county, district, section, sectno, lid };
}

// ---------------------------------------------------------------------------
// handler 主體
// ---------------------------------------------------------------------------

async function handleLocate(event: FunctionUrlEvent): Promise<JsonResponse> {
  const input = readInput(event.queryStringParameters ?? {});
  const db = getDb();

  const sections = await resolveSection(db, input);

  if (sections.length === 0) {
    throw new NotFoundError(
      input.sectno
        ? `查無段代碼 ${input.sectno}${input.district ? `(${input.district})` : ""}。`
        : `查無 ${input.district ?? ""}${input.section ?? ""}。`,
      { sectionExists: false },
    );
  }
  if (sections.length > 1) {
    // 段代碼歧義(對照表有 11 個重複代碼)或段名前綴命中多筆 —— 回候選讓呼叫端補參數。
    throw new BadRequestError("比對到多個段,請用 district / sectno 縮小範圍。", {
      candidates: sections.map((s) => ({
        county: s.county,
        district: s.district,
        sectno: s.sectno,
        section: s.section,
        hasGeometry: s.hasGeometry,
        parcelCount: s.parcelCount,
      })),
    });
  }

  const sec = sections[0];
  const parcelId = input.lid ? normalizeParcelId(input.lid) : null;
  if (input.lid && !parcelId) {
    throw new BadRequestError(`地號 "${input.lid}" 解析失敗,預期格式為 31-1 / 31之1 / 169。`);
  }

  // --- 第 1 層:地號命中宗地 ---
  if (parcelId) {
    const rows = (await db
      .select(parcelColumns)
      .from(landParcel)
      .where(
        and(
          eq(landParcel.sectno, sec.sectno),
          eq(landParcel.district, sec.district),
          eq(landParcel.masterNo, parcelId.masterNo),
          eq(landParcel.subNo, parcelId.subNo),
        ),
      )
      .limit(1)) as Array<Record<string, unknown>>;

    if (rows.length > 0) {
      const p = rows[0];
      const areaM2 = toNum(p.areaM2 as string | null);
      return json(200, {
        county: sec.county,
        district: sec.district,
        section: sec.section,
        sectno: sec.sectno,
        lid: parcelId.canonical,
        precision: "parcel",
        center: { lat: Number(p.lat), lng: Number(p.lng) },
        bbox: [Number(p.minLng), Number(p.minLat), Number(p.maxLng), Number(p.maxLat)],
        boundary: JSON.parse(String(p.boundary)),
        areaM2,
        // 圓等面積半徑,給 UI 畫誤差/範圍圈用。
        radiusHint: areaM2 && areaM2 > 0 ? Math.round(Math.sqrt(areaM2 / Math.PI)) : 0,
        source: String(p.source),
        note: null,
      } satisfies LandLocateResponse);
    }
  }

  // --- 第 3 層:段存在但完全沒有幾何(該段沒有任何公有地 KML)---
  if (!sec.hasGeometry) {
    throw new NotFoundError(
      `段 ${sec.district}${sec.section ?? sec.sectno} 存在於段代碼對照表,但本資料集(公有土地)沒有它的幾何。`,
      {
        sectionExists: true,
        county: sec.county,
        district: sec.district,
        sectno: sec.sectno,
        section: sec.section,
      },
    );
  }

  // --- 第 2 層:退回段中心點 ---
  let note: string | null = null;
  if (parcelId) {
    // 同母號還有幾筆?給前端提示「是不是想找 31-2」,但不自作主張退母號
    // (決策是退段中心點,不做模糊比對)。
    const [{ n }] = (await db
      .select({ n: sql<number>`count(*)` })
      .from(landParcel)
      .where(
        and(
          eq(landParcel.sectno, sec.sectno),
          eq(landParcel.district, sec.district),
          eq(landParcel.masterNo, parcelId.masterNo),
        ),
      )) as Array<{ n: number }>;
    const sameMaster = Number(n) || 0;
    note =
      `該段僅有公有土地幾何(${sec.parcelCount} 筆),查無地號 ${parcelId.canonical},回段中心點。` +
      (sameMaster > 0 ? `同母號 ${parcelId.masterNo} 另有 ${sameMaster} 筆宗地。` : "");
  }

  return json(200, {
    county: sec.county,
    district: sec.district,
    section: sec.section,
    sectno: sec.sectno,
    lid: parcelId?.canonical ?? null,
    precision: "section",
    center: { lat: Number(sec.lat), lng: Number(sec.lng) },
    bbox: [Number(sec.minLng), Number(sec.minLat), Number(sec.maxLng), Number(sec.maxLat)],
    boundary: JSON.parse(String(sec.boundary)),
    areaM2: null,
    radiusHint: Math.round(Number(sec.radiusHint) || 0),
    source: "kml-public-land",
    note,
  } satisfies LandLocateResponse);
}

/**
 * land-locate handler。純讀取,走 Data API(grantDataApiAccess)。
 * 錯誤慣例比照 land-value:BadRequest → 400、NotFound → 404、其他 → 502;OPTIONS → 204。
 */
export async function handler(event: FunctionUrlEvent): Promise<JsonResponse> {
  const method = event.requestContext?.http?.method ?? "GET";
  try {
    if (method === "OPTIONS") return json(204, {});
    if (method === "GET") return await handleLocate(event);
    return json(405, { error: `Method ${method} not allowed.` });
  } catch (err) {
    if (err instanceof BadRequestError) return json(400, { error: err.message, ...err.extra });
    if (err instanceof NotFoundError) return json(404, { error: err.message, ...err.extra });
    const message = err instanceof Error ? err.message : String(err);
    return json(502, { error: `land-locate failed: ${message}` });
  }
}
