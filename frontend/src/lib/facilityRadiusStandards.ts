// 周邊設施查詢半徑標準 —— 這份表是「業務標準」，不是後端實作細節，所以放在前端由呼叫端
// 帶給 API（facilities 的 `cats=`／produce-survey 的 `facilities.categories`）。改半徑只改
// 這一個檔，後端不需要動、也不需要重新部署。
//
// 每一類的距離級距本來就不同——站牌 800m 就夠，交流道要 4km 才問得出「最近的在哪」——
// 用單一 radius 不是太吵就是太短，所以逐類指定。API 回傳的 area.categoryRadii 會如實回報
// 每類實際套用的半徑，勘查表的佐證文字直接引用它，不會出現「半徑600m內」卻放了 900m 外
// 設施的情況。
//
// `categories` 寫的是 API 的 selector，四種寫法都通：
//   群組中文名 `特殊設施`／群組英文別名 `special`／category 鍵 `park`／車站別名 `bus_stop`
// 群組會展開成底下所有類別（`special` → 殯葬/火葬場/垃圾焚化/變電所/電塔/儲氣槽/加油站）。

export interface FacilityRadiusRule {
  /** 勘查標準上的項目名稱，純粹給人看的。 */
  label: string;
  /** 對應到 API 的 selector（可為群組、category 鍵或車站別名）。 */
  categories: string[];
  /** 半徑（公尺）。 */
  radius: number;
}

/** 表3 地價區段勘查表「區域因素」的查詢半徑標準。 */
export const REGIONAL_FACILITY_RADII: FacilityRadiusRule[] = [
  // 大型車站＝表1 的四格：高鐵/火車/客運/捷運。火車站與客運站沒有專屬點位表，走 pois 的
  // railway_station / bus_station（見 facilities/taxonomy.ts）。
  {
    label: "大型車站",
    categories: ["metro", "hsr", "railway_station", "bus_station"],
    radius: 2000,
  },
  { label: "站牌", categories: ["bus_stop"], radius: 800 },
  { label: "交流道", categories: ["motorway_junction"], radius: 4000 },
  { label: "學校", categories: ["education"], radius: 1000 },
  { label: "市場", categories: ["market"], radius: 1000 },
  { label: "公園、廣場", categories: ["park"], radius: 1000 },
  { label: "觀光", categories: ["tourism"], radius: 2000 },
  { label: "停車場", categories: ["parking"], radius: 1000 },
  // 服務性設施：醫療 ＋ 工商活動整群（金融/百貨/娛樂/飯店）
  { label: "服務性設施", categories: ["medical", "commerce"], radius: 2000 },
  {
    label: "電器設施、燃料設施",
    categories: ["substation", "power_tower", "gas_storage", "fuel"],
    radius: 2000,
  },
  { label: "殯葬", categories: ["cemetery", "crematorium"], radius: 2000 },
  { label: "廢棄物處理設施", categories: ["waste"], radius: 2000 },
  { label: "環境污染", categories: ["wastewater"], radius: 2000 },
];

/** 表4 比較法調查估價表「個別因素」的查詢半徑標準——這一側全部 2000m。 */
export const INDIVIDUAL_FACILITY_RADII: FacilityRadiusRule[] = [
  { label: "學校", categories: ["education"], radius: 2000 },
  { label: "市場", categories: ["market"], radius: 2000 },
  { label: "公園、廣場", categories: ["park"], radius: 2000 },
  // 個別因素的「車站」含站牌，與區域因素的 800m 不同
  {
    label: "車站",
    categories: ["metro", "hsr", "bus_stop", "railway_station", "bus_station"],
    radius: 2000,
  },
  { label: "商圈", categories: ["commerce"], radius: 2000 },
  { label: "嫌惡設施", categories: ["special"], radius: 2000 },
];

/** 基準半徑：標準表沒列到的類別（如聚落）用它。 */
export const BASE_FACILITY_RADIUS_METERS = 600;

/** 攤平成 API 的 `categories` 陣列（POST body 用）。 */
export function toCategoriesPayload(
  rules: FacilityRadiusRule[],
): { category: string; radius: number }[] {
  return rules.flatMap((rule) =>
    rule.categories.map((category) => ({ category, radius: rule.radius })),
  );
}

/** `{category, radius}[]` → query string 的 `cats=<類別>:<半徑>;…`（GET 用）。 */
export function categoriesToParam(
  pairs: { category: string; radius: number }[],
): string {
  return pairs.map(({ category, radius }) => `${category}:${radius}`).join(";");
}

/** 標準表 → query string 的 `cats=<類別>:<半徑>;…`（GET 用）。 */
export function toCategoryRadiiParam(rules: FacilityRadiusRule[]): string {
  return categoriesToParam(toCategoriesPayload(rules));
}
