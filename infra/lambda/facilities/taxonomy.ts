// 設施分類表 —— 「一筆設施屬於哪個 category、哪個評估群組」的單一事實來源。
//
// 三個模組都要同一份分類,所以抽成獨立模組(而不是留在 query.ts):
//   - input.ts  驗證並展開呼叫端給的 categories[](群組名 → 底下所有 category)
//   - query.ts  把 category 轉成中文 kind、再捲成 6 大群的 byCategory
//   - nlsc.ts   取即時 API 那四類的中文 kind 標籤
// input.ts 若直接 import query.ts 會形成 query → nlsc → query 的迴圈,放這裡可避開。

/** 6 大評估群組。順序即 byCategory 的顯示順序;`其他` 收所有未對應的 category。 */
export type FacilityGroup =
  | "交通"
  | "公共設施"
  | "公共建設"
  | "特殊設施"
  | "工商活動"
  | "其他";

export const GROUP_ORDER: FacilityGroup[] = [
  "交通",
  "公共設施",
  "公共建設",
  "特殊設施",
  "工商活動",
  "其他",
];

// 車站類點位表。這三張表一張一個 kind、沒有 category 欄位,所以 kind 本身就是它們的
// selector(呼叫端要單獨調整公車站半徑時寫 `公車站`)。nameExpr 是該表存人類可讀名稱的
// jsonb 欄位。幾何一律 WGS84 (4326)。線段圖層(metro_lines/freeway_lines/…)不在這裡 ——
// 「設施」只算點位,沿線距離是另一回事。
//
// 火車站(台鐵)與客運站不在這裡:assets/ 沒有它們的站位檔(只有鐵路路線.json 這個線段層),
// 所以改從 OSM 進 `pois`,見下面 CATEGORY_GROUP 的 railway_station / bus_station。
export const STATION_TABLES: { table: string; kind: string; nameExpr: string }[] = [
  { table: "metro_stations", kind: "捷運站", nameExpr: "props->>'MARKNAME1'" },
  { table: "hsr_stations", kind: "高鐵站", nameExpr: "props->>'MARKNAME1'" },
  { table: "bus_stops", kind: "公車站", nameExpr: "props->>'namezh'" },
];

/** 車站類的 kind 集合,用來判斷一筆設施是不是車站(車站沒有 category)。 */
export const STATION_KINDS = new Set(STATION_TABLES.map((t) => t.kind));

// category → 評估群組。前 18 個來自 OSM 的 `pois` 表,後 4 個
// (cemetery/fuel/medical/education)來自 NLSC 即時 API。有專屬點位表的三種車站不在這裡,
// 走 STATION_KINDS。
export const CATEGORY_GROUP: Record<string, FacilityGroup> = {
  // 交通
  motorway_junction: "交通",
  settlement: "交通",
  // 台鐵車站與客運場站。捷運/高鐵/公車站有各自的點位表(STATION_TABLES),這兩類沒有站位
  // 來源檔,改由 OSM 進 `pois`(fetch-osm.mjs 的 railway_station / bus_station),所以走
  // category 而不是 kind。
  railway_station: "交通",
  bus_station: "交通",
  // 公共設施
  market: "公共設施",
  park: "公共設施",
  education: "公共設施",
  medical: "公共設施",
  // 公共建設
  tourism: "公共建設",
  parking: "公共建設",
  wastewater: "公共建設",
  // 特殊設施(嫌惡設施)
  substation: "特殊設施",
  power_tower: "特殊設施",
  gas_storage: "特殊設施",
  waste: "特殊設施",
  cemetery: "特殊設施",
  crematorium: "特殊設施",
  fuel: "特殊設施",
  // 工商活動
  department_store: "工商活動",
  bank: "工商活動",
  entertainment: "工商活動",
  hotel: "工商活動",
};

// category → 回傳給前端的中文 kind。`pois` 表裡沒列到的 category 不會消失,query.ts 會
// 原樣回傳該 category 字串當 kind。
export const CATEGORY_KIND_ZH: Record<string, string> = {
  // OSM `pois`
  market: "市場",
  park: "公園",
  tourism: "觀光設施",
  parking: "停車場",
  wastewater: "污廢水處理設施",
  substation: "變電所",
  power_tower: "高壓電塔",
  waste: "垃圾/焚化設施",
  gas_storage: "儲氣/儲油槽",
  crematorium: "火葬場",
  settlement: "聚落",
  department_store: "百貨公司",
  bank: "金融機構",
  entertainment: "娛樂設施",
  hotel: "觀光飯店",
  motorway_junction: "交流道",
  // 表1「大型車站」四格裡的火車站/客運站,draft prompt 就是靠這兩個中文 kind 對進
  // majorStation.items[1] / items[2]。
  railway_station: "火車站",
  bus_station: "客運站",
  // NLSC 即時 API
  cemetery: "殯葬設施",
  fuel: "加油站",
  medical: "醫療設施",
  education: "文教設施",
};

// 群組的英文別名 —— 讓 GET 的 `cats=` 不必塞中文(URL encode 很醜)。
const GROUP_ALIAS: Record<string, FacilityGroup> = {
  transport: "交通",
  public_facility: "公共設施",
  infrastructure: "公共建設",
  special: "特殊設施",
  commerce: "工商活動",
};

// 車站的英文別名,同理。車站沒有 category 欄位,atom 本身是中文 kind。
const STATION_ALIAS: Record<string, string> = {
  metro: "捷運站",
  hsr: "高鐵站",
  bus_stop: "公車站",
};

/** 可被單獨指定半徑的最小單位:所有 category key ＋ 三個車站 kind。 */
const ATOMS = new Set<string>([...Object.keys(CATEGORY_GROUP), ...STATION_KINDS]);

// 中文 kind → category,讓呼叫端寫 `公園` 跟寫 `park` 一樣通。車站的中文 kind 本身就是
// atom,不需要轉換。
const KIND_TO_CATEGORY = new Map(
  Object.entries(CATEGORY_KIND_ZH).map(([category, kind]) => [kind, category]),
);

/**
 * 把呼叫端寫的一個類別名稱展開成實際要套半徑的 atom 清單。接受四種寫法:
 *
 *   - 群組中文名     `特殊設施`  → 該群底下所有 category(＋交通群的三個車站 kind)
 *   - 群組英文別名   `special`   → 同上
 *   - category key   `park`      → `["park"]`
 *   - 中文 kind      `公園`/`公車站` → 對應的 atom
 *   - 車站英文別名   `bus_stop`  → `["公車站"]`
 *
 * 認不得就回 null(由 input.ts 轉成 400)。`其他` 沒有固定成員,無法指定半徑,也回 null。
 */
export function expandSelector(name: string): string[] | null {
  const raw = name.trim();
  if (!raw) return null;
  const key = STATION_ALIAS[raw] ?? raw;

  const group = GROUP_ALIAS[key] ?? (GROUP_ORDER.includes(key as FacilityGroup) ? (key as FacilityGroup) : undefined);
  if (group) {
    if (group === "其他") return null; // 成員不固定,不開放指定
    const atoms = Object.entries(CATEGORY_GROUP)
      .filter(([, g]) => g === group)
      .map(([category]) => category);
    if (group === "交通") atoms.push(...STATION_KINDS);
    return atoms;
  }

  if (ATOMS.has(key)) return [key];
  const viaKind = KIND_TO_CATEGORY.get(key);
  return viaKind ? [viaKind] : null;
}

/** 400 訊息用的合法值提示。 */
export const SELECTOR_HINT = `Valid values: group (${GROUP_ORDER.filter((g) => g !== "其他").join("/")} or ${Object.keys(GROUP_ALIAS).join("/")}), category key (${Object.keys(CATEGORY_GROUP).join("/")}), station (${Object.keys(STATION_ALIAS).join("/")} or ${[...STATION_KINDS].join("/")}), or 中文 kind.`;
