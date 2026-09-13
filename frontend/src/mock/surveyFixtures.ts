import type { ProduceSurveyResponse } from "../api/types";
import type { ComparisonCondition, SurveyField } from "../types";

const SURVEY_DATE = "114年09月18日";

// 表1所有欄位一律留空、狀態為需人工：本產品是「AI 主動查找資料」，不是承接已完成的
// 紙本現場勘查紀錄，查得到的欄位由 api/index.ts 依 AI 查詢結果動態覆寫（見
// SURVEY_FACILITY_KIND），查不到就維持這裡的空值，交由估價師現場確認，不能用假資料撐場面
function empty(
  key: string,
  label: string,
  group: string,
  options?: string[],
  multi?: boolean,
): SurveyField {
  return {
    key,
    label,
    group,
    value: "",
    source: "empty",
    origin: "AI 查無資料，需人工現場確認",
    options,
    multi,
  };
}

const survey: SurveyField[] = [
  // ── 土地使用管制 ──────────────────────────────────────────
  empty("urban_plan", "都市計畫(內外)", "土地使用管制", [
    "都市計畫內",
    "都市計畫外",
  ]),
  empty("zone_type", "使用分區(使用地類別)", "土地使用管制", [
    "第一種住宅區",
    "第二種住宅區",
    "第三種住宅區",
    "第一種商業區",
    "第二種商業區",
    "第一種工業區",
    "第二種工業區",
    "工業區",
    "農業區",
    "保護區",
    "特定專用區",
    "其他",
  ]),
  empty("coverage_ratio", "建蔽率", "土地使用管制"),
  empty("plot_ratio", "容積率", "土地使用管制"),
  empty("no_build_ban", "有無禁止建築", "土地使用管制"),
  empty(
    "build_restriction",
    "有無限制建築（整體開發、面積限制、高度限制）",
    "土地使用管制",
  ),

  // ── 交通運輸 ──────────────────────────────────────────────
  empty("main_road", "主要道路", "交通運輸"),
  empty("road_avg_width", "區段內道路平均寬度", "交通運輸"),
  empty("road_development", "區段內道路規劃及闢建程度", "交通運輸"),
  empty("hsr_station", "大型車站－高鐵站", "交通運輸"),
  empty("train_station", "大型車站－火車站", "交通運輸"),
  empty("mrt_station", "大型車站－捷運站", "交通運輸"),
  empty("bus_terminal", "大型車站－客運站", "交通運輸"),
  empty("bus_stop", "站牌", "交通運輸"),
  empty("interchange", "交流道距離", "交通運輸"),
  empty("approach_settlement", "接近聚落程度", "交通運輸"),
  empty("approach_distribution_center", "接近運銷中心程度", "交通運輸"),
  empty("approach_market", "接近消費市場程度", "交通運輸"),

  // ── 自然條件 ──────────────────────────────────────────────
  empty("drainage", "保（排）水之良否", "自然條件"),
  empty("terrain", "地勢", "自然條件"),
  empty("sunlight", "日照", "自然條件"),
  empty("view", "景觀", "自然條件"),
  empty("slope", "傾斜度", "自然條件"),
  empty("wind", "風勢", "自然條件"),
  empty("soil", "土質", "自然條件"),

  // ── 土地改良 ──────────────────────────────────────────────
  empty(
    "site_improvement",
    "建築基地改良",
    "土地改良",
    ["整平或填挖基地", "開挖水溝", "水土保持", "鋪築道路", "埋設管道", "修築駁嵌", "其他"],
    true,
  ),
  empty(
    "farmland_improvement",
    "農地改良",
    "土地改良",
    ["耕地整理", "水土保持", "土壤改良", "修築農路", "灌溉", "排水", "防風", "防砂", "堤防", "其他"],
    true,
  ),

  // ── 公共建設 ──────────────────────────────────────────────
  empty("school", "接近學校之程度（國小/國中/高中/大專院校）", "公共建設"),
  empty("market", "市場", "公共建設"),
  empty("park", "公園廣場徒步區", "公共建設"),
  empty("tourism_facility", "觀光遊憩設施", "公共建設"),
  empty("parking", "停車場地", "公共建設"),
  empty("service_facility", "接近服務性設施的程度", "公共建設"),
  empty("power_resource", "電力資源", "公共建設"),
  empty("industrial_water", "產業用水及設施", "公共建設"),
  empty("sewage_facility", "污廢水及廢棄物處理設施", "公共建設"),

  // ── 特殊設施 ──────────────────────────────────────────────
  empty("cemetery", "殯葬－墓地", "特殊設施"),
  empty("columbarium", "殯葬－納骨塔", "特殊設施"),
  empty("crematorium", "殯葬－火葬場", "特殊設施"),
  empty("funeral_home", "接近聚落程度－殯儀館", "特殊設施"),
  empty("substation", "電業－變電所或高壓鐵塔", "特殊設施"),
  empty("gas_tank", "氣體燃料－瓦斯槽或儲油槽", "特殊設施"),
  empty("sewage_plant", "廢棄物處理－污水處理場", "特殊設施"),
  empty("landfill", "廢棄物處理－垃圾場或掩埋場", "特殊設施"),
  empty("incinerator", "廢棄物處理－焚化爐", "特殊設施"),

  // ── 環境污染 ──────────────────────────────────────────────
  empty("water_pollution", "水污染", "環境污染"),
  empty("noise_pollution", "噪音污染", "環境污染"),
  empty("air_pollution", "廢氣污染", "環境污染"),
  empty("waste_pollution", "廢棄物污染", "環境污染"),
  empty("other_pollution", "其他污染", "環境污染"),

  // ── 工商活動 ──────────────────────────────────────────────
  empty("department_store", "百貨公司", "工商活動"),
  empty("financial_institution", "金融機構", "工商活動"),
  empty("entertainment", "娛樂設施", "工商活動"),
  empty("exhibition_hotel", "大型展示中心或觀光飯店", "工商活動"),
  empty("customer_flow", "顧客之通行量", "工商活動"),
  empty("shop_adjacency", "店鋪之毗連狀態", "工商活動"),

  // ── 其他影響因素 ──────────────────────────────────────────
  empty("other_factors", "其他影響因素", "其他影響因素"),

  // ── 房屋建築現況 ──────────────────────────────────────────
  empty("building_density", "建築密度", "房屋建築現況"),
  empty("building_type", "建築型態", "房屋建築現況"),

  // ── 土地利用現況 ──────────────────────────────────────────
  empty("land_use_status", "土地利用現況", "土地利用現況", [
    "商業用",
    "住宅用",
    "工業用",
    "住商混合",
    "住工混合",
    "農作用",
    "漁牧用",
    "空地",
    "公共設施",
    "其他",
  ]),
];

// 表4比準地宗地條件基準值（①即時查詢/使用者編輯前的原始版本）。
export const BENCHMARK_CONDITION_BASELINE: ComparisonCondition = {
  location: "",
  area: "113.21",
  width: "5",
  depth: "23",
  shape: "方形",
  frontage: "單面臨街",
  terrain: "平坦",
  roadType: "主要道路",
  roadName: "中山路",
  roadWidth: "18",
  schoolName: "",
  schoolDistance: "",
  marketName: "",
  marketDistance: "",
  parkName: "",
  parkDistance: "",
  stationName: "",
  stationDistance: "",
  districtName: "",
  districtDistance: "",
  disamenityName: "",
  disamenityDistance: "",
  parking: "可路邊停車",
  zoning: "第二種商業區",
  coverageRatio: "70%",
  plotRatio: "240%",
  buildRestriction: "無",
  sectionId: "P002-00",
};

// POST /api/produce/survey 的 response mock：key 為 sectionId
export const mockSurveyFixtures: Record<string, ProduceSurveyResponse> = {
  "P002-00": {
    meta: {
      // sectionId/district/benchmarkParcel/yearPeriod 為新北市樹林區真實案例（比對紙本表4
      // 截圖：比準地宗地流水號0003、地價區段P001-00、估價基準日111年9月1日）；
      // range/surveyDate/location 截圖未涵蓋，暫沿用既有佔位值，待主辦資料補齊後再更新，不臆測填入。
      sectionId: "P001-00",
      range:
        "北側至金包里街以北臨路第一筆宗地，南側至中山路以南第一筆宗地，西側至中正路，東側至福德街之第二種商業區土地劃為P002-00區段。",
      district: "新北市樹林區",
      landUseType: "商業用地",
      benchmarkParcel: "樹德段1415地號",
      yearPeriod: "1110901",
      surveyDate: SURVEY_DATE,
      location: { lat: 25.2219, lng: 121.63575 }, // 金山老街一帶概略座標，供圖台示意定位
    },
    survey,
    benchmark: BENCHMARK_CONDITION_BASELINE,
  },
};
