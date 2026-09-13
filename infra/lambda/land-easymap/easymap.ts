// easymap client — 地籍圖資網路便民服務系統 (easymap.moi.gov.tw) 的純 HTTP 查詢客戶端。
//
// 來源:專案根目錄的 crawl-easymap/easymap.ts(CLI 探索版)。這裡是 lambda 用的函式庫版本,
// 查詢流程與解析規則完全照舊,只做「搬進 lambda 該做的事」:
//   1. 拿掉 CLI(parseArgs / CSV / writeFileSync)—— 入口改由 ./lambda.ts 負責。
//   2. 逐行 console.log 改成 EASYMAP_DEBUG=1 才輸出(CloudWatch 不要被 request dump 洗版)。
//   3. 每個 fetch 加 timeout —— lambda 有執行時間上限,上游卡住要快速失敗而不是耗到逾時。
//   4. NLSC 代碼對照表的快取拉到 module scope —— warm 容器跨請求重用,省掉三支 NLSC 往返。
//   5. 「查無縣市/鄉鎮/地段」丟具名錯誤(NotFoundError),讓 handler 能回 404 而不是一律 502。
//
// 查詢流程(每筆地號,token 用過即廢,務必序列):
//   1. GET  /Z10Web/Normal                -> JSESSIONID / BIG-IP cookie
//   2. POST /Z10Web/layout/setToken.jsp   -> 一次性 struts token
//   3. POST /Z10Web/Land_json_locate      -> { X: lon, Y: lat } WGS84(宗地定位點,非界址點)
//   4. POST /Z10Web/layout/setToken.jsp   -> 再取一次
//   5. POST /Z10Web/LandDesc_ajax_detail  -> HTML 片段(面積/公告現值/公告地價/建號)
//
// 段名 -> office/sectNo 由 NLSC 免申請 API 解析,不爬 easymap 的下拉選單。

import { load } from "cheerio/slim";
import { setTimeout as sleep } from "node:timers/promises";

// ---------------------------------------------------------------------------
const BASE = "https://easymap.moi.gov.tw/Z10Web";
const NLSC = "https://api.nlsc.gov.tw/other";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
  Origin: "https://easymap.moi.gov.tw",
  Referer: `${BASE}/Normal`,
  "X-Requested-With": "XMLHttpRequest",
};

const M2_PER_PING = 3.305785;

/** 單一次 HTTP 往返的上限。上游(easymap / NLSC)偶爾會卡住,寧可快速失敗讓呼叫端重試。 */
const TIMEOUT_MS = Number(process.env.EASYMAP_TIMEOUT_MS ?? 8000);

/** 一筆地號查詢的重試次數(含第一次)。每次重試前重建 session 並指數退避。 */
export const DEFAULT_RETRIES = Number(process.env.EASYMAP_RETRIES ?? 2);

const LABELS: Record<string, string> = {
  行政區: "adminArea",
  地政事務所: "landOffice",
  地段: "section",
  地號: "parcelNo",
  面積: "areaM2",
  公告現值: "announcedValuePerM2",
  公告地價: "announcedLandPricePerM2",
  土地參考資訊: "referenceInfo",
};

/** LABELS 對應出來的「真的有內容」欄位名(不含 meta_*)。 */
const LAND_FIELD_KEYS = Object.values(LABELS);

/**
 * 這份明細是否真的查到地號。
 *
 * 不能用「fields 是不是空的」判斷:上游對不存在的地號會回一個**空殼頁**,表格沒有任何
 * 一列,但隱藏 div 的 meta_* 照樣在(meta_townname / meta_sectname / meta_landno 都是空字串)。
 * 所以只認 LABELS 解出來的欄位。
 */
export function hasLandData(f: LandFields): boolean {
  return LAND_FIELD_KEYS.some((k) => f[k] !== undefined && f[k] !== "");
}

export const DISCLAIMER =
  "本系統提供查詢之登記資料為定期產製, 非即時, 應以地政事務所核發之謄本為準; " +
  "公告現值/地價為 115 年度資料";

export const SOURCE = "easymap.moi.gov.tw";
export const PRICE_YEAR = "115";

// 逐一列印每個 request 對除錯很有用,但在 lambda 是每次呼叫都洗 CloudWatch。預設關掉。
const DEBUG = process.env.EASYMAP_DEBUG === "1";
function debug(...args: unknown[]): void {
  if (DEBUG) console.log("[easymap]", ...args);
}

/** 上游查無此縣市/鄉鎮/地段 —— 是「查不到」不是「壞掉」,handler 據此回 404。 */
export class NotFoundError extends Error {}

// ---------------------------------------------------------------------------
export interface Query {
  county: string;
  town: string;
  sectionName: string;
  parcel: string;
}

export interface ResolvedQuery extends Query {
  cityCode: string;
  townCode: string;
  office: string;
  sectNo: string;
}

export interface LandFields {
  adminArea?: string;
  landOffice?: string;
  section?: string;
  sectionCode?: string;
  sectionNameParsed?: string;
  parcelNo?: string;
  parcelDisplay?: string;
  areaM2?: number;
  areaPing?: number;
  announcedValuePerM2?: number;
  announcedValueTotal?: number;
  announcedLandPricePerM2?: number;
  announcedLandPriceTotal?: number;
  referenceInfo?: string;
  [k: string]: string | number | undefined;
}

export interface EasymapRecord {
  query: ResolvedQuery;
  fields: LandFields;
  buildings: string[];
  lon: number | null;
  lat: number | null;
  source: string;
  fetchedAt: string;
  priceYear: string;
  disclaimer: string;
  error: string | null;
}

/** cheerio/slim 的 load() 回傳型別(slim 進入點不導出 CheerioAPI,就地推導)。 */
type Dom = ReturnType<typeof load>;

// ---------------------------------------------------------------------------
// 帶 timeout 的 fetch —— 其餘行為與全域 fetch 相同。
// ---------------------------------------------------------------------------
async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`upstream timeout after ${TIMEOUT_MS}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 極簡 cookie jar — Node 的 fetch 不會自動帶 cookie
// ---------------------------------------------------------------------------
class CookieJar {
  private jar = new Map<string, string>();

  absorb(res: Response): void {
    const raw =
      typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie ===
      "function"
        ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : (res.headers.get("set-cookie") ?? "").split(/,(?=[^ ;]+=)/);
    for (const line of raw as string[]) {
      if (!line) continue;
      const [pair] = line.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) this.jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }

  header(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  clear(): void {
    this.jar.clear();
  }
}

// ---------------------------------------------------------------------------
// NLSC 代碼解析: 段名 -> (地所代碼 office, 地段代碼 sectNo)
//
// 這三張對照表是全國性的靜態資料,一天內不會變,所以三個 Map 放 module scope:
// 同一個 warm 容器的後續請求直接命中快取,不用再打 NLSC。
// ---------------------------------------------------------------------------
const countyCache = new Map<string, string>();
const townCache = new Map<string, string>();
const sectCache = new Map<string, { office: string; sectNo: string }>();

class Codes {
  private async xml(path: string): Promise<Dom> {
    debug(`fetch(${NLSC}/${path})`);
    const res = await fetchWithTimeout(`${NLSC}/${path}`, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`NLSC ${path} -> HTTP ${res.status}`);
    return load(await res.text(), { xmlMode: true });
  }

  /** 欄位名大小寫在不同端點有出入, 逐一嘗試 */
  private static pick($: Dom, el: unknown, ...names: string[]): string {
    for (const n of names) {
      const v = $(el as never).find(n).first().text().trim();
      if (v) return v;
    }
    return "";
  }

  async countyCode(name: string): Promise<string> {
    if (countyCache.size === 0) {
      const $ = await this.xml("ListCounty");
      $("*")
        .filter((_, e) => $(e).children().length > 0)
        .each((_, e) => {
          const nm = Codes.pick($, e, "countyname", "countyName");
          const cd = Codes.pick($, e, "countycode", "countyCode");
          if (nm && cd) countyCache.set(nm, cd);
        });
    }
    const c = countyCache.get(name);
    if (!c) throw new NotFoundError(`查無縣市 ${name}`);
    return c;
  }

  async townCode(city: string, name: string): Promise<string> {
    const key = `${city}|${name}`;
    if (!townCache.has(key)) {
      const $ = await this.xml(`ListTown/${city}`);
      $("*")
        .filter((_, e) => $(e).children().length > 0)
        .each((_, e) => {
          const nm = Codes.pick($, e, "townname", "townName");
          const cd = Codes.pick($, e, "towncode", "townCode");
          if (nm && cd) townCache.set(`${city}|${nm}`, cd);
        });
    }
    const c = townCache.get(key);
    if (!c) throw new NotFoundError(`查無鄉鎮市區 ${name}`);
    return c;
  }

  async sectionCode(
    city: string,
    townRaw: string,
    name: string,
  ): Promise<{ office: string; sectNo: string }> {
    const key = `${city}|${townRaw}|${name}`;
    if (!sectCache.has(key)) {
      const $ = await this.xml(`ListLandSection/${city}/${townRaw}`);
      $("*")
        .filter((_, e) => $(e).children().length > 0)
        .each((_, e) => {
          const nm = Codes.pick($, e, "sectstr", "sectstr");
          const sc = Codes.pick($, e, "sectcode", "sectCode");
          const of = Codes.pick($, e, "officecode", "officeCode", "office");
          if (nm && sc) sectCache.set(`${city}|${townRaw}|${nm}`, { office: of, sectNo: sc });
        });
    }
    const s = sectCache.get(key);
    if (!s) throw new NotFoundError(`查無地段 ${name}`);
    return s;
  }

  async resolve(q: Query): Promise<ResolvedQuery> {
    const cityCode = await this.countyCode(q.county);
    const townRaw = await this.townCode(cityCode, q.town);
    const { office, sectNo } = await this.sectionCode(cityCode, townRaw, q.sectionName);
    return {
      ...q,
      cityCode,
      // easymap 的 townCode 是純數字 (25); NLSC 可能回 F25 — 去掉前綴字母
      townCode: townRaw.replace(/^[A-Za-z]+/, ""),
      office,
      sectNo,
    };
  }
}

/** 代碼對照表是純查表,沒有 session 狀態,整個容器共用一份。 */
const codes = new Codes();

// ---------------------------------------------------------------------------
export class EasymapClient {
  private jar = new CookieJar();
  private ready = false;

  private async req(url: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookie = this.jar.header();
    if (cookie) headers.set("Cookie", cookie);

    debug(init.method ?? "GET", url);
    const res = await fetchWithTimeout(url, { ...init, headers, redirect: "follow" });
    this.jar.absorb(res);
    return res;
  }

  /** 先 GET 首頁拿 JSESSIONID 與 BIG-IP 的 TS01 cookie */
  async bootstrap(): Promise<void> {
    this.jar.clear();
    const res = await this.req(`${BASE}/Normal`, {
      method: "GET",
      headers: { "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`bootstrap HTTP ${res.status}`);
    await res.text();
    this.ready = true;
  }

  /** 一次性 struts token — 每支 API 前都要重取, 不可快取 */
  private async token(): Promise<string> {
    if (!this.ready) await this.bootstrap();
    const res = await this.req(`${BASE}/layout/setToken.jsp`, {
      method: "POST",
      headers: { ...COMMON_HEADERS, Accept: "*/*" },
      body: "",
    });
    const html = await res.text();
    const m = /name="token"\s+value="([^"]+)"/i.exec(html);
    if (!m) throw new Error(`取不到 token: ${html.slice(0, 200)}`);
    debug("token", m[1]);
    return m[1];
  }

  private async post(path: string, body: Record<string, string>, accept: string) {
    const token = await this.token();
    const form = new URLSearchParams({ ...body, "struts.token.name": "token", token });
    debug(`POST ${BASE}/${path}`, body);
    return this.req(`${BASE}/${path}`, {
      method: "POST",
      headers: {
        ...COMMON_HEADERS,
        Accept: accept,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: form.toString(),
    });
  }

  /** 回傳 [lon, lat] WGS84 — 這是宗地定位點, 不是界址點 */
  async locate(q: ResolvedQuery): Promise<[number, number]> {
    const res = await this.post(
      "Land_json_locate",
      { sectNo: q.sectNo, office: q.office, landNo: q.parcel },
      "application/json, text/javascript, */*; q=0.01",
    );
    if (!res.ok) throw new Error(`locate HTTP ${res.status}`);
    const j = (await res.json()) as { X: number; Y: number };
    debug("locate", [Number(j.X), Number(j.Y)]);
    return [Number(j.X), Number(j.Y)];
  }

  async detail(q: ResolvedQuery): Promise<string> {
    const res = await this.post(
      "LandDesc_ajax_detail",
      {
        cityCode: q.cityCode,
        townCode: q.townCode,
        office: q.office,
        sectNo: q.sectNo,
        landNo: q.parcel,
      },
      "text/html, */*; q=0.01",
    );
    if (!res.ok) throw new Error(`detail HTTP ${res.status}`);
    return res.text();
  }

  async resolve(q: Query): Promise<ResolvedQuery> {
    return codes.resolve(q);
  }

  /**
   * 查一筆地號。定位與明細各自失敗都只記在 rec.error(部分成功仍回傳),
   * 整筆失敗才在重建 session + 退避後重試;retries 用完回最後一次的結果。
   *
   * 只有「明細這一段真的丟例外」(HTTP / token / 連線)才重試 —— 那才是 session 逾時。
   * 明細順利回來但解析出 0 個欄位,代表這個地號在上游就是查無資料,重試只是白白多等
   * 一輪退避(實測一次 404 會被拖成 4 次往返),所以直接收工讓 handler 回 404。
   *
   * 段名解析(NLSC)失敗會直接往外丟 NotFoundError —— 那是「查無此段」,重試沒有意義。
   */
  async query(q: Query, retries = DEFAULT_RETRIES): Promise<EasymapRecord> {
    const resolved = await codes.resolve(q);
    let last: EasymapRecord | null = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      let detailThrew = false;
      const rec: EasymapRecord = {
        query: resolved,
        fields: {},
        buildings: [],
        lon: null,
        lat: null,
        source: SOURCE,
        fetchedAt: new Date().toISOString(),
        priceYear: PRICE_YEAR,
        disclaimer: DISCLAIMER,
        error: null,
      };

      try {
        const [lon, lat] = await this.locate(resolved);
        rec.lon = lon;
        rec.lat = lat;
      } catch (e) {
        rec.error = `locate: ${(e as Error).message}`;
      }

      try {
        const html = await this.detail(resolved);
        const { fields, buildings } = parseDetail(html);
        if (!hasLandData(fields)) {
          rec.error = `${rec.error ?? ""} detail: 查無資料或版面變更`.trim();
        }
        rec.fields = normalise(fields);
        rec.buildings = buildings;
      } catch (e) {
        detailThrew = true;
        rec.error = `${rec.error ?? ""} detail: ${(e as Error).message}`.trim();
      }

      if (!rec.error) return rec;
      last = rec;
      if (!detailThrew) return rec; // 查無資料(非故障),不重試
      // token 失效與 session 逾時通常是同一件事 — 重建後退避
      if (attempt < retries - 1) {
        await this.bootstrap();
        await sleep(2 ** attempt * 1000 + Math.random() * 1000);
      }
    }
    return last!;
  }
}

// ---------------------------------------------------------------------------
export function parseDetail(html: string): { fields: LandFields; buildings: string[] } {
  const $ = load(html);
  const fields: LandFields = {};

  const rows = $("#LANDtab").length ? $("#LANDtab tr") : $("tr");
  rows.each((_, tr) => {
    const th = $(tr).find("th").first();
    const td = $(tr).find("td").first();
    if (!th.length || !td.length) return;
    const key = LABELS[th.text().trim()];
    if (key) fields[key] = td.text().replace(/\s+/g, " ").trim();
  });

  // 隱藏 div 的 data-* 比表格字串好切
  for (const m of html.matchAll(
    /\$\("#landDesc_hidden_div"\)\.data\("(\w+)",\s*"([^"]*)"\)/g,
  )) {
    const k = `meta_${m[1]}`;
    if (fields[k] === undefined) fields[k] = m[2];
  }

  // 建號: onclick="qtCommon.getBuildDetail('FD','1027','00007000',...)"
  const buildings = [
    ...new Set(
      [...html.matchAll(/getBuildDetail\('[^']*','[^']*','(\d+)'/g)].map((m) => m[1]),
    ),
  ].sort();

  return { fields, buildings };
}

export function normalise(f: LandFields): LandFields {
  const num = (k: string): number | undefined => {
    const v = f[k];
    if (typeof v !== "string") return typeof v === "number" ? v : undefined;
    const m = /[\d,]+\.?\d*/.exec(v);
    return m ? Number(m[0].replace(/,/g, "")) : undefined;
  };

  const area = num("areaM2");
  const cur = num("announcedValuePerM2");
  const price = num("announcedLandPricePerM2");

  if (area !== undefined) {
    f.areaM2 = area;
    f.areaPing = Math.round((area / M2_PER_PING) * 100) / 100;
  }
  if (cur !== undefined) {
    f.announcedValuePerM2 = cur;
    if (area !== undefined) f.announcedValueTotal = Math.round(area * cur);
  }
  if (price !== undefined) {
    f.announcedLandPricePerM2 = price;
    if (area !== undefined) f.announcedLandPriceTotal = Math.round(area * price);
  }

  if (typeof f.section === "string") {
    const m = /^(\d+)\s+(.+)$/.exec(f.section);
    if (m) {
      f.sectionCode = m[1];
      f.sectionNameParsed = m[2];
    }
  }

  if (typeof f.parcelNo === "string" && /^\d{8}$/.test(f.parcelNo)) {
    const parent = Number(f.parcelNo.slice(0, 4));
    const child = Number(f.parcelNo.slice(4));
    f.parcelDisplay = child ? `${parent}-${child}` : String(parent);
  }

  return f;
}
