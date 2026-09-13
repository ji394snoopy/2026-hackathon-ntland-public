// produce-survey / draftFieldMap — 表1 survey key → district-survey-draft content 路徑的對照表。
//
// 為什麼要有這張表:district-survey-draft 的 content 是 camelCase schema
// (mainRoad / averageRoadWidthInSection / majorStation…),表1 欄位目錄卻是 snake_case
// (main_road / road_avg_width / hsr_station…),兩邊字面幾乎對不上。先前靠遞迴猜名字的
// extractDraftValue 因此 8 類全數落空(實測 e2e-out/Bp_survey.json:draft 來源 0 欄,
// 唯一字面撞名的 interchange 也因為值是巢狀 { raw, value:{…} } 而取不到純量)。
//
// 這裡改成逐欄位寫死路徑,再由 draftFieldMap.test.ts 對著各類 sample/sampleTool.ts 的
// input_schema 驗證每個 prop 真的存在 —— schema 一旦漂移就在測試爆掉,而不是靜默回 null。
//
// content 的形狀(見各類 sample/sampleTool.ts):
//   leaf  : content[prop] = { raw, value: DraftValue }
//   group : content[prop] = { raw, items: [{ raw, value }], other? }
// DraftValue 依 type 有不同欄位(text / number / measurement / singleChoice / 各種 *Facility),
// 攤平成可顯示字串由 displayDraftValue() 負責。

/** district-survey-draft 的 8 個類別 key(一次一類,一次一次 Bedrock 呼叫)。 */
export const DRAFT_CATEGORIES = [
  "landImprovement",
  "specialFacilities",
  "commercialActivity",
  "landUseRegulation",
  "trafficAndTransport",
  "publicInfrastructure",
  "environmentalPollution",
  "naturalConditions",
] as const;

export type DraftCategory = (typeof DRAFT_CATEGORIES)[number];

export const DRAFT_CATEGORY_LABEL: Record<DraftCategory, string> = {
  landImprovement: "土地改良",
  specialFacilities: "特殊設施",
  commercialActivity: "工商活動",
  landUseRegulation: "土地使用管制",
  trafficAndTransport: "交通運輸",
  publicInfrastructure: "公共建設",
  environmentalPollution: "環境污染",
  naturalConditions: "自然條件",
};

// ---------------------------------------------------------------------------
// draft content 的節點型別(防禦性:欄位全 optional,content 來自模型)
// ---------------------------------------------------------------------------

/** 巢狀 value 物件。各類 sampleTool 的 leafValue / *FacilityValue 的聯集視圖。 */
interface DraftValue {
  type?: unknown;
  raw?: unknown;
  // leafValue
  text?: unknown;
  label?: unknown;
  value?: unknown;
  unit?: unknown;
  // singleChoiceValue(土地使用管制 · 都市計畫內外)
  selected?: unknown;
  // *FacilityValue 共用
  name?: unknown;
  isExist?: unknown;
  inSection?: unknown;
  distanceValue?: unknown;
  distanceUnit?: unknown;
  // busStopValue / facilityWithQuantityValue 專有
  densityLevel?: unknown;
  quantity?: unknown;
}

/** 一個 leaf 項目或 group 的 sub-item。 */
interface DraftItem {
  raw?: unknown;
  value?: unknown;
  /** 只有土地改良的 checkboxItem 是 { raw, checked },沒有 value。 */
  checked?: unknown;
}

/** group 節點(大型車站/殯葬/廢棄物處理/環境污染/學校/市場/公園…)。 */
interface DraftGroup {
  raw?: unknown;
  items?: unknown;
  /** 只有土地改良的 group 有 其他＿＿＿ 選項。 */
  other?: unknown;
}

// ---------------------------------------------------------------------------
// 對照表的四種取值方式
// ---------------------------------------------------------------------------

/** group sub-item 的定位方式:先比 value.type / 標籤關鍵字,都不中才回退到固定順序的 index。 */
interface GroupItemRef {
  /** 該 group 在表單上的 sub-item 固定筆數。items 長度不符時不做 index 回退(寧可回 null)。 */
  siblings: number;
  /** 固定印刷順序中的位置(0-based)。 */
  index: number;
  /** 比對 item.raw / item.value.name 的關鍵字,任一命中即可。 */
  labels: string[];
  /** value.type 若對該 sub-item 唯一(環境污染 5 項),優先用它比對。 */
  valueType?: string;
}

export type DraftFieldSpec =
  | { category: DraftCategory; kind: "leaf"; prop: string }
  | { category: DraftCategory; kind: "groupItem"; prop: string; item: GroupItemRef }
  /** group 底下所有「存在(isExist)」的 sub-item 串成一格(學校/市場/公園廣場徒步區)。 */
  | { category: DraftCategory; kind: "groupExisting"; prop: string }
  /** 土地改良:勾選的 checkbox 標籤 + 其他自由文字串成一格。 */
  | { category: DraftCategory; kind: "checkboxGroup"; prop: string };

// ---------------------------------------------------------------------------
// 表1 survey key → draft content 路徑(56 欄;building_density / building_type /
// land_use_status 三欄 draft 無對應,留給 facilities/人工)
// ---------------------------------------------------------------------------

export const DRAFT_FIELD_MAP: Record<string, DraftFieldSpec> = {
  // --- 土地使用管制 (landUseRegulation) ---
  urban_plan: { category: "landUseRegulation", kind: "leaf", prop: "insideOutsideUrbanPlan" },
  zone_type: { category: "landUseRegulation", kind: "leaf", prop: "zoningDesignation" },
  coverage_ratio: { category: "landUseRegulation", kind: "leaf", prop: "buildingCoverageRatio" },
  plot_ratio: { category: "landUseRegulation", kind: "leaf", prop: "floorAreaRatio" },
  no_build_ban: { category: "landUseRegulation", kind: "leaf", prop: "buildingProhibition" },
  build_restriction: { category: "landUseRegulation", kind: "leaf", prop: "buildingRestriction" },

  // --- 交通運輸 (trafficAndTransport) ---
  main_road: { category: "trafficAndTransport", kind: "leaf", prop: "mainRoad" },
  road_avg_width: { category: "trafficAndTransport", kind: "leaf", prop: "averageRoadWidthInSection" },
  road_development: { category: "trafficAndTransport", kind: "leaf", prop: "roadConstructionLevel" },
  // 大型車站是一個 group,四個 sub-item 依印刷順序:高鐵站 / 火車站 / 客運站 / 捷運站。
  hsr_station: {
    category: "trafficAndTransport",
    kind: "groupItem",
    prop: "majorStation",
    item: { siblings: 4, index: 0, labels: ["高鐵"] },
  },
  train_station: {
    category: "trafficAndTransport",
    kind: "groupItem",
    prop: "majorStation",
    item: { siblings: 4, index: 1, labels: ["火車"] },
  },
  bus_terminal: {
    category: "trafficAndTransport",
    kind: "groupItem",
    prop: "majorStation",
    item: { siblings: 4, index: 2, labels: ["客運"] },
  },
  mrt_station: {
    category: "trafficAndTransport",
    kind: "groupItem",
    prop: "majorStation",
    item: { siblings: 4, index: 3, labels: ["捷運"] },
  },
  bus_stop: { category: "trafficAndTransport", kind: "leaf", prop: "busStop" },
  interchange: { category: "trafficAndTransport", kind: "leaf", prop: "interchange" },
  approach_settlement: { category: "trafficAndTransport", kind: "leaf", prop: "proximityToSettlement" },
  approach_distribution_center: {
    category: "trafficAndTransport",
    kind: "leaf",
    prop: "proximityToDistributionCenter",
  },
  approach_market: { category: "trafficAndTransport", kind: "leaf", prop: "proximityToMarket" },

  // --- 自然條件 (naturalConditions) ---
  drainage: { category: "naturalConditions", kind: "leaf", prop: "drainageQuality" },
  terrain: { category: "naturalConditions", kind: "leaf", prop: "terrain" },
  sunlight: { category: "naturalConditions", kind: "leaf", prop: "sunlight" },
  view: { category: "naturalConditions", kind: "leaf", prop: "view" },
  slope: { category: "naturalConditions", kind: "leaf", prop: "slope" },
  wind: { category: "naturalConditions", kind: "leaf", prop: "windCondition" },
  soil: { category: "naturalConditions", kind: "leaf", prop: "soilQuality" },

  // --- 土地改良 (landImprovement) — 多選 checkbox 群組,勾到的標籤串起來 ---
  site_improvement: { category: "landImprovement", kind: "checkboxGroup", prop: "buildingSiteImprovement" },
  farmland_improvement: { category: "landImprovement", kind: "checkboxGroup", prop: "farmlandImprovement" },

  // --- 公共建設 (publicInfrastructure) ---
  // 學校/市場/公園廣場徒步區在表單上是一整格(底下各有數個 sub-item),取「有的」串起來。
  school: { category: "publicInfrastructure", kind: "groupExisting", prop: "school" },
  market: { category: "publicInfrastructure", kind: "groupExisting", prop: "market" },
  park: { category: "publicInfrastructure", kind: "groupExisting", prop: "parkPlazaPedestrianZone" },
  tourism_facility: { category: "publicInfrastructure", kind: "leaf", prop: "touristRecreationFacility" },
  parking: { category: "publicInfrastructure", kind: "leaf", prop: "parkingArea" },
  service_facility: { category: "publicInfrastructure", kind: "leaf", prop: "proximityToServiceFacility" },
  power_resource: { category: "publicInfrastructure", kind: "leaf", prop: "electricPowerResources" },
  industrial_water: { category: "publicInfrastructure", kind: "leaf", prop: "industrialWaterSupply" },
  sewage_facility: { category: "publicInfrastructure", kind: "leaf", prop: "wastewaterTreatmentFacility" },

  // --- 特殊設施 (specialFacilities) — 三個 group:電業氣體燃料 / 殯葬 / 廢棄物處理 ---
  substation: {
    category: "specialFacilities",
    kind: "groupItem",
    prop: "utilityGasFacility",
    item: { siblings: 2, index: 0, labels: ["變電所", "高壓鐵塔"] },
  },
  gas_tank: {
    category: "specialFacilities",
    kind: "groupItem",
    prop: "utilityGasFacility",
    item: { siblings: 2, index: 1, labels: ["瓦斯槽", "儲油槽"] },
  },
  cemetery: {
    category: "specialFacilities",
    kind: "groupItem",
    prop: "funeralFacility",
    item: { siblings: 4, index: 0, labels: ["墓地"] },
  },
  funeral_home: {
    category: "specialFacilities",
    kind: "groupItem",
    prop: "funeralFacility",
    item: { siblings: 4, index: 1, labels: ["殯儀館"] },
  },
  crematorium: {
    category: "specialFacilities",
    kind: "groupItem",
    prop: "funeralFacility",
    item: { siblings: 4, index: 2, labels: ["火葬"] },
  },
  columbarium: {
    category: "specialFacilities",
    kind: "groupItem",
    prop: "funeralFacility",
    item: { siblings: 4, index: 3, labels: ["納骨"] },
  },
  sewage_plant: {
    category: "specialFacilities",
    kind: "groupItem",
    prop: "wasteFacility",
    item: { siblings: 3, index: 0, labels: ["污水處理"] },
  },
  landfill: {
    category: "specialFacilities",
    kind: "groupItem",
    prop: "wasteFacility",
    item: { siblings: 3, index: 1, labels: ["垃圾場", "掩埋場"] },
  },
  incinerator: {
    category: "specialFacilities",
    kind: "groupItem",
    prop: "wasteFacility",
    item: { siblings: 3, index: 2, labels: ["焚化爐"] },
  },

  // --- 工商活動 (commercialActivity) ---
  // 百貨/金融/娛樂/展示中心觀光飯店這四欄在表1 印在「工商活動」區塊,不是特殊設施。
  department_store: { category: "commercialActivity", kind: "leaf", prop: "departmentStore" },
  financial_institution: { category: "commercialActivity", kind: "leaf", prop: "financialInstitution" },
  entertainment: { category: "commercialActivity", kind: "leaf", prop: "entertainmentFacility" },
  exhibition_hotel: { category: "commercialActivity", kind: "leaf", prop: "exhibitionCenterOrHotel" },
  customer_flow: { category: "commercialActivity", kind: "leaf", prop: "customerTraffic" },
  shop_adjacency: { category: "commercialActivity", kind: "leaf", prop: "storeContiguity" },

  // --- 環境污染 (environmentalPollution) — 單一 group,5 項固定順序 ---
  water_pollution: {
    category: "environmentalPollution",
    kind: "groupItem",
    prop: "environmentalPollution",
    item: { siblings: 5, index: 0, labels: ["水污染"], valueType: "waterPollution" },
  },
  noise_pollution: {
    category: "environmentalPollution",
    kind: "groupItem",
    prop: "environmentalPollution",
    item: { siblings: 5, index: 1, labels: ["噪音"], valueType: "noisePollution" },
  },
  air_pollution: {
    category: "environmentalPollution",
    kind: "groupItem",
    prop: "environmentalPollution",
    item: { siblings: 5, index: 2, labels: ["廢氣"], valueType: "airPollution" },
  },
  waste_pollution: {
    category: "environmentalPollution",
    kind: "groupItem",
    prop: "environmentalPollution",
    item: { siblings: 5, index: 3, labels: ["廢棄物"], valueType: "wastePollution" },
  },
  other_pollution: {
    category: "environmentalPollution",
    kind: "groupItem",
    prop: "environmentalPollution",
    item: { siblings: 5, index: 4, labels: ["其他"], valueType: "otherPollution" },
  },
};

/** 該欄位吃哪一類 draft;沒對應(建築密度/建築型態/土地利用現況)回 undefined。 */
export function draftCategoryForField(surveyKey: string): DraftCategory | undefined {
  return DRAFT_FIELD_MAP[surveyKey]?.category;
}

/** 對照表指向 draft content 的哪一格 —— 寫進 reference.derivation,讓欄位可回溯。 */
export function draftFieldPath(spec: DraftFieldSpec): string {
  switch (spec.kind) {
    case "leaf":
      return `content.${spec.prop}`;
    case "groupItem":
      return `content.${spec.prop}.items[${spec.item.index}]`;
    case "groupExisting":
    case "checkboxGroup":
      return `content.${spec.prop}.items[]`;
  }
}

// ---------------------------------------------------------------------------
// 巢狀 value → 可顯示字串
// ---------------------------------------------------------------------------

function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * value.raw 是「表單原樣文字」,對 text/number/measurement 這類純文字格就是乾淨答案
 * (如 "中正路 10 M"),可以直接用;但設施格的 raw 會夾帶勾選記號與欄位標籤
 * (如 "名稱:金山區公所 ●本區段內 ○本區段外(距 M)\n密集程度:●非常密集…"),
 * 直接塞進 survey.value 既難看、又會讓表4 連動的「名稱，距NNNM」解析失敗。
 * 所以「優先用 raw」只在 raw 不含這些表單痕跡時成立,否則改由結構化欄位組。
 */
const FORM_ARTIFACT_RE = /[○●□■]|\n|名稱\s*[:：]|密集程度\s*[:：]|數量\s*[:：]/;

function usableRaw(v: unknown): string | null {
  const raw = str(v);
  if (raw == null) return null;
  return FORM_ARTIFACT_RE.test(raw) ? null : raw;
}

const DENSITY_LABELS = ["非常密集", "密集", "不密集"] as const;

/** number / measurement 的「(名稱) 數字 單位」組法。 */
function composeMeasurement(value: DraftValue): string | null {
  const n = num(value.value);
  if (n == null) return null;
  const unit = str(value.unit) ?? "";
  const label = str(value.label);
  return [label, `${n}${unit ? ` ${unit}` : ""}`].filter(Boolean).join(" ");
}

/** 各種 *FacilityValue 的組法:沒有就「無」,有就「名稱[，數量N][，距NNNM|（本區段內/外）]」。 */
function composeFacility(value: DraftValue): string | null {
  if (typeof value.isExist !== "boolean") return null;
  const name = str(value.name);

  // isExist=false:表單上印的是「無高鐵站」這類 placeholder,沒有就統一回「無」。
  if (!value.isExist) return name ?? "無";

  const parts: string[] = [name ?? "有"];
  const quantity = num(value.quantity);
  if (quantity != null) parts.push(`數量${quantity}`);

  const distance = num(value.distanceValue);
  if (distance != null) {
    parts.push(`距${distance}${str(value.distanceUnit) ?? "M"}`);
  } else if (typeof value.inSection === "boolean") {
    parts.push(value.inSection ? "本區段內" : "本區段外");
  }

  const density = num(value.densityLevel);
  if (density != null && DENSITY_LABELS[density]) parts.push(DENSITY_LABELS[density]);

  return parts.join("，");
}

/** 依 value.type 由結構化欄位組出顯示字串。 */
function composeDraftValue(value: DraftValue): string | null {
  switch (value.type) {
    case "text":
      return str(value.text);
    case "number":
    case "measurement":
      return composeMeasurement(value);
    case "singleChoice":
      if (value.selected === "insideUrbanPlan") return "都市計畫內";
      if (value.selected === "outsideUrbanPlan") return "都市計畫外";
      return null;
    default:
      // 其餘全是 *FacilityValue 家族(majorStationFacility / busStopFacility / funeralFacility /
      // waterPollution / departmentStore …),共用 isExist + name + 距離的形狀。
      return composeFacility(value);
  }
}

/** 把一個巢狀 value 物件攤平成可顯示字串;取不到回 null。 */
export function displayDraftValue(value: unknown): string | null {
  const obj = asObject(value);
  if (!obj) return null;
  return usableRaw(obj.raw) ?? composeDraftValue(obj as DraftValue);
}

// ---------------------------------------------------------------------------
// 依 spec 從 content 取值
// ---------------------------------------------------------------------------

function itemsOf(node: unknown): DraftItem[] | null {
  const group = asObject(node) as DraftGroup | null;
  if (!group || !Array.isArray(group.items)) return null;
  return group.items.filter((it): it is DraftItem => asObject(it) != null);
}

/** 先用 value.type,再用標籤關鍵字比 raw/name,最後才回退到固定順序的 index。 */
function pickGroupItem(items: DraftItem[], ref: GroupItemRef): DraftItem | null {
  if (ref.valueType) {
    const byType = items.find((it) => asObject(it.value)?.type === ref.valueType);
    if (byType) return byType;
  }
  const hit = (text: string | null) => text != null && ref.labels.some((l) => text.includes(l));
  const byRaw = items.find((it) => hit(str(it.raw)));
  if (byRaw) return byRaw;
  const byName = items.find((it) => hit(str(asObject(it.value)?.name)));
  if (byName) return byName;
  // 比不到才看位置,且只在 sub-item 筆數與表單一致時才敢按順序取(避免張冠李戴)。
  return items.length === ref.siblings ? (items[ref.index] ?? null) : null;
}

/** group 底下所有 isExist 的 sub-item 串成一格;全都沒有回「無」。 */
function resolveGroupExisting(items: DraftItem[]): string | null {
  const present = items.filter((it) => asObject(it.value)?.isExist === true);
  if (present.length === 0) return items.length > 0 ? "無" : null;
  const texts = present
    .map((it) => displayDraftValue(it.value))
    .filter((t): t is string => t != null);
  return texts.length > 0 ? texts.join("；") : null;
}

/** 土地改良:勾到的 checkbox 標籤 + 其他自由文字;全沒勾回「無」。 */
function resolveCheckboxGroup(node: unknown): string | null {
  const items = itemsOf(node);
  if (!items) return null;
  const checked = items
    .filter((it) => it.checked === true)
    .map((it) => str(it.raw))
    .filter((t): t is string => t != null);

  const other = asObject((asObject(node) as DraftGroup | null)?.other);
  if (other?.checked === true) {
    const text = str(other.text);
    checked.push(text != null ? `其他：${text}` : "其他");
  }
  if (checked.length > 0) return checked.join("、");
  return items.length > 0 ? "無" : null;
}

/**
 * 依對照表從一包 draft content 取出該欄位的顯示字串。取不到(content 形狀不符 / 該格空白)
 * 回 null,呼叫端維持原狀(不硬塞假資料)。
 */
export function resolveDraftValue(content: unknown, spec: DraftFieldSpec): string | null {
  const root = asObject(content);
  if (!root) return null;
  const node = root[spec.prop];
  if (node === undefined) return null;

  switch (spec.kind) {
    case "leaf":
      return displayDraftValue(asObject(node)?.value);
    case "groupItem": {
      const items = itemsOf(node);
      if (!items) return null;
      const item = pickGroupItem(items, spec.item);
      return item ? displayDraftValue(item.value) : null;
    }
    case "groupExisting": {
      const items = itemsOf(node);
      return items ? resolveGroupExisting(items) : null;
    }
    case "checkboxGroup":
      return resolveCheckboxGroup(node);
  }
}
