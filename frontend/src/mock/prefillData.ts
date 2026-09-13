/**
 * 各位置的預填數據（根據附圖表單預填值）
 * 調用 POST /api/produce/survey 時，會使用這些預填值與 API 回覆 merge
 * merge 策略：以預填值為主（覆蓋 API 返回值）
 */

import type { SurveyField, ComparisonCondition } from "../types";

type LocationRole = "benchmark" | "comparison1" | "comparison2" | "comparison3";

/**
 * 為指定欄位創建預填 SurveyField
 * source="prefilled" 表示此欄位是預填值
 */
function prefilled(
  key: string,
  label: string,
  group: string,
  value: string,
  options?: string[],
  multi?: boolean,
): SurveyField {
  return {
    key,
    label,
    group,
    value,
    source: "prefilled",
    origin: "預填值（根據表單設定）",
    options,
    multi,
  };
}

/**
 * 為指定欄位創建空值（維持空白狀態）
 */
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

/**
 * 建築基地改良選項
 */
const SITE_IMPROVEMENT_OPTIONS = [
  "整平或填挖基地",
  "開挖水溝",
  "水土保持",
  "鋪築道路",
  "埋設管道",
  "修築駁嵌",
  "其他",
];

/**
 * 農地改良選項
 */
const FARMLAND_IMPROVEMENT_OPTIONS = [
  "耕地整理",
  "水土保持",
  "土壤改良",
  "修築農路",
  "灌溉",
  "排水",
  "防風",
  "防砂",
  "堤防",
  "其他",
];

/**
 * 比準地預填數據（根據附圖表單）
 */
export const BENCHMARK_PREFILL: Record<string, SurveyField> = {
  year_period: prefilled("year_period", "年期", "基本資訊", "1140901"),
  section_id: prefilled("section_id", "區段編號", "基本資訊", "P001-00"),
  section_range: empty("section_range", "區段範圍", "基本資訊"),
  urban_plan: prefilled(
    "urban_plan",
    "都市計畫(內外)",
    "土地使用管制",
    "都市計畫內",
    ["都市計畫內", "都市計畫外"],
  ),
  zone_type: prefilled(
    "zone_type",
    "使用分區(使用地類別)",
    "土地使用管制",
    "第一種住宅區",
    [
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
    ],
  ),
  coverage_ratio: prefilled("coverage_ratio", "建蔽率", "土地使用管制", "50%"),
  plot_ratio: prefilled("plot_ratio", "容積率", "土地使用管制", "200%"),
  no_build_ban: prefilled("no_build_ban", "有無禁止建築", "土地使用管制", "無"),
  build_restriction: prefilled(
    "build_restriction",
    "有無限制建築（整體開發、面積限制、高度限制）",
    "土地使用管制",
    "無",
  ),
  main_road: prefilled("main_road", "主要道路", "交通運輸", "八德街 28M"),
  road_avg_width: prefilled(
    "road_avg_width",
    "區段內道路平均寬度",
    "交通運輸",
    "12M",
  ),
  road_development: prefilled(
    "road_development",
    "區段內道路規劃及闢建程度",
    "交通運輸",
    "大部分規劃及闢建",
  ),
  hsr_station: prefilled("hsr_station", "大型車站－高鐵站", "交通運輸", "無"),
  train_station: prefilled(
    "train_station",
    "大型車站－火車站",
    "交通運輸",
    "無",
  ),
  mrt_station: prefilled("mrt_station", "大型車站－捷運站", "交通運輸", "無"),
  bus_terminal: empty("bus_terminal", "大型車站－客運站", "交通運輸"),
  bus_stop: empty("bus_stop", "站牌", "交通運輸"),
  interchange: prefilled("interchange", "交流道距離", "交通運輸", "無"),
  approach_settlement: empty("approach_settlement", "接近聚落程度", "交通運輸"),
  approach_distribution_center: empty(
    "approach_distribution_center",
    "接近運銷中心程度",
    "交通運輸",
  ),
  approach_market: empty("approach_market", "接近消費市場程度", "交通運輸"),
  drainage: prefilled("drainage", "保（排）水之良否", "自然條件", "普通完善 "),
  terrain: prefilled("terrain", "地勢", "自然條件", "極平坦堅硬 "),
  sunlight: prefilled("sunlight", "日照", "自然條件", "充分"),
  view: prefilled("view", "景觀", "自然條件", "視野、景觀尚可 "),
  slope: prefilled("slope", "傾斜度", "自然條件", "平均坡度未滿5度"),
  wind: empty("wind", "風勢", "自然條件"),
  soil: empty("soil", "土質", "自然條件"),
  site_improvement: prefilled(
    "site_improvement",
    "建築基地改良",
    "土地改良",
    "整平或填挖基地、開挖水溝、鋪築道路、埋設管道",
    SITE_IMPROVEMENT_OPTIONS,
    true,
  ),
  farmland_improvement: empty(
    "farmland_improvement",
    "農地改良",
    "土地改良",
    FARMLAND_IMPROVEMENT_OPTIONS,
    true,
  ),
  school: empty(
    "school",
    "接近學校之程度（國小/國中/高中/大專院校）",
    "公共建設",
  ),
  market: empty("market", "市場", "公共建設"),
  park: empty("park", "公園廣場徒步區", "公共建設"),
  tourism_facility: empty("tourism_facility", "觀光遊憩設施", "公共建設"),
  parking: empty("parking", "停車場地", "公共建設"),
  service_facility: empty(
    "service_facility",
    "接近服務性設施的程度",
    "公共建設",
  ),
  power_resource: empty("power_resource", "電力資源", "公共建設"),
  industrial_water: empty("industrial_water", "產業用水及設施", "公共建設"),
  sewage_facility: prefilled(
    "sewage_facility",
    "污廢水及廢棄物處理設施",
    "公共建設",
    "無",
  ),
  cemetery: empty("cemetery", "殯葬－墓地", "特殊設施"),
  columbarium: prefilled("columbarium", "殯葬－納骨塔", "特殊設施", "無"),
  crematorium: prefilled("crematorium", "殯葬－火葬場", "特殊設施", "無"),
  funeral_home: prefilled("funeral_home", "殯葬－殯儀館", "特殊設施", "無"),
  substation: prefilled(
    "substation",
    "電業－變電所或高壓鐵塔",
    "特殊設施",
    "無",
  ),
  gas_tank: prefilled("gas_tank", "氣體燃料－瓦斯槽或儲油槽", "特殊設施", "無"),
  sewage_plant: prefilled(
    "sewage_plant",
    "廢棄物處理－污水處理場",
    "特殊設施",
    "無",
  ),
  landfill: prefilled(
    "landfill",
    "廢棄物處理－垃圾場或掩埋場",
    "特殊設施",
    "無",
  ),
  incinerator: prefilled("incinerator", "廢棄物處理－焚化爐", "特殊設施", "無"),
  water_pollution: prefilled("water_pollution", "水污染", "環境污染", "無"),
  noise_pollution: prefilled("noise_pollution", "噪音污染", "環境污染", "無"),
  air_pollution: prefilled("air_pollution", "廢氣污染", "環境污染", "無"),
  waste_pollution: prefilled("waste_pollution", "廢棄物污染", "環境污染", "無"),
  other_pollution: prefilled("other_pollution", "其他污染", "環境污染", "無"),
  department_store: prefilled("department_store", "百貨公司", "工商活動", "無"),
  financial_institution: empty("financial_institution", "金融機構", "工商活動"),
  entertainment: prefilled("entertainment", "娛樂設施", "工商活動", "無"),
  exhibition_hotel: prefilled(
    "exhibition_hotel",
    "大型展示中心或觀光飯店",
    "工商活動",
    "無",
  ),
  customer_flow: empty("customer_flow", "顧客之通行量", "工商活動"),
  shop_adjacency: empty("shop_adjacency", "店鋪之毗連狀態", "工商活動"),
  other_factors: empty("other_factors", "其他影響因素", "其他影響因素"),
  building_density: prefilled(
    "building_density",
    "建築密度",
    "房屋建築現況",
    "60%",
  ),
  building_type: prefilled(
    "building_type",
    "建築型態",
    "房屋建築現況",
    "透天厝、公寓",
  ),
  land_use_status: prefilled(
    "land_use_status",
    "土地利用現況",
    "土地利用現況",
    "商業用、住宅用",
    [
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
    ],
    true,
  ),
};

/**
 * 比較標的 1 預填數據
 */
export const COMPARISON1_PREFILL: Record<string, SurveyField> = {
  year_period: prefilled("year_period", "年期", "基本資訊", "1110901"),
  section_id: prefilled("section_id", "區段編號", "基本資訊", "P002-00"),
  section_range: prefilled(
    "section_range",
    "區段範圍",
    "基本資訊",
    "沿樹人街以北、長壽街21巷以西、啟智街14巷以南及樹德街136巷以東之第一種住宅區",
  ),
  urban_plan: prefilled(
    "urban_plan",
    "都市計畫(內外)",
    "土地使用管制",
    "都市計畫內",
    ["都市計畫內", "都市計畫外"],
  ),
  zone_type: prefilled(
    "zone_type",
    "使用分區(使用地類別)",
    "土地使用管制",
    "第一種住宅區",
    [
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
    ],
  ),
  coverage_ratio: prefilled("coverage_ratio", "建蔽率", "土地使用管制", "50%"),
  plot_ratio: prefilled("plot_ratio", "容積率", "土地使用管制", "200%"),
  no_build_ban: prefilled("no_build_ban", "有無禁止建築", "土地使用管制", "無"),
  build_restriction: prefilled(
    "build_restriction",
    "有無限制建築（整體開發、面積限制、高度限制）",
    "土地使用管制",
    "無",
  ),
  main_road: prefilled("main_road", "主要道路", "交通運輸", "樹人街 7M"),
  road_avg_width: prefilled(
    "road_avg_width",
    "區段內道路平均寬度",
    "交通運輸",
    "6M",
  ),
  road_development: prefilled(
    "road_development",
    "區段內道路規劃及闢建程度",
    "交通運輸",
    "部分規劃及闢建",
  ),
  hsr_station: prefilled("hsr_station", "大型車站－高鐵站", "交通運輸", "無"),
  train_station: prefilled(
    "train_station",
    "大型車站－火車站",
    "交通運輸",
    "無",
  ),
  mrt_station: prefilled("mrt_station", "大型車站－捷運站", "交通運輸", "無"),
  bus_terminal: empty("bus_terminal", "大型車站－客運站", "交通運輸"),
  bus_stop: empty("bus_stop", "站牌", "交通運輸"),
  interchange: prefilled("interchange", "交流道距離", "交通運輸", "無"),
  approach_settlement: empty("approach_settlement", "接近聚落程度", "交通運輸"),
  approach_distribution_center: empty(
    "approach_distribution_center",
    "接近運銷中心程度",
    "交通運輸",
  ),
  approach_market: empty("approach_market", "接近消費市場程度", "交通運輸"),
  drainage: prefilled("drainage", "保（排）水之良否", "自然條件", "普通完善"),
  terrain: prefilled("terrain", "地勢", "自然條件", "極平坦堅硬"),
  sunlight: prefilled("sunlight", "日照", "自然條件", "充分"),
  view: prefilled("view", "景觀", "自然條件", "視野、景觀尚可"),
  slope: prefilled("slope", "傾斜度", "自然條件", "平均提高4-5度"),
  wind: empty("wind", "風勢", "自然條件"),
  soil: empty("soil", "土質", "自然條件"),
  site_improvement: prefilled(
    "site_improvement",
    "建築基地改良",
    "土地改良",
    "整平或填挖基地、開挖水溝、鋪築道路、埋設管道",
    SITE_IMPROVEMENT_OPTIONS,
    true,
  ),
  farmland_improvement: empty(
    "farmland_improvement",
    "農地改良",
    "土地改良",
    FARMLAND_IMPROVEMENT_OPTIONS,
    true,
  ),
  school: empty(
    "school",
    "接近學校之程度（國小/國中/高中/大專院校）",
    "公共建設",
  ),
  market: empty("market", "市場", "公共建設"),
  park: empty("park", "公園廣場徒步區", "公共建設"),
  tourism_facility: empty("tourism_facility", "觀光遊憩設施", "公共建設"),
  parking: empty("parking", "停車場地", "公共建設"),
  service_facility: empty(
    "service_facility",
    "接近服務性設施的程度",
    "公共建設",
  ),
  power_resource: empty("power_resource", "電力資源", "公共建設"),
  industrial_water: empty("industrial_water", "產業用水及設施", "公共建設"),
  sewage_facility: prefilled(
    "sewage_facility",
    "污廢水及廢棄物處理設施",
    "公共建設",
    "無",
  ),
  cemetery: empty("cemetery", "殯葬－墓地", "特殊設施"),
  columbarium: prefilled("columbarium", "殯葬－納骨塔", "特殊設施", "無"),
  crematorium: prefilled("crematorium", "殯葬－火葬場", "特殊設施", "無"),
  funeral_home: prefilled("funeral_home", "殯葬－殯儀館", "特殊設施", "無"),
  substation: prefilled(
    "substation",
    "電業－變電所或高壓鐵塔",
    "特殊設施",
    "無",
  ),
  gas_tank: prefilled("gas_tank", "氣體燃料－瓦斯槽或儲油槽", "特殊設施", "無"),
  sewage_plant: prefilled(
    "sewage_plant",
    "廢棄物處理－污水處理場",
    "特殊設施",
    "無",
  ),
  landfill: prefilled(
    "landfill",
    "廢棄物處理－垃圾場或掩埋場",
    "特殊設施",
    "無",
  ),
  incinerator: prefilled("incinerator", "廢棄物處理－焚化爐", "特殊設施", "無"),
  water_pollution: prefilled("water_pollution", "水污染", "環境污染", "無"),
  noise_pollution: prefilled("noise_pollution", "噪音污染", "環境污染", "無"),
  air_pollution: prefilled("air_pollution", "廢氣污染", "環境污染", "無"),
  waste_pollution: prefilled("waste_pollution", "廢棄物污染", "環境污染", "無"),
  other_pollution: prefilled("other_pollution", "其他污染", "環境污染", "無"),
  department_store: prefilled("department_store", "百貨公司", "工商活動", "無"),
  financial_institution: empty("financial_institution", "金融機構", "工商活動"),
  entertainment: prefilled("entertainment", "娛樂設施", "工商活動", "無"),
  exhibition_hotel: prefilled(
    "exhibition_hotel",
    "大型展示中心或觀光飯店",
    "工商活動",
    "無",
  ),
  customer_flow: empty("customer_flow", "顧客之通行量", "工商活動"),
  shop_adjacency: empty("shop_adjacency", "店鋪之毗連狀態", "工商活動"),
  other_factors: empty("other_factors", "其他影響因素", "其他影響因素"),
  building_density: prefilled(
    "building_density",
    "建築密度",
    "房屋建築現況",
    "70%",
  ),
  building_type: prefilled(
    "building_type",
    "建築型態",
    "房屋建築現況",
    "公寓、透天",
  ),
  land_use_status: prefilled(
    "land_use_status",
    "土地利用現況",
    "土地利用現況",
    "住宅用",
    [
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
    ],
    true,
  ),
};

/**
 * 比較標的 2 預填數據
 */
export const COMPARISON2_PREFILL: Record<string, SurveyField> = {
  year_period: prefilled("year_period", "年期", "基本資訊", "1110901"),
  section_id: prefilled("section_id", "區段編號", "基本資訊", "P003-00"),
  section_range: prefilled(
    "section_range",
    "區段範圍",
    "基本資訊",
    "沿東榮街以北、鎮前街411巷1弄以南、東榮街88巷以東、鎮前街367巷以西之第一種住宅區",
  ),
  urban_plan: prefilled(
    "urban_plan",
    "都市計畫(內外)",
    "土地使用管制",
    "都市計畫內",
    ["都市計畫內", "都市計畫外"],
  ),
  zone_type: prefilled(
    "zone_type",
    "使用分區(使用地類別)",
    "土地使用管制",
    "第一種住宅區",
    [
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
    ],
  ),
  coverage_ratio: prefilled("coverage_ratio", "建蔽率", "土地使用管制", "50%"),
  plot_ratio: prefilled("plot_ratio", "容積率", "土地使用管制", "200%"),
  no_build_ban: prefilled("no_build_ban", "有無禁止建築", "土地使用管制", "無"),
  build_restriction: prefilled(
    "build_restriction",
    "有無限制建築（整體開發、面積限制、高度限制）",
    "土地使用管制",
    "無",
  ),
  main_road: prefilled("main_road", "主要道路", "交通運輸", "東榮街 10M"),
  road_avg_width: prefilled(
    "road_avg_width",
    "區段內道路平均寬度",
    "交通運輸",
    "7M",
  ),
  road_development: prefilled(
    "road_development",
    "區段內道路規劃及闢建程度",
    "交通運輸",
    "全部規劃及闢建",
  ),
  hsr_station: prefilled("hsr_station", "大型車站－高鐵站", "交通運輸", "無"),
  train_station: prefilled(
    "train_station",
    "大型車站－火車站",
    "交通運輸",
    "無",
  ),
  mrt_station: prefilled("mrt_station", "大型車站－捷運站", "交通運輸", "無"),
  bus_terminal: empty("bus_terminal", "大型車站－客運站", "交通運輸"),
  bus_stop: empty("bus_stop", "站牌", "交通運輸"),
  interchange: prefilled("interchange", "交流道距離", "交通運輸", "無"),
  approach_settlement: empty("approach_settlement", "接近聚落程度", "交通運輸"),
  approach_distribution_center: empty(
    "approach_distribution_center",
    "接近運銷中心程度",
    "交通運輸",
  ),
  approach_market: empty("approach_market", "接近消費市場程度", "交通運輸"),
  drainage: prefilled("drainage", "保（排）水之良否", "自然條件", "善通完善"),
  terrain: prefilled("terrain", "地勢", "自然條件", "極平坦堅硬"),
  sunlight: prefilled("sunlight", "日照", "自然條件", "充分"),
  view: prefilled("view", "景觀", "自然條件", "視野、景觀尚可"),
  slope: prefilled("slope", "傾斜度", "自然條件", "平均坡度未滿5度"),
  wind: empty("wind", "風勢", "自然條件"),
  soil: empty("soil", "土質", "自然條件"),
  site_improvement: prefilled(
    "site_improvement",
    "建築基地改良",
    "土地改良",
    "整平或填挖基地、開挖水溝、鋪築道路、埋設管道",
    SITE_IMPROVEMENT_OPTIONS,
    true,
  ),
  farmland_improvement: empty(
    "farmland_improvement",
    "農地改良",
    "土地改良",
    FARMLAND_IMPROVEMENT_OPTIONS,
    true,
  ),
  school: empty(
    "school",
    "接近學校之程度（國小/國中/高中/大專院校）",
    "公共建設",
  ),
  market: empty("market", "市場", "公共建設"),
  park: empty("park", "公園廣場徒步區", "公共建設"),
  tourism_facility: empty("tourism_facility", "觀光遊憩設施", "公共建設"),
  parking: empty("parking", "停車場地", "公共建設"),
  service_facility: empty(
    "service_facility",
    "接近服務性設施的程度",
    "公共建設",
  ),
  power_resource: empty("power_resource", "電力資源", "公共建設"),
  industrial_water: empty("industrial_water", "產業用水及設施", "公共建設"),
  sewage_facility: prefilled(
    "sewage_facility",
    "污廢水及廢棄物處理設施",
    "公共建設",
    "無",
  ),
  cemetery: empty("cemetery", "殯葬－墓地", "特殊設施"),
  columbarium: prefilled("columbarium", "殯葬－納骨塔", "特殊設施", "無"),
  crematorium: prefilled("crematorium", "殯葬－火葬場", "特殊設施", "無"),
  funeral_home: prefilled("funeral_home", "殯葬－殯儀館", "特殊設施", "無"),
  substation: prefilled(
    "substation",
    "電業－變電所或高壓鐵塔",
    "特殊設施",
    "無",
  ),
  gas_tank: prefilled("gas_tank", "氣體燃料－瓦斯槽或儲油槽", "特殊設施", "無"),
  sewage_plant: prefilled(
    "sewage_plant",
    "廢棄物處理－污水處理場",
    "特殊設施",
    "無",
  ),
  landfill: prefilled(
    "landfill",
    "廢棄物處理－垃圾場或掩埋場",
    "特殊設施",
    "無",
  ),
  incinerator: prefilled("incinerator", "廢棄物處理－焚化爐", "特殊設施", "無"),
  water_pollution: prefilled("water_pollution", "水污染", "環境污染", "無"),
  noise_pollution: prefilled("noise_pollution", "噪音污染", "環境污染", "無"),
  air_pollution: prefilled("air_pollution", "廢氣污染", "環境污染", "無"),
  waste_pollution: prefilled("waste_pollution", "廢棄物污染", "環境污染", "無"),
  other_pollution: prefilled("other_pollution", "其他污染", "環境污染", "無"),
  department_store: prefilled("department_store", "百貨公司", "工商活動", "無"),
  financial_institution: empty("financial_institution", "金融機構", "工商活動"),
  entertainment: prefilled("entertainment", "娛樂設施", "工商活動", "無"),
  exhibition_hotel: prefilled(
    "exhibition_hotel",
    "大型展示中心或觀光飯店",
    "工商活動",
    "無",
  ),
  customer_flow: empty("customer_flow", "顧客之通行量", "工商活動"),
  shop_adjacency: empty("shop_adjacency", "店鋪之毗連狀態", "工商活動"),
  other_factors: empty("other_factors", "其他影響因素", "其他影響因素"),
  building_density: prefilled(
    "building_density",
    "建築密度",
    "房屋建築現況",
    "70%",
  ),
  building_type: prefilled(
    "building_type",
    "建築型態",
    "房屋建築現況",
    "公寓、透天",
  ),
  land_use_status: prefilled(
    "land_use_status",
    "土地利用現況",
    "土地利用現況",
    "住宅用",
    [
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
    ],
    true,
  ),
};

/**
 * 比較標的 3 預填數據
 */
export const COMPARISON3_PREFILL: Record<string, SurveyField> = {
  year_period: prefilled("year_period", "年期", "基本資訊", "1110901"),
  section_id: prefilled("section_id", "區段編號", "基本資訊", "P004-00"),
  section_range: prefilled(
    "section_range",
    "區段範圍",
    "基本資訊",
    "沿八德街以西、啟智街及未開闢計畫道路以南、啟智街187巷以東、啟智街187巷24弄以北之捷運開發區(變更前為第一種住宅區)",
  ),
  urban_plan: prefilled(
    "urban_plan",
    "都市計畫(內外)",
    "土地使用管制",
    "都市計畫內",
    ["都市計畫內", "都市計畫外"],
  ),
  zone_type: prefilled(
    "zone_type",
    "使用分區(使用地類別)",
    "土地使用管制",
    "第一種住宅區",
    [
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
    ],
  ),
  coverage_ratio: prefilled("coverage_ratio", "建蔽率", "土地使用管制", "50%"),
  plot_ratio: prefilled("plot_ratio", "容積率", "土地使用管制", "200%"),
  no_build_ban: prefilled("no_build_ban", "有無禁止建築", "土地使用管制", "無"),
  build_restriction: prefilled(
    "build_restriction",
    "有無限制建築（整體開發、面積限制、高度限制）",
    "土地使用管制",
    "無",
  ),
  main_road: prefilled("main_road", "主要道路", "交通運輸", "潭興街 10M"),
  road_avg_width: prefilled(
    "road_avg_width",
    "區段內道路平均寬度",
    "交通運輸",
    "7M",
  ),
  road_development: prefilled(
    "road_development",
    "區段內道路規劃及闢建程度",
    "交通運輸",
    "全部規劃及闢建",
  ),
  hsr_station: prefilled("hsr_station", "大型車站－高鐵站", "交通運輸", "無"),
  train_station: prefilled(
    "train_station",
    "大型車站－火車站",
    "交通運輸",
    "無",
  ),
  mrt_station: prefilled("mrt_station", "大型車站－捷運站", "交通運輸", "無"),
  bus_terminal: empty("bus_terminal", "大型車站－客運站", "交通運輸"),
  bus_stop: empty("bus_stop", "站牌", "交通運輸"),
  interchange: prefilled("interchange", "交流道距離", "交通運輸", "無"),
  approach_settlement: empty("approach_settlement", "接近聚落程度", "交通運輸"),
  approach_distribution_center: empty(
    "approach_distribution_center",
    "接近運銷中心程度",
    "交通運輸",
  ),
  approach_market: empty("approach_market", "接近消費市場程度", "交通運輸"),
  drainage: prefilled("drainage", "保（排）水之良否", "自然條件", "善通完善"),
  terrain: prefilled("terrain", "地勢", "自然條件", "極平坦堅硬"),
  sunlight: prefilled("sunlight", "日照", "自然條件", "充分"),
  view: prefilled("view", "景觀", "自然條件", "視野、景觀尚可"),
  slope: prefilled("slope", "傾斜度", "自然條件", "平均坡度未滿5度"),
  wind: empty("wind", "風勢", "自然條件"),
  soil: empty("soil", "土質", "自然條件"),
  site_improvement: prefilled(
    "site_improvement",
    "建築基地改良",
    "土地改良",
    "整平或填挖基地、開挖水溝、鋪築道路、埋設管道",
    SITE_IMPROVEMENT_OPTIONS,
    true,
  ),
  farmland_improvement: empty(
    "farmland_improvement",
    "農地改良",
    "土地改良",
    FARMLAND_IMPROVEMENT_OPTIONS,
    true,
  ),
  school: empty(
    "school",
    "接近學校之程度（國小/國中/高中/大專院校）",
    "公共建設",
  ),
  market: empty("market", "市場", "公共建設"),
  park: empty("park", "公園廣場徒步區", "公共建設"),
  tourism_facility: empty("tourism_facility", "觀光遊憩設施", "公共建設"),
  parking: empty("parking", "停車場地", "公共建設"),
  service_facility: empty(
    "service_facility",
    "接近服務性設施的程度",
    "公共建設",
  ),
  power_resource: empty("power_resource", "電力資源", "公共建設"),
  industrial_water: empty("industrial_water", "產業用水及設施", "公共建設"),
  sewage_facility: prefilled(
    "sewage_facility",
    "污廢水及廢棄物處理設施",
    "公共建設",
    "無",
  ),
  cemetery: empty("cemetery", "殯葬－墓地", "特殊設施"),
  columbarium: prefilled("columbarium", "殯葬－納骨塔", "特殊設施", "無"),
  crematorium: prefilled("crematorium", "殯葬－火葬場", "特殊設施", "無"),
  funeral_home: prefilled("funeral_home", "殯葬－殯儀館", "特殊設施", "無"),
  substation: prefilled(
    "substation",
    "電業－變電所或高壓鐵塔",
    "特殊設施",
    "無",
  ),
  gas_tank: prefilled("gas_tank", "氣體燃料－瓦斯槽或儲油槽", "特殊設施", "無"),
  sewage_plant: prefilled(
    "sewage_plant",
    "廢棄物處理－污水處理場",
    "特殊設施",
    "無",
  ),
  landfill: prefilled(
    "landfill",
    "廢棄物處理－垃圾場或掩埋場",
    "特殊設施",
    "無",
  ),
  incinerator: prefilled("incinerator", "廢棄物處理－焚化爐", "特殊設施", "無"),
  water_pollution: prefilled("water_pollution", "水污染", "環境污染", "無"),
  noise_pollution: prefilled("noise_pollution", "噪音污染", "環境污染", "無"),
  air_pollution: prefilled("air_pollution", "廢氣污染", "環境污染", "無"),
  waste_pollution: prefilled("waste_pollution", "廢棄物污染", "環境污染", "無"),
  other_pollution: prefilled("other_pollution", "其他污染", "環境污染", "無"),
  department_store: prefilled("department_store", "百貨公司", "工商活動", "無"),
  financial_institution: empty("financial_institution", "金融機構", "工商活動"),
  entertainment: prefilled("entertainment", "娛樂設施", "工商活動", "無"),
  exhibition_hotel: prefilled(
    "exhibition_hotel",
    "大型展示中心或觀光飯店",
    "工商活動",
    "無",
  ),
  customer_flow: empty("customer_flow", "顧客之通行量", "工商活動"),
  shop_adjacency: empty("shop_adjacency", "店鋪之毗連狀態", "工商活動"),
  other_factors: empty("other_factors", "其他影響因素", "其他影響因素"),
  building_density: prefilled(
    "building_density",
    "建築密度",
    "房屋建築現況",
    "50%",
  ),
  building_type: prefilled("building_type", "建築型態", "房屋建築現況", "公寓"),
  land_use_status: prefilled(
    "land_use_status",
    "土地利用現況",
    "土地利用現況",
    "住宅用",
    [
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
    ],
    true,
  ),
};

/**
 * 根據 locationRole 取得對應的預填數據
 */
export function getPrefillDataByRole(
  role: LocationRole,
): Record<string, SurveyField> {
  switch (role) {
    case "benchmark":
      return BENCHMARK_PREFILL;
    case "comparison1":
      return COMPARISON1_PREFILL;
    case "comparison2":
      return COMPARISON2_PREFILL;
    case "comparison3":
      return COMPARISON3_PREFILL;
  }
}

/**
 * 比準地的預填 ComparisonCondition 基準值
 */
export const BENCHMARK_CONDITION_PREFILL: ComparisonCondition = {
  location: "新北市樹林區樹德段1415地號", // 根據截圖（表4：宗地流水號0003）
  area: "約500",
  width: "約20",
  depth: "約25",
  shape: "矩形",
  frontage: "路角地，臨八德街",
  terrain: "平坦",
  roadType: "市道",
  roadName: "八德街",
  roadWidth: "28",
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
  zoning: "第一種住宅區",
  coverageRatio: "50%",
  plotRatio: "200%",
  buildRestriction: "無",
  sectionId: "P001-00",
};

/**
 * 比較標的 1 的預填 ComparisonCondition
 */
export const COMPARISON1_CONDITION_PREFILL: ComparisonCondition = {
  location: "新北市樹林區樹德段284地號", // 根據截圖
  normalPrice: 130167, // 根據截圖
  tradeDate: "110年9月14日", // 根據截圖
  dateAdjRate: 5.96, // 根據截圖
  area: "約450",
  width: "約19",
  depth: "約24",
  shape: "矩形",
  frontage: "路邊地，臨御八街",
  terrain: "極平坦堅硬",
  roadType: "市道",
  roadName: "御八街",
  roadWidth: "7",
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
  zoning: "第一種住宅區",
  coverageRatio: "50%",
  plotRatio: "200%",
  buildRestriction: "無",
  sectionId: "P002-00",
};

/**
 * 比較標的 2 的預填 ComparisonCondition
 */
export const COMPARISON2_CONDITION_PREFILL: ComparisonCondition = {
  location: "新北市樹林區太平段367、917地號", // 根據截圖
  normalPrice: 135275, // 根據截圖
  tradeDate: "111年1月11日", // 根據截圖
  dateAdjRate: 4.09, // 根據截圖
  area: "約480",
  width: "約20",
  depth: "約24",
  shape: "矩形",
  frontage: "路邊地，臨東榮街",
  terrain: "極平坦堅硬",
  roadType: "市道",
  roadName: "東榮街",
  roadWidth: "10",
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
  zoning: "第一種住宅區",
  coverageRatio: "50%",
  plotRatio: "200%",
  buildRestriction: "無",
  sectionId: "P003-00",
};

/**
 * 比較標的 3 的預填 ComparisonCondition
 */
export const COMPARISON3_CONDITION_PREFILL: ComparisonCondition = {
  location: "新北市樹林區文林段317地號", // 根據截圖
  normalPrice: 170909, // 根據截圖
  tradeDate: "110年10月29日", // 根據截圖
  dateAdjRate: 5.49, // 根據截圖
  area: "約500",
  width: "約21",
  depth: "約24",
  shape: "矩形",
  frontage: "路邊地，臨潭興街",
  terrain: "極平坦堅硬",
  roadType: "市道",
  roadName: "潭興街",
  roadWidth: "10",
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
  zoning: "第一種住宅區",
  coverageRatio: "50%",
  plotRatio: "200%",
  buildRestriction: "無",
  sectionId: "P004-00",
};

/**
 * 根據 locationRole 取得對應的 ComparisonCondition 預填值
 */
export function getConditionPrefillByRole(
  role: LocationRole,
): ComparisonCondition {
  switch (role) {
    case "benchmark":
      return BENCHMARK_CONDITION_PREFILL;
    case "comparison1":
      return COMPARISON1_CONDITION_PREFILL;
    case "comparison2":
      return COMPARISON2_CONDITION_PREFILL;
    case "comparison3":
      return COMPARISON3_CONDITION_PREFILL;
  }
}
