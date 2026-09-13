// produce-survey — 表3 勘查表產製對外端點 (= POST /api/produce/survey, 流程 ①).
//
// 收 ProduceSurveyRequest(sectionId + 區段多邊形 + 比準地座標 + 查詢半徑)→ orchestrate
// 兩個上游(序列,② 吃 ① 的結果):
//   ① facilities(周邊設施查詢 API)—— 走 env FACILITIES_URL。圓心取**區段多邊形的幾何
//      重心**、半徑用呼叫端帶的逐類標準,並把比準地當第二量測點一起送上去,所以每筆設施
//      回來都有兩個距離:metersToCenter(到區段中心,表5 區域因素用)與 metersToPoint
//      (到比準地,表4 個別因素用)。沒帶多邊形就退回「圓心 = 比準地」的舊行為。
//   ② district-survey-draft(Bedrock,8 類各產一份 content 草稿,並行)—— 走 env
//      DISTRICT_SURVEY_DRAFT_URL,並把 ① 的結果當 facts 轉發過去,草稿才有事實依據。
// 再由 mapToSurvey 攤平映射組成 ProduceSurveyResponse(meta + survey: SurveyField[] + benchmark)回前端。
//
// 契約來源:API_INTEGRATION.md §1(POST /api/produce/survey)。型別重用 ../shared/db。
//
// 容錯(plan §4/§5):上游失敗要 graceful —— 對應欄位標「需人工確認」,不整支 502。
//   - facilities 失敗/無座標 → 該類欄位留空需人工;draft 照跑但沒有 facts,usedFacts 全 false,
//     映射層只掛 warning 不寫值(不把模型編的內容當事實)。
//   - 8 類 draft = 8 次 Bedrock,逐類並行 + 各自 timeout/容錯,部分類失敗仍回其餘。
//
// infra(B 預留 + C-survey session 授權補的 env URL 注入,見 bedrock-stack.ts):
//   - env FACILITIES_URL / DISTRICT_SURVEY_DRAFT_URL(HTTP 呼叫上游 Function URL)。
//   - env DB_CLUSTER_ARN / DB_SECRET_ARN / DB_NAME + grantDataApiAccess(預留,本支尚未用 DB)。

import type { LatLng } from "../shared/db";
import {
    assembleSurveyResponse,
    DRAFT_CATEGORIES,
    type DraftCategory,
    type DraftOutcome,
    type NearbyFacilitiesResponse,
} from "./mapToSurvey";

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

// --- 契約(API_INTEGRATION.md §1)-------------------------------------------

interface ProduceSurveyRequest {
  sectionId: string;
  /**
   * 本案地點(比準地)座標。設施的 `metersToPoint` 量到這一點,表4 個別因素評級用它。
   */
  benchmarkLocation?: { lat: number; lng: number };
  /**
   * 區段範圍多邊形(前端圈選的區段經緯度陣列,至少 3 點;閉合與否都收)。
   *
   * 帶了它,設施查詢的圓心就改成**這個多邊形的幾何重心**,每筆設施因此同時有
   * `metersToCenter`(到區段中心)與 `metersToPoint`(到比準地)兩個距離。不帶就維持原本行為
   * (圓心 = 比準地,兩個距離相同)。
   *
   * 注意這是「用區段取中心」,不是「只取區段範圍內的設施」—— 勘查標準講的是逐類半徑
   * (站牌 800m、交流道 4000m),區段邊界內有幾個設施是地籍事實,不是勘查範圍。
   */
  sectionPolygon?: LatLng[];
  /**
   * 周邊設施的查詢範圍,原樣轉給 facilities。**半徑標準是業務規則,由呼叫端(前端)帶**,
   * 這支不內建任何一套 —— 站牌 800m、交流道 4000m 這種級距會隨勘查標準調整,寫死在
   * Lambda 裡等於每次改標準都要重新部署。前端的標準表見
   * frontend/src/lib/facilityRadiusStandards.ts。
   */
  facilities: FacilitiesOptions;
}

/** 轉給 facilities 的查詢範圍。`categories` 已序列化成 `cats=` 的字串形式。 */
interface FacilitiesOptions {
  radius?: number;
  categories?: string;
}

// --- 設定 -------------------------------------------------------------------

/**
 * 呼叫端沒帶 `facilities.radius` 時的基準半徑(公尺)。這只是「沒指定時查多遠」的下限,
 * 不是勘查標準 —— 逐類半徑一律由呼叫端帶(見 ProduceSurveyRequest.facilities)。
 */
const FACILITIES_RADIUS_M = 600;
/**
 * 單支上游 fetch 的逾時(毫秒)。draft 要吃 facilities 的結果當事實依據,兩者改為序列
 * (facilities → 8 類 draft),所以 facilities 收緊到 10s,避免它慢吞吞地吃掉 draft 的預算。
 * 本支 Lambda timeout 為 60s(bedrock-stack.ts),10 + 45 仍留有餘裕。
 */
const FACILITIES_TIMEOUT_MS = 10_000;
const DRAFT_TIMEOUT_MS = 45_000;

function readEnvUrl(name: string): string | null {
  const v = process.env[name];
  if (!v || v.trim() === "") return null;
  return v.trim();
}

/** fetch + AbortController 逾時;回 Response 或 throw。 */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// --- 上游呼叫 ---------------------------------------------------------------

/** 一個區段多邊形至少要 3 點才圍得出面積(facilities 會自己閉合)。 */
const MIN_RING_POINTS = 3;

/**
 * 組出要打給 facilities 的請求。
 *
 *   - 有區段多邊形 → POST `{ polygon, radius, cats?, point? }`。多邊形只用來取中心,成員
 *     判定仍是逐類半徑(見 facilities/input.ts 的 polygon + radius 形式)。走 POST 而不是
 *     `?poly=` 是因為區段 ring 動輒上百點,塞進 query string 會撞長度上限。
 *   - 沒有 → 維持原本的 GET `?lon=&lat=&radius=&cats=`(圓心就是比準地,兩個距離相同)。
 */
export function facilitiesRequest(
  base: string,
  location: LatLng | undefined,
  sectionPolygon: LatLng[] | undefined,
  options: FacilitiesOptions,
): { url: string; init: RequestInit } {
  const radius = options.radius ?? FACILITIES_RADIUS_M;
  if (sectionPolygon) {
    return {
      url: base,
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // facilities 收的是 [lon, lat] 序,前端給的是 { lat, lng } —— 這裡轉一次。
          polygon: sectionPolygon.map((p) => [p.lng, p.lat]),
          radius,
          // 逐類半徑原樣轉發;呼叫端沒帶就整批用基準半徑。
          ...(options.categories ? { cats: options.categories } : {}),
          ...(location ? { point: [location.lng, location.lat] } : {}),
        }),
      },
    };
  }
  const url = new URL(base);
  url.searchParams.set("lon", String(location!.lng));
  url.searchParams.set("lat", String(location!.lat));
  url.searchParams.set("radius", String(radius));
  if (options.categories) url.searchParams.set("cats", options.categories);
  return { url: url.toString(), init: { method: "GET" } };
}

/**
 * 查周邊設施。失敗(env 未設 / 無座標 / HTTP 錯 / 逾時)一律回 null,由映射層降級成需人工,
 * 不 throw、不讓整支 502。
 *
 * 查詢中心:帶了區段多邊形就用它的幾何重心,否則用比準地座標。兩者都沒有就沒得查。
 */
async function fetchFacilities(
  location: LatLng | undefined,
  sectionPolygon: LatLng[] | undefined,
  options: FacilitiesOptions,
): Promise<NearbyFacilitiesResponse | null> {
  if (!location && !sectionPolygon) return null;
  const base = readEnvUrl("FACILITIES_URL");
  if (!base) {
    console.warn("[produce-survey] FACILITIES_URL 未設定,略過周邊設施查詢(欄位降級為需人工)。");
    return null;
  }
  try {
    const { url, init } = facilitiesRequest(base, location, sectionPolygon, options);
    const res = await fetchWithTimeout(url, init, FACILITIES_TIMEOUT_MS);
    if (!res.ok) {
      // 4xx 幾乎都是呼叫端把 facilities.categories 寫錯(類別名打錯/半徑非法),
      // 把上游的錯誤訊息一起印出來,否則只看到「降級為需人工」很難查。
      const detail = res.status >= 400 && res.status < 500 ? ` ${await res.text()}` : "";
      console.warn(`[produce-survey] facilities HTTP ${res.status}${detail};降級為需人工。`);
      return null;
    }
    return (await res.json()) as NearbyFacilitiesResponse;
  } catch (err) {
    console.warn(`[produce-survey] facilities 查詢失敗:${String(err)};降級為需人工。`);
    return null;
  }
}

/**
 * district-survey-draft 吃的事實依據 —— facilities 回傳的精簡視圖(見該支的 shared/facts.ts)。
 * 帶了它,模型才是「依實測設施描述區段」而不是憑空編;回應的 usedFacts 會告訴我們這一類
 * 到底有沒有真的吃到設施。
 */
type DraftFacts = Pick<NearbyFacilitiesResponse, "byCategory" | "facilities">;

function toDraftFacts(facilities: NearbyFacilitiesResponse | null): DraftFacts | undefined {
  if (!facilities) return undefined;
  return { byCategory: facilities.byCategory, facilities: facilities.facilities };
}

/**
 * 產單一類草稿。失敗回 { category, error };成功回 { category, content, usedFacts }。不 throw。
 * facts 有帶就一併送上去,上游會挑出這一類相關的設施餵給 prompt。
 */
async function fetchDraft(
  base: string,
  category: DraftCategory,
  facts: DraftFacts | undefined,
): Promise<DraftOutcome> {
  try {
    const res = await fetchWithTimeout(
      base,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(facts ? { category, facts } : { category }),
      },
      DRAFT_TIMEOUT_MS,
    );
    if (!res.ok) {
      return { category, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as {
      category?: string;
      content?: unknown;
      usedFacts?: unknown;
    };
    return { category, content: data?.content, usedFacts: data?.usedFacts === true };
  } catch (err) {
    return { category, error: String(err) };
  }
}

/**
 * 8 類 draft 並行呼叫(8 次 Bedrock)。逐類容錯:某類失敗只影響該類欄位,其餘照回。
 * env 未設時全部標 error(欄位降級需人工),仍回其他來源。
 */
async function fetchAllDrafts(facts: DraftFacts | undefined): Promise<DraftOutcome[]> {
  const base = readEnvUrl("DISTRICT_SURVEY_DRAFT_URL");
  if (!base) {
    console.warn("[produce-survey] DISTRICT_SURVEY_DRAFT_URL 未設定,8 類草稿全部降級為需人工。");
    return DRAFT_CATEGORIES.map((category) => ({ category, error: "DISTRICT_SURVEY_DRAFT_URL 未設定" }));
  }
  if (!facts) {
    console.warn("[produce-survey] 無 facilities 結果可當事實依據,8 類草稿的 usedFacts 會是 false。");
  }
  return Promise.all(DRAFT_CATEGORIES.map((category) => fetchDraft(base, category, facts)));
}

// --- 請求解析 ---------------------------------------------------------------

function parseBody(event: FunctionUrlEvent): unknown {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return null; // 無法解析 → 由呼叫端回 400
  }
}

/** 從 body / query 取 ProduceSurveyRequest;缺 sectionId 或座標非法回 null。 */
function parseRequest(event: FunctionUrlEvent): ProduceSurveyRequest | null {
  const body = parseBody(event);
  if (body === null) return null;
  const q = event.queryStringParameters ?? {};
  const b = (body ?? {}) as Record<string, unknown>;

  const sectionId = typeof b.sectionId === "string" ? b.sectionId : q.sectionId;
  if (!sectionId || sectionId.trim() === "") return null;

  let benchmarkLocation: { lat: number; lng: number } | undefined;
  const loc = b.benchmarkLocation as { lat?: unknown; lng?: unknown } | undefined;
  if (loc && typeof loc.lat === "number" && typeof loc.lng === "number") {
    benchmarkLocation = { lat: loc.lat, lng: loc.lng };
  } else if (q.lat != null && q.lng != null) {
    const lat = Number(q.lat);
    const lng = Number(q.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) benchmarkLocation = { lat, lng };
  }

  return {
    sectionId: sectionId.trim(),
    benchmarkLocation,
    sectionPolygon: parseSectionPolygon(b.sectionPolygon),
    facilities: parseFacilitiesOptions(b.facilities, q),
  };
}

/**
 * 取區段範圍多邊形。收 `{ lat, lng }[]`(前端地圖圈選的原生形狀)與 `[lng, lat][]` 兩種寫法。
 *
 * 點數不足 3 的一律當沒帶 —— 兩個點圍不出面積,算出來的「重心」是線段中點,會讓整份
 * metersToCenter 悄悄以一個沒有意義的基準點產出。寧可退回「圓心 = 比準地」的既有行為,
 * 並留一行 log,也不要生出一批看起來正常、其實無從解釋的距離。
 */
function parseSectionPolygon(raw: unknown): LatLng[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const points: LatLng[] = [];
  for (const entry of raw) {
    if (Array.isArray(entry) && entry.length >= 2) {
      const lng = Number(entry[0]);
      const lat = Number(entry[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) points.push({ lat, lng });
      continue;
    }
    if (entry && typeof entry === "object") {
      const p = entry as { lat?: unknown; lng?: unknown; lon?: unknown };
      const lat = Number(p.lat);
      const lng = Number(p.lng ?? p.lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) points.push({ lat, lng });
    }
  }
  if (points.length < MIN_RING_POINTS) {
    console.warn(
      `[produce-survey] sectionPolygon 只解析到 ${points.length} 個有效座標(需 ≥ ${MIN_RING_POINTS}),` +
        "改以比準地座標為查詢中心。",
    );
    return undefined;
  }
  return points;
}

/**
 * 取周邊設施的查詢範圍。body 走 `facilities: { radius, categories }`,query 走
 * `?facilityRadius=&cats=`。`categories` 收兩種寫法 —— 前端直接給 `{category, radius}[]`,
 * 或已經序列化好的 `"<類別>:<半徑>;…"` —— 一律轉成後者交給 facilities。
 * 值本身不在這裡驗證(合法類別只有 facilities 知道),寫錯會被上游擋成 400 並記進 log。
 */
function parseFacilitiesOptions(
  raw: unknown,
  q: Record<string, string | undefined>,
): FacilitiesOptions {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const radius = Number(o.radius ?? q.facilityRadius);
  const rawCategories = o.categories ?? q.cats;

  let categories: string | undefined;
  if (typeof rawCategories === "string") {
    categories = rawCategories.trim() || undefined;
  } else if (Array.isArray(rawCategories)) {
    const pairs = rawCategories
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e) => `${String(e.category ?? "")}:${String(e.radius ?? "")}`)
      .filter((pair) => !pair.startsWith(":") && !pair.endsWith(":"));
    categories = pairs.length > 0 ? pairs.join(";") : undefined;
  }

  return {
    ...(Number.isFinite(radius) && radius > 0 ? { radius } : {}),
    ...(categories ? { categories } : {}),
  };
}

// --- handler ----------------------------------------------------------------

/**
 * produce-survey handler。POST ProduceSurveyRequest → ProduceSurveyResponse。
 * orchestrate facilities + 8 類 district-survey-draft(並行),graceful 降級,組表3 回前端。
 */
export async function handler(event: FunctionUrlEvent): Promise<JsonResponse> {
  const method = event.requestContext?.http?.method ?? "GET";
  if (method === "OPTIONS") return json(204, {});
  if (method !== "POST") return json(405, { error: `Method ${method} not allowed.` });

  const req = parseRequest(event);
  if (!req) {
    return json(400, { error: "Invalid request: sectionId is required (body or ?sectionId=)." });
  }

  const location: LatLng | undefined = req.benchmarkLocation
    ? { lat: req.benchmarkLocation.lat, lng: req.benchmarkLocation.lng }
    : undefined;

  // draft 要拿 facilities 的結果當事實依據,所以是序列:先查設施,再把 facts 轉發給 8 類草稿
  // (8 類彼此仍並行)。facilities 失敗時 facts 為 undefined,草稿照跑但 usedFacts 會是 false,
  // 映射層就不會把模型編的內容當事實寫進欄位。
  const facilities = await fetchFacilities(location, req.sectionPolygon, req.facilities);
  const drafts = await fetchAllDrafts(toDraftFacts(facilities));

  const response = assembleSurveyResponse({
    sectionId: req.sectionId,
    benchmarkLocation: location,
    sectionPolygon: req.sectionPolygon,
    facilities,
    drafts,
  });

  return json(200, response);
}
