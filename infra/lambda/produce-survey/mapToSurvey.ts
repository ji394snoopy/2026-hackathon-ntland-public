// produce-survey mapping layer — facilities + 8 類 district-survey-draft → 表3 ProduceSurveyResponse。
//
// 這裡是本支的「映射核心」(plan §3 / §5):把兩個上游的原始回傳
//   ① facilities(周邊設施查詢,byCategory + facilities[])
//   ② district-survey-draft(8 類各自的 content JSON 草稿)
// 攤平映射成前端要吃的 SurveyField[](+ ComparisonCondition benchmark)。
//
// 型別一律從 shared/db 重用(那份是抄 API_INTEGRATION.md §1 的前端型別,單一事實來源),
// 不再自抄一份;cli 內部 draft schema → SurveyField 的轉換集中在本檔。
//
// 設計對齊 frontend/src/api/index.ts 的 produceSurvey()(前端 mock 的即時 enrichment):
//   - 欄位預設一律「空、需人工現場確認」(本產品是 AI 主動查找,不是承接紙本現場勘查紀錄)。
//   - facilities 查得到 → source "ai" + items + value「名稱，距NNNM」+ reference 佐證。
//     items 每筆帶**兩個**距離:metersToCenter(到區段中心)與 metersToPoint(到本案地點),
//     前者供區域因素(表5)評級、後者供個別因素(表4)評級 —— 區域因素評的是整個區段的條件,
//     個別因素評的是這一筆宗地自己,基準點本來就不是同一個。兩點相同時只寫前者。
//   - 8 類 draft 依 draftFieldMap 的對照表取到值 → source "ai" + value + reference(標來源與 content 路徑)。
//   - 該類 draft 的 usedFacts 為 false(沒吃到 facilities 實測事實)→ 內容是模型憑空編的,
//     不寫進 value,只掛 warning;欄位維持 empty。
//   - 上游失敗/查無 → 該欄位維持 empty,origin/warning 標「需人工確認」,不硬塞假資料、不整支 502。

import type {
    ComparisonCondition,
    FieldReference,
    LatLng,
    SurveyField,
} from "../shared/db";
import {
    DRAFT_CATEGORY_LABEL,
    DRAFT_FIELD_MAP,
    draftFieldPath,
    resolveDraftValue,
    type DraftCategory,
} from "./draftFieldMap";

// DRAFT_CATEGORIES / DraftCategory 的家在 draftFieldMap(與對照表同一份事實來源);
// 這裡轉出去,呼叫端(lambda.ts)維持從 mapToSurvey import 不變。
export { DRAFT_CATEGORIES, type DraftCategory } from "./draftFieldMap";

// ---------------------------------------------------------------------------
// 上游回傳型別(只宣告本支會讀到的欄位;完整契約見 API_INTEGRATION.md §2)
// ---------------------------------------------------------------------------

/** facilities 扁平清單裡的一筆設施。 */
export interface FacilityItem {
  kind: string; // 中文類別標籤,如 "文教設施"／"公園"／"公車站"
  category?: string; // 穩定分類鍵(OSM/NLSC 來源才有),站點資料無
  name: string | null;
  lon: number;
  lat: number;
  metersToCenter: number; // 到查詢中心(區段多邊形則為其幾何重心)的距離
  /** 到請求帶的地點(比準地)的距離;呼叫端沒帶 point 時 undefined。 */
  metersToPoint?: number;
}

/** GET /api/facilities 的回傳(本支只讀 area + facilities)。 */
export interface NearbyFacilitiesResponse {
  area: {
    kind: "radius" | "polygon";
    center: { lon: number; lat: number };
    /** center 是由區段多邊形的重心推導出來的(呼叫端帶了 polygon + radius)。 */
    centerFrom?: "polygon";
    /** 第二量測點(地點／比準地),上游原樣回拋。 */
    point?: { lon: number; lat: number };
    /** 基準半徑;未被 categoryRadii 覆寫的類別都用它。 */
    radiusMeters?: number;
    /** 逐類實際套用的半徑(只列有覆寫的),key 是 category 鍵或車站的中文 kind。 */
    categoryRadii?: Record<string, number>;
  };
  facilities: FacilityItem[];
  byCategory?: Record<string, unknown>;
  doorplate?: unknown;
}

/** district-survey-draft 單類回傳:{ category, content, usedFacts }。 */
export interface DraftResult {
  category: DraftCategory;
  content: unknown;
  usedFacts?: boolean;
}

/** orchestration 收集的單類結果:成功帶 content,失敗帶 error(供映射時標「需人工確認」)。 */
export interface DraftOutcome {
  category: DraftCategory;
  content?: unknown;
  error?: string;
  /**
   * 上游回報這一類的草稿是否真的吃到 facilities 實測事實。false = 模型憑空編的,
   * 不當事實寫進 survey(見 applyDraft)。
   */
  usedFacts?: boolean;
}

// ---------------------------------------------------------------------------
// 表3 欄位目錄(canonical) — 對齊 frontend/src/mock/surveyFixtures.ts
// ---------------------------------------------------------------------------

interface FieldDef {
  key: string;
  label: string;
  group: string;
  options?: string[];
}

/** 表3 全欄位目錄(順序即前端顯示順序)。value 一律空,狀態 empty,交由 enrichment 覆寫。 */
const FIELD_CATALOG: FieldDef[] = [
  // 土地使用管制
  { key: "urban_plan", label: "都市計畫(內外)", group: "土地使用管制", options: ["都市計畫內", "都市計畫外"] },
  {
    key: "zone_type",
    label: "使用分區(使用地類別)",
    group: "土地使用管制",
    options: [
      "第一種住宅區", "第二種住宅區", "第三種住宅區", "第一種商業區", "第二種商業區",
      "第一種工業區", "第二種工業區", "工業區", "農業區", "保護區", "特定專用區", "其他",
    ],
  },
  { key: "coverage_ratio", label: "建蔽率", group: "土地使用管制" },
  { key: "plot_ratio", label: "容積率", group: "土地使用管制" },
  { key: "no_build_ban", label: "有無禁止建築", group: "土地使用管制" },
  { key: "build_restriction", label: "有無限制建築（整體開發、面積限制、高度限制）", group: "土地使用管制" },

  // 交通運輸
  { key: "main_road", label: "主要道路", group: "交通運輸" },
  { key: "road_avg_width", label: "區段內道路平均寬度", group: "交通運輸" },
  { key: "road_development", label: "區段內道路規劃及闢建程度", group: "交通運輸" },
  { key: "hsr_station", label: "大型車站－高鐵站", group: "交通運輸" },
  { key: "train_station", label: "大型車站－火車站", group: "交通運輸" },
  { key: "mrt_station", label: "大型車站－捷運站", group: "交通運輸" },
  { key: "bus_terminal", label: "大型車站－客運站", group: "交通運輸" },
  { key: "bus_stop", label: "站牌", group: "交通運輸" },
  { key: "interchange", label: "交流道距離", group: "交通運輸" },
  { key: "approach_settlement", label: "接近聚落程度", group: "交通運輸" },
  { key: "approach_distribution_center", label: "接近運銷中心程度", group: "交通運輸" },
  { key: "approach_market", label: "接近消費市場程度", group: "交通運輸" },

  // 自然條件
  { key: "drainage", label: "保（排）水之良否", group: "自然條件" },
  { key: "terrain", label: "地勢", group: "自然條件" },
  { key: "sunlight", label: "日照", group: "自然條件" },
  { key: "view", label: "景觀", group: "自然條件" },
  { key: "slope", label: "傾斜度", group: "自然條件" },
  { key: "wind", label: "風勢", group: "自然條件" },
  { key: "soil", label: "土質", group: "自然條件" },

  // 土地改良
  {
    key: "site_improvement",
    label: "建築基地改良",
    group: "土地改良",
    options: ["整平或填挖基地", "開挖水溝", "水土保持", "鋪築道路", "埋設管道", "修築駁嵌", "其他"],
  },
  {
    key: "farmland_improvement",
    label: "農地改良",
    group: "土地改良",
    options: ["耕地整理", "水土保持", "土壤改良", "修築農路", "灌溉", "排水", "防風", "防砂", "堤防", "其他"],
  },

  // 公共建設
  { key: "school", label: "接近學校之程度（國小/國中/高中/大專院校）", group: "公共建設" },
  { key: "market", label: "市場", group: "公共建設" },
  { key: "park", label: "公園廣場徒步區", group: "公共建設" },
  { key: "tourism_facility", label: "觀光遊憩設施", group: "公共建設" },
  { key: "parking", label: "停車場地", group: "公共建設" },
  { key: "service_facility", label: "接近服務性設施的程度", group: "公共建設" },
  { key: "power_resource", label: "電力資源", group: "公共建設" },
  { key: "industrial_water", label: "產業用水及設施", group: "公共建設" },
  { key: "sewage_facility", label: "污廢水及廢棄物處理設施", group: "公共建設" },

  // 特殊設施 —— 只有電業氣體燃料 / 殯葬 / 廢棄物處理三個欄框。百貨公司/金融機構/娛樂設施/
  // 大型展示中心或觀光飯店在官方表單上屬「工商活動」欄框(見下),不要放回這裡。
  { key: "cemetery", label: "殯葬－墓地", group: "特殊設施" },
  { key: "columbarium", label: "殯葬－納骨塔", group: "特殊設施" },
  { key: "crematorium", label: "殯葬－火葬場", group: "特殊設施" },
  { key: "funeral_home", label: "接近聚落程度－殯儀館", group: "特殊設施" },
  { key: "substation", label: "電業－變電所或高壓鐵塔", group: "特殊設施" },
  { key: "gas_tank", label: "氣體燃料－瓦斯槽或儲油槽", group: "特殊設施" },
  { key: "sewage_plant", label: "廢棄物處理－污水處理場", group: "特殊設施" },
  { key: "landfill", label: "廢棄物處理－垃圾場或掩埋場", group: "特殊設施" },
  { key: "incinerator", label: "廢棄物處理－焚化爐", group: "特殊設施" },

  // 環境污染
  { key: "water_pollution", label: "水污染", group: "環境污染" },
  { key: "noise_pollution", label: "噪音污染", group: "環境污染" },
  { key: "air_pollution", label: "廢氣污染", group: "環境污染" },
  { key: "waste_pollution", label: "廢棄物污染", group: "環境污染" },
  { key: "other_pollution", label: "其他污染", group: "環境污染" },

  // 工商活動 —— 表單右下角這一欄框含前 4 項商業設施,draft 側也是同一類
  // (draftFieldMap 的 commercialActivity)。
  { key: "department_store", label: "百貨公司", group: "工商活動" },
  { key: "financial_institution", label: "金融機構", group: "工商活動" },
  { key: "entertainment", label: "娛樂設施", group: "工商活動" },
  { key: "exhibition_hotel", label: "大型展示中心或觀光飯店", group: "工商活動" },
  { key: "customer_flow", label: "顧客之通行量", group: "工商活動" },
  { key: "shop_adjacency", label: "店鋪之毗連狀態", group: "工商活動" },

  // 其他影響因素 —— 表單在工商活動欄框下方留的一整列空白,自成一個 group。
  // 8 類 draft 都沒有對應(DRAFT_FIELD_MAP 無此 key),所以恆為 empty,由估價師填。
  { key: "other_factors", label: "其他影響因素", group: "其他影響因素" },

  // 房屋建築現況
  { key: "building_density", label: "建築密度", group: "房屋建築現況" },
  { key: "building_type", label: "建築型態", group: "房屋建築現況" },

  // 土地利用現況
  {
    key: "land_use_status",
    label: "土地利用現況",
    group: "土地利用現況",
    options: ["商業用", "住宅用", "工業用", "住商混合", "住工混合", "農作用", "漁牧用", "空地", "公共設施", "其他"],
  },
];

const NEED_MANUAL_ORIGIN = "AI 查無資料，需人工現場確認";

/** 建一個「空、需人工」的欄位(所有欄位的預設狀態)。 */
function emptyField(def: FieldDef): SurveyField {
  return {
    key: def.key,
    label: def.label,
    group: def.group,
    value: "",
    source: "empty",
    origin: NEED_MANUAL_ORIGIN,
    options: def.options,
  };
}

// ---------------------------------------------------------------------------
// facilities → SurveyField 覆寫(對齊 frontend api/index.ts 的 SURVEY_FACILITY_KIND)
// ---------------------------------------------------------------------------

/** 表3 欄位 key → facilities 的中文 kind 標籤。查得到就以查詢結果覆寫該欄位。 */
const SURVEY_FACILITY_KIND: Record<string, string> = {
  school: "文教設施",
  park: "公園",
  parking: "停車場",
  financial_institution: "金融機構",
  cemetery: "殯葬設施",
  bus_stop: "公車站",
};

/** 這一筆設施所屬類別實際套用的半徑;沒被覆寫就是基準半徑。 */
function radiusOfKind(
  data: NearbyFacilitiesResponse,
  item: FacilityItem,
): number | undefined {
  return data.area.categoryRadii?.[item.category ?? item.kind] ?? data.area.radiusMeters;
}

/** 同一 kind 半徑內全部設施,依距離由近到遠。 */
function allOfKind(data: NearbyFacilitiesResponse, kind: string): FacilityItem[] {
  return data.facilities
    .filter((f) => f.kind === kind)
    .slice()
    .sort((a, b) => a.metersToCenter - b.metersToCenter);
}

/**
 * 這次查詢的「區段中心」與「地點(比準地)」是不是兩個不同的點。
 *
 * 只有兩點確實不同時,兩個距離才是兩筆不同的事實,value/佐證才值得同時寫;前端沒帶區段
 * 多邊形(查詢中心 = 比準地)時兩者恆等,多寫一次只是噪音 —— 所以這裡比的是座標本身,而
 * 不是「有沒有帶 point」。
 */
function hasDistinctPoint(data: NearbyFacilitiesResponse): boolean {
  const { point, center } = data.area;
  if (!point) return false;
  return point.lon !== center.lon || point.lat !== center.lat;
}

/** items[] 的一筆(= SurveyField.items 的元素)。 */
type SurveyItem = NonNullable<SurveyField["items"]>[number];

/**
 * 一筆設施的顯示字串。
 *
 * 格式刻意是**純附加**的:基準形「名稱，距NNNM」(= 距區段中心)原封不動,第二個距離掛在
 * 後面的括號裡。既有那幾個「抓第一個 距NNNM」的解析點(表1 PDF mapper、前端連動、表5 級距
 * 查表)因此行為完全不變,只有需要第二個距離的人才去讀括號。
 */
function facilityText(it: SurveyItem): string {
  const base = `${it.name}，距${it.metersToCenter}M`;
  return it.metersToPoint != null ? `${base}（距比準地${it.metersToPoint}M）` : base;
}

/** 「最近」的描述文字:兩點不同時兩個距離都報,否則照舊只報一個。 */
function nearestText(it: SurveyItem): string {
  return it.metersToPoint != null
    ? `距區段中心${it.metersToCenter}m、距比準地${it.metersToPoint}m`
    : `${it.metersToCenter}m`;
}

/**
 * 用 facilities 覆寫對應欄位:查得到 → source "ai" + items + value「名稱，距NNNM」(；串多筆)+ reference;
 * 查無 → 維持 empty、標「需人工現場確認」(不沿用假資料)。
 *
 * items 每一筆帶兩個距離:metersToCenter(到區段中心,區域因素/表5 用)與 metersToPoint
 * (到本案地點,個別因素/表4 用)。後者只在「區段中心 ≠ 地點」時才寫 —— 兩點相同時它不是
 * 第二筆事實,只是同一個數字抄兩次。
 */
function applyFacilities(field: SurveyField, data: NearbyFacilitiesResponse): SurveyField {
  const kind = SURVEY_FACILITY_KIND[field.key];
  if (!kind) return field;

  const matches = allOfKind(data, kind);
  if (matches.length === 0) {
    return {
      ...field,
      value: "",
      source: "empty",
      origin: "AI 查無周邊設施資料，需人工現場確認",
      warning: undefined,
      reference: undefined,
      items: undefined,
    };
  }

  const withPoint = hasDistinctPoint(data);
  const items: SurveyItem[] = matches.map((f) => ({
    name: f.name ?? f.kind,
    metersToCenter: f.metersToCenter,
    ...(withPoint && f.metersToPoint != null ? { metersToPoint: f.metersToPoint } : {}),
  }));
  const value = items.map(facilityText).join("；");
  // items 依「距區段中心」排序,所以 nearest 是離區段中心最近的那筆 —— 這份欄位描述的是
  // 區段。離比準地最近的那筆由 deriveBenchmark 自己挑(見 nearestToPoint)。
  const nearest = items[0]!;
  // 佐證文字要寫「這一類實際查了多遠」,不是基準半徑 —— 嫌惡設施查 3000m 卻寫「半徑600m內」
  // 是會進交付文件的不實敘述。車站類沒有 category,用中文 kind 當鍵。
  const radius = radiusOfKind(data, matches[0]!);
  return {
    ...field,
    value,
    items,
    source: "ai",
    origin: `AI 查詢｜周邊設施查詢 API｜共${items.length}筆，最近${nearestText(nearest)}`,
    warning: undefined,
    reference: {
      dataSource: `AI 查詢｜周邊設施查詢 API${radius != null ? `｜半徑${radius}m` : ""}`,
      measurement: withPoint ? "直線距離（距區段中心／距比準地）" : "直線距離",
      derivation: `AI 於${radius != null ? `半徑${radius}m內` : ""}查得${kind}共${items.length}筆，最近：${nearest.name} ${nearestText(nearest)}`,
      rawFact: value,
    },
  };
}

// ---------------------------------------------------------------------------
// district-survey-draft content → SurveyField 覆寫
// ---------------------------------------------------------------------------
//
// 取值改走 draftFieldMap 的明確對照表(survey key → content 路徑),不再遞迴猜名字。
// 另外只採信「有吃到實測事實」的草稿:district-survey-draft 回的 usedFacts 為 false 時,
// 該類內容是模型憑空編的,不寫進 value,只在欄位掛 warning 讓估價師知道要自己填。

const UNGROUNDED_ORIGIN = "AI 草稿未依實測事實，需人工現場確認";

/**
 * 用該欄位所屬類別的 draft outcome 覆寫欄位:
 *   - outcome 失敗 → 標 warning「需人工確認」(不覆寫 value)。
 *   - usedFacts 非 true → 草稿沒有事實依據,維持原值 + 標 warning(不當事實寫入)。
 *   - 對照表取得到值 → source "ai" + value + reference(標來源與 content 路徑)。
 *   - 取不到 → 不動(維持 facilities 或 empty)。
 * 只在欄位還沒被 facilities 填成 "ai" 時才吃 draft,避免覆蓋更精確的實測距離。
 */
function applyDraft(field: SurveyField, byCategory: Map<DraftCategory, DraftOutcome>): SurveyField {
  const spec = DRAFT_FIELD_MAP[field.key];
  if (!spec) return field;
  const outcome = byCategory.get(spec.category);
  if (!outcome) return field;
  const label = DRAFT_CATEGORY_LABEL[spec.category];

  // 已由 facilities 填成 ai 的欄位(精確實測),不被 draft 覆蓋。
  if (field.source === "ai" && field.items && field.items.length > 0) return field;

  if (outcome.error) {
    return {
      ...field,
      warning: `AI 產草稿失敗（${label}）：需人工確認`,
      origin: field.source === "empty" ? "AI 產草稿失敗，需人工現場確認" : field.origin,
    };
  }

  // 草稿沒吃到周邊設施事實(該類查無設施,或 facilities 整支失敗)→ 內容是模型編的,不採信。
  if (outcome.usedFacts !== true) {
    return {
      ...field,
      warning: `AI 草稿未依實測事實（${label}）：需人工確認`,
      origin: field.source === "empty" ? UNGROUNDED_ORIGIN : field.origin,
    };
  }

  const value = resolveDraftValue(outcome.content, spec);
  if (value == null) return field;

  const reference: FieldReference = {
    dataSource: "AI 查詢｜地價區段草稿產製（district-survey-draft）",
    derivation: `AI 產「${label}」類草稿（依周邊設施實測事實），對應欄位「${field.label}」← ${draftFieldPath(spec)}`,
    rawFact: value,
  };
  return {
    ...field,
    value,
    source: "ai",
    origin: `AI 產草稿｜${label}`,
    warning: undefined,
    reference,
  };
}

// ---------------------------------------------------------------------------
// benchmark 推導(對齊 frontend/src/lib/formLinkage.ts 的 SURVEY_LINKAGE / applySurveyLinkage)
// ---------------------------------------------------------------------------

type FacilityField = "school" | "market" | "park" | "station" | "disamenity";
type SingleField = "roadWidth" | "terrain" | "zoning" | "coverageRatio" | "plotRatio" | "buildRestriction";

interface LinkageSpec {
  comparisonField?: FacilityField | SingleField;
}

/** 表3 欄位 key → 表4 benchmark(ComparisonCondition)欄位。只列有對應的。 */
const SURVEY_LINKAGE: Record<string, LinkageSpec> = {
  school: { comparisonField: "school" },
  market: { comparisonField: "market" },
  park: { comparisonField: "park" },
  bus_stop: { comparisonField: "station" },
  cemetery: { comparisonField: "disamenity" },
  road_avg_width: { comparisonField: "roadWidth" },
  terrain: { comparisonField: "terrain" },
  zone_type: { comparisonField: "zoning" },
  coverage_ratio: { comparisonField: "coverageRatio" },
  plot_ratio: { comparisonField: "plotRatio" },
  build_restriction: { comparisonField: "buildRestriction" },
};

const FACILITY_FIELD_KEYS: Record<FacilityField, { name: keyof ComparisonCondition; distance: keyof ComparisonCondition }> = {
  school: { name: "schoolName", distance: "schoolDistance" },
  market: { name: "marketName", distance: "marketDistance" },
  park: { name: "parkName", distance: "parkDistance" },
  station: { name: "stationName", distance: "stationDistance" },
  disamenity: { name: "disamenityName", distance: "disamenityDistance" },
};

function isFacilityField(f: FacilityField | SingleField): f is FacilityField {
  return f in FACILITY_FIELD_KEYS;
}

const FACILITY_VALUE_RE = /^(.+?)[，,]\s*距\s*([\d.]+)\s*M/i;
/** value 字串裡附掛的第二個距離「（距比準地NNNM）」。 */
const FACILITY_POINT_RE = /（\s*距比準地\s*([\d.]+)\s*M\s*）/i;

/** 這筆設施到比準地的距離;沒有第二個距離就退回區段中心距離(兩者本來就相同)。 */
function metersForBenchmark(it: SurveyItem): number {
  return it.metersToPoint ?? it.metersToCenter;
}

/**
 * 從欄位取「名稱 + 距離」給 benchmark(表4 個別因素)用。
 *
 * 距離一律取**到比準地**的那個:表4 評的是這一筆宗地自己,不是區段。連帶地,多筆設施要挑
 * 的是「離比準地最近」的那一筆,而不是 items[0](那是離區段中心最近的,供表5 用)—— 區段中心
 * 旁邊的學校未必是宗地旁邊的學校。沒帶地點座標時兩個距離相同,挑法退化成 items[0],行為
 * 與改動前一致。
 *
 * 沒有 items(估價師手改過的純文字)才退回解析 value 慣例格式,並優先採括號裡的比準地距離。
 */
function parseFacilityValue(field: SurveyField): { name: string; distance: string } | null {
  const items = field.items;
  if (items && items.length > 0) {
    const pick = items.reduce((best, it) =>
      metersForBenchmark(it) < metersForBenchmark(best) ? it : best,
    );
    return { name: pick.name, distance: String(metersForBenchmark(pick)) };
  }
  const first = field.value.split(/[；;]/)[0]?.trim();
  if (!first) return null;
  const m = first.match(FACILITY_VALUE_RE);
  if (!m) return null;
  return { name: m[1].trim(), distance: first.match(FACILITY_POINT_RE)?.[1] ?? m[2] };
}

/** 依單一欄位算出要 patch 到 benchmark 的欄位;無值回 null。 */
function deriveBenchmarkPatch(field: SurveyField, comparisonField: FacilityField | SingleField): Partial<ComparisonCondition> | null {
  if (isFacilityField(comparisonField)) {
    const parsed = parseFacilityValue(field);
    if (!parsed) return null;
    const { name, distance } = FACILITY_FIELD_KEYS[comparisonField];
    return { [name]: parsed.name, [distance]: parsed.distance } as Partial<ComparisonCondition>;
  }
  if (!field.value) return null;
  return { [comparisonField]: field.value } as Partial<ComparisonCondition>;
}

/** 走訪所有有 linkage 的欄位,把 survey 事實同步進 benchmark。 */
function deriveBenchmark(survey: SurveyField[], base: ComparisonCondition): ComparisonCondition {
  let benchmark = { ...base };
  for (const [surveyKey, spec] of Object.entries(SURVEY_LINKAGE)) {
    if (!spec.comparisonField) continue;
    const field = survey.find((f) => f.key === surveyKey);
    if (!field) continue;
    const patch = deriveBenchmarkPatch(field, spec.comparisonField);
    if (patch) benchmark = { ...benchmark, ...patch };
  }
  return benchmark;
}

/** benchmark 的中性初值(所有欄位空字串);sectionId/location 由呼叫端填。 */
function emptyBenchmark(sectionId: string): ComparisonCondition {
  return {
    location: "", area: "", width: "", depth: "", shape: "", frontage: "", terrain: "",
    roadType: "", roadName: "", roadWidth: "", schoolName: "", schoolDistance: "",
    marketName: "", marketDistance: "", parkName: "", parkDistance: "", stationName: "",
    stationDistance: "", districtName: "", districtDistance: "", disamenityName: "",
    disamenityDistance: "", parking: "", zoning: "", coverageRatio: "", plotRatio: "",
    buildRestriction: "", sectionId,
  };
}

// ---------------------------------------------------------------------------
// 對外組裝入口
// ---------------------------------------------------------------------------

export interface CaseMetaLike {
  yearPeriod: string;
  sectionId: string;
  district: string;
  landUseType: string;
  benchmarkParcel: string;
  surveyDate: string;
  range?: string;
  location?: LatLng;
  /** 區段範圍多邊形 —— metersToCenter 的基準點(其幾何重心)從哪來。見 shared/db CaseMeta。 */
  sectionPolygon?: LatLng[];
}

export interface AssembleInput {
  sectionId: string;
  benchmarkLocation?: LatLng;
  /** 請求帶的區段經緯度陣列;原樣寫進 meta,讓兩個距離事後可追溯。 */
  sectionPolygon?: LatLng[];
  facilities: NearbyFacilitiesResponse | null; // null = facilities 上游失敗/未查(座標缺)
  drafts: DraftOutcome[];
}

export interface AssembleOutput {
  meta: CaseMetaLike;
  survey: SurveyField[];
  benchmark: ComparisonCondition;
}

/** 民國年月日(如 1140901 對應的今日民國年)—— surveyDate 用「NNN年NN月NN日」格式當預設。 */
function rocSurveyDate(now = new Date()): string {
  const rocYear = now.getFullYear() - 1911;
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${rocYear}年${mm}月${dd}日`;
}

/**
 * 把 facilities + 8 類 draft 組成 ProduceSurveyResponse 的三塊(meta/survey/benchmark)。
 * meta 能推的先推(sectionId/surveyDate/location),推不出的(district/landUseType/…)留空,交前端補。
 */
export function assembleSurveyResponse(input: AssembleInput): AssembleOutput {
  const draftByCategory = new Map<DraftCategory, DraftOutcome>();
  for (const d of input.drafts) draftByCategory.set(d.category, d);

  const survey = FIELD_CATALOG.map((def) => {
    let field = emptyField(def);
    if (input.facilities) field = applyFacilities(field, input.facilities);
    field = applyDraft(field, draftByCategory);
    return field;
  });

  const benchmark = deriveBenchmark(survey, emptyBenchmark(input.sectionId));

  // location 優先用請求帶的比準地座標;沒有就退而用 facilities 查詢中心(polygon 則為 centroid)。
  const location: LatLng | undefined =
    input.benchmarkLocation ??
    (input.facilities
      ? { lat: input.facilities.area.center.lat, lng: input.facilities.area.center.lon }
      : undefined);

  const meta: CaseMetaLike = {
    yearPeriod: "",
    sectionId: input.sectionId,
    district: "",
    landUseType: "",
    benchmarkParcel: "",
    surveyDate: rocSurveyDate(),
    location,
    // 區段多邊形原樣留著:survey 裡每個 metersToCenter 都是量到它的重心,存表1 時一起進
    // case_survey.meta,日後要重算或核對距離才有依據。
    ...(input.sectionPolygon && input.sectionPolygon.length > 0
      ? { sectionPolygon: input.sectionPolygon }
      : {}),
  };

  return { meta, survey, benchmark };
}
