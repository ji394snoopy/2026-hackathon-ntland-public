// 官方表5-2版式（商業用地）8大主要項目及其修正細項的唯一權威定義：文字/順序逐字比對
// cli/input/regional-anlysis-commerical.pdf 空白官方範本抄錄，PrintableRegionalFactorForm.tsx
// (輸出用) 與 RegionalFactorPage.tsx (互動編輯頁) 都從這裡取用，避免兩處各自維護一份而漂移。
//
// 每一列都給一個 key，供 FactorRow 對應：有 REGIONAL_FACTOR_BRACKETS 查表依據的沿用既有 key
// (road_r/bus_r/...)，官方範本裡沒有對應查表依據的細項（如都市計畫、使用分區等）也給 key，
// 只是沒有 bracket，計算階段會原樣保留 grade:""/rate:0，畫面上留給人工判斷，不是漏掉不畫。
// 其他影響因素(8)：官方範本此欄位本身留空(無固定細項)，rows 刻意留空陣列——這是標準7類
// 涵蓋不到、由查估人員自行判斷加註的個案特殊因素，系統不預填任何細項，見 RegionalFactorPage.tsx
// 的「＋新增其他影響因素」與 RegionalFactorRow.custom。
export type RegionalFactorItemDef = { key: string; label: string }
export type RegionalFactorGroupDef = { no: number; title: string; rows: RegionalFactorItemDef[] }

export const REGIONAL_FACTOR_GROUPS: RegionalFactorGroupDef[] = [
  {
    no: 1,
    title: "土地使用管制",
    rows: [
      { key: "urban_plan_r", label: "都市計畫（內、外）" },
      { key: "zone_type_r", label: "使用分區（使用地類別）" },
      { key: "coverage_ratio_r", label: "建蔽率" },
      { key: "plot_ratio_r", label: "容積率" },
      { key: "no_build_ban_r", label: "有無禁止建築" },
      { key: "build_restriction_r", label: "有無限制建築（整體開發、面積限制、高度限制……等）" },
    ],
  },
  {
    no: 2,
    title: "交通運輸",
    rows: [
      { key: "road_r", label: "主要道路寬度" },
      { key: "road_avg_width_r", label: "區段內道路平均寬度" },
      { key: "station_access_r", label: "接近大型車站之程度" },
      { key: "bus_r", label: "站牌之接近程度或密集程度" },
      { key: "interchange_r", label: "交流道之有無及接近交流道之程度" },
      { key: "road_plan_r", label: "區段內道路規劃及闢建程度" },
    ],
  },
  {
    no: 3,
    title: "自然條件",
    rows: [
      { key: "drain_r", label: "排水之良否" },
      { key: "terrain_r", label: "地勢" },
    ],
  },
  {
    no: 4,
    title: "公共建設",
    rows: [
      { key: "market_r", label: "接近市場之程度（傳統市場、超級市場、超大型購物中心）" },
      { key: "park_r", label: "接近公園（里鄰公園、一般公園）、廣場、徒步區之程度" },
      { key: "recreation_access_r", label: "接近觀光遊憩設施之程度" },
      { key: "parking_r", label: "停車場地之便利程度" },
    ],
  },
  {
    no: 5,
    title: "特殊設施",
    rows: [
      { key: "power_r", label: "電業設施及公用氣體燃料設施之有無及接近程度" },
      { key: "cemetery_r", label: "殯葬設施之有無及接近程度" },
      { key: "waste_facility_r", label: "廢棄物處理設施之有無及接近程度" },
    ],
  },
  {
    no: 6,
    title: "環境污染",
    rows: [{ key: "air_r", label: "水污染、噪音污染、廢氣污染、廢棄物污染等之有無及接近程度" }],
  },
  {
    no: 7,
    title: "工商活動",
    rows: [
      { key: "dept_store_r", label: "百貨公司之有無、數量、接近程度" },
      { key: "financial_r", label: "金融機構之有無、數量、接近程度" },
      { key: "entertainment_r", label: "娛樂設施之有無、數量、接近程度" },
      { key: "exhibition_hotel_r", label: "大型展示中心或觀光飯店之有無、數量、接近程度" },
      { key: "customer_flow_r", label: "顧客通行量之多寡" },
      { key: "shop_frontage_r", label: "店舖之毗連狀態" },
    ],
  },
  {
    no: 8,
    title: "其他影響因素",
    rows: [],
  },
]

export const ALL_REGIONAL_FACTOR_KEYS: string[] = REGIONAL_FACTOR_GROUPS.flatMap((g) => g.rows.map((r) => r.key))
