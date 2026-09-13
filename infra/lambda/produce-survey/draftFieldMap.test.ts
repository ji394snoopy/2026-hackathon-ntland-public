// produce-survey / draftFieldMap + mapToSurvey 的 applyDraft 單元測試(純函式,不連網)。
// 執行:npm run test:produce-survey(見 infra/package.json;走 esbuild ts-loader)。
//
// 這支測試在防的就是本來的 bug:對照表的 prop 名稱與 district-survey-draft 的
// sampleTool input_schema 對不上,導致 8 類草稿一欄都沒填進 survey。所以第一組測試直接
// import 那 8 支 tool builder,拿真正的 schema 來驗每個 prop 都存在 —— schema 一旦改名,
// 這裡就會紅,而不是靜默回 null。

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCommercialActivityTool } from "../district-survey-draft/commercialActivity/sample/sampleTool.js";
import { buildEnvironmentalPollutionTool } from "../district-survey-draft/environmentalPollution/sample/sampleTool.js";
import { buildLandImprovementTool } from "../district-survey-draft/landImprovement/sample/sampleTool.js";
import { buildLandUseRegulationTool } from "../district-survey-draft/landUseRegulation/sample/sampleTool.js";
import { buildNaturalConditionsTool } from "../district-survey-draft/naturalConditions/sample/sampleTool.js";
import { buildPublicInfrastructureTool } from "../district-survey-draft/publicInfrastructure/sample/sampleTool.js";
import { buildSpecialFacilitiesTool } from "../district-survey-draft/specialFacilities/sample/sampleTool.js";
import { buildTrafficAndTransportTool } from "../district-survey-draft/trafficAndTransport/sample/sampleTool.js";
import { parseArea } from "../facilities/input.js";
import type { ToolDefinition } from "../shared/tool";
import {
    DRAFT_CATEGORIES,
    DRAFT_FIELD_MAP,
    displayDraftValue,
    resolveDraftValue,
    type DraftCategory,
} from "./draftFieldMap";
import { facilitiesRequest } from "./lambda";
import {
    assembleSurveyResponse,
    type DraftOutcome,
    type NearbyFacilitiesResponse,
} from "./mapToSurvey";

const TOOL_BY_CATEGORY: Record<DraftCategory, () => ToolDefinition> = {
  landImprovement: buildLandImprovementTool,
  specialFacilities: buildSpecialFacilitiesTool,
  commercialActivity: buildCommercialActivityTool,
  landUseRegulation: buildLandUseRegulationTool,
  trafficAndTransport: buildTrafficAndTransportTool,
  publicInfrastructure: buildPublicInfrastructureTool,
  environmentalPollution: buildEnvironmentalPollutionTool,
  naturalConditions: buildNaturalConditionsTool,
};

function schemaProps(category: DraftCategory): string[] {
  const schema = TOOL_BY_CATEGORY[category]().input_schema as {
    properties?: Record<string, unknown>;
  };
  return Object.keys(schema.properties ?? {});
}

// ---------------------------------------------------------------------------
// 1. 對照表 ↔ draft schema 的一致性
// ---------------------------------------------------------------------------

test("每個欄位的 prop 都真的存在於該類 sampleTool 的 input_schema", () => {
  for (const [surveyKey, spec] of Object.entries(DRAFT_FIELD_MAP)) {
    const props = schemaProps(spec.category);
    assert.ok(
      props.includes(spec.prop),
      `${surveyKey} → ${spec.category}.${spec.prop} 不在 schema 的 [${props.join(", ")}] 之中`,
    );
  }
});

test("8 類都至少對到一個表1 欄位", () => {
  const covered = new Set(Object.values(DRAFT_FIELD_MAP).map((s) => s.category));
  for (const category of DRAFT_CATEGORIES) {
    assert.ok(covered.has(category), `${category} 沒有任何欄位對照`);
  }
  assert.equal(covered.size, DRAFT_CATEGORIES.length);
});

test("同一個 group 的 sub-item index 不重複、不超出 siblings、siblings 一致", () => {
  const groups = new Map<string, { siblings: number; indexes: number[] }>();
  for (const spec of Object.values(DRAFT_FIELD_MAP)) {
    if (spec.kind !== "groupItem") continue;
    const id = `${spec.category}.${spec.prop}`;
    const entry = groups.get(id) ?? { siblings: spec.item.siblings, indexes: [] };
    assert.equal(entry.siblings, spec.item.siblings, `${id} 的 siblings 前後不一致`);
    entry.indexes.push(spec.item.index);
    groups.set(id, entry);
  }
  for (const [id, { siblings, indexes }] of groups) {
    assert.equal(new Set(indexes).size, indexes.length, `${id} 有重複的 index`);
    assert.ok(Math.max(...indexes) < siblings, `${id} 的 index 超出 siblings`);
  }
});

// ---------------------------------------------------------------------------
// 2. 巢狀 value → 顯示字串
// ---------------------------------------------------------------------------

test("value.raw 乾淨時直接用 raw,夾帶勾選記號/欄位標籤時改由結構化欄位組", () => {
  // 乾淨的表格文字(text / number / measurement)→ 用 raw。
  assert.equal(
    displayDraftValue({ type: "measurement", raw: "中正路 10 M", label: "中正路", value: 10, unit: "M" }),
    "中正路 10 M",
  );
  // 夾帶 ○● 與「名稱:」的設施格 → 不能直接用 raw,改組。
  assert.equal(
    displayDraftValue({
      type: "busStopFacility",
      raw: "名稱:金山區公所 ●本區段內 ○本區段外(距 M)\n密集程度:●非常密集 ○密集 ○不密集",
      name: "金山區公所",
      isExist: true,
      densityLevel: 0,
      inSection: true,
    }),
    "金山區公所，本區段內，非常密集",
  );
  // isExist=false → 印的 placeholder 就是答案;沒 placeholder 就回「無」。
  assert.equal(
    displayDraftValue({ type: "interchangeFacility", raw: "名稱:無交流道 ○本區段內", name: "無交流道", isExist: false }),
    "無交流道",
  );
  assert.equal(
    displayDraftValue({ type: "parkingAreaFacility", raw: "名稱: ○本區段內", name: "", isExist: false }),
    "無",
  );
  // 都市計畫內外是 enum,不是自由文字。
  assert.equal(
    displayDraftValue({ type: "singleChoice", raw: "○都市計畫內 ○都市計畫外", selected: "outsideUrbanPlan" }),
    "都市計畫外",
  );
  assert.equal(displayDraftValue(null), null);
  assert.equal(displayDraftValue("都市計畫內"), null);
});

// ---------------------------------------------------------------------------
// 3. 8 類 content → 表1 欄位(fixture 逐類對照)
// ---------------------------------------------------------------------------

const leafText = (t: string) => ({ type: "text", raw: t, text: t });
const leafNumber = (n: number, unit: string) => ({ type: "number", raw: `${n} ${unit}`, value: n, unit });
const item = (raw: string, value: unknown) => ({ raw, value });

/** 設施格:有東西。raw 刻意寫成表單原樣(含 ○●),逼 displayDraftValue 走組字串那條路。 */
function present(type: string, name: string, extra: Record<string, unknown> = {}) {
  return { type, raw: `名稱:${name} ○本區段內 ●本區段外`, name, isExist: true, ...extra };
}
/** 設施格:空的/印著「無…」placeholder。 */
function absent(type: string, placeholder = "") {
  return { type, raw: `○${placeholder} ○本區段內 ○本區段外(距 M)`, name: placeholder, isExist: false };
}

// trafficAndTransport 這份是 e2e-out/B_draft.json 的真實回傳(金山 P002-00),原樣抄進來
// 當對照範本,確保線上實際吐出來的形狀真的對得上。
const TRAFFIC_CONTENT = {
  mainRoad: item("主要道路", {
    type: "measurement",
    raw: "中正路 10 M",
    label: "中正路",
    value: 10,
    unit: "M",
  }),
  averageRoadWidthInSection: item("區段內道路平均寬度", {
    type: "number",
    raw: "8 M",
    value: 8,
    unit: "M",
  }),
  majorStation: {
    raw: "大型車站",
    items: [
      item("無高鐵站", absent("majorStationFacility", "無高鐵站")),
      item("無火車站", absent("majorStationFacility", "無火車站")),
      item("無客運站", absent("majorStationFacility", "無客運站")),
      item("無捷運站", absent("majorStationFacility", "無捷運站")),
    ],
  },
  busStop: item("站牌", {
    type: "busStopFacility",
    raw: "名稱:金山區公所 ●本區段內 ○本區段外(距 M)\n密集程度:●非常密集 ○密集 ○不密集",
    name: "金山區公所",
    isExist: true,
    densityLevel: 0,
    inSection: true,
  }),
  interchange: item("交流道", absent("interchangeFacility", "無交流道")),
  proximityToSettlement: item("接近聚落程度", leafText("接近金山市區聚落")),
  proximityToDistributionCenter: item("接近運銷中心程度", leafText("距運銷中心較遠")),
  proximityToMarket: item("接近消費市場程度", leafText("接近金山地區消費市場")),
  roadConstructionLevel: item("區段內道路規劃及闢建程度", leafText("道路已開闢完成")),
};

const LAND_USE_REGULATION_CONTENT = {
  insideOutsideUrbanPlan: item("都市計畫（內外）", {
    type: "singleChoice",
    raw: "都市計畫內",
    selected: "insideUrbanPlan",
  }),
  zoningDesignation: item("使用分區", leafText("第二種住宅區")),
  buildingCoverageRatio: item("建蔽率", leafNumber(60, "%")),
  floorAreaRatio: item("容積率", leafNumber(180, "%")),
  buildingProhibition: item("有無禁止建築", leafText("無")),
  buildingRestriction: item("有無限制建築", leafText("高度限制 21 M")),
};

const NATURAL_CONDITIONS_CONTENT = {
  sunlight: item("日照", leafText("日照充足")),
  view: item("景觀", leafText("面山景觀良好")),
  slope: item("傾斜度", leafText("平坦")),
  drainageQuality: item("保（排）水之良否", leafText("排水良好")),
  terrain: item("地勢", leafText("平坦")),
  windCondition: item("風勢", leafText("東北季風較強")),
  soilQuality: item("土質", leafText("砂質壤土")),
};

const LAND_IMPROVEMENT_CONTENT = {
  buildingSiteImprovement: {
    raw: "建築基地改良",
    items: [
      { raw: "整平或填挖基地", checked: true },
      { raw: "開挖水溝", checked: false },
      { raw: "鋪築道路", checked: true },
    ],
    other: { checked: false, text: "" },
  },
  farmlandImprovement: {
    raw: "農地改良",
    items: [
      { raw: "耕地整理", checked: false },
      { raw: "灌溉", checked: false },
    ],
    other: { checked: true, text: "客土" },
  },
};

const PUBLIC_INFRASTRUCTURE_CONTENT = {
  touristRecreationFacility: item(
    "觀光遊憩設施",
    present("touristRecreationFacility", "朱銘美術館", {
      inSection: false,
      distanceValue: 1200,
      distanceUnit: "M",
    }),
  ),
  parkingArea: item("停車場地", absent("parkingAreaFacility")),
  proximityToServiceFacility: item(
    "接近服務性設施的程度",
    present("serviceFacilityProximityFacility", "金山區公所", { inSection: true }),
  ),
  electricPowerResources: item("電力資源", leafText("供電充足")),
  industrialWaterSupply: item("產業用水及設施", leafText("自來水供應")),
  wastewaterTreatmentFacility: item("污廢水及廢棄物處理設施", absent("wastewaterTreatmentFacility")),
  school: {
    raw: "學校",
    items: [
      item(
        "國小",
        present("schoolFacility", "金山國小", { inSection: false, distanceValue: 300, distanceUnit: "M" }),
      ),
      item("國中", absent("schoolFacility", "國中")),
      item("高中", absent("schoolFacility", "高中")),
      item("大專院校", absent("schoolFacility", "大專院校")),
    ],
  },
  market: {
    raw: "市場",
    items: [
      item("傳統市場", absent("marketFacility", "傳統市場")),
      item("超級市場", absent("marketFacility", "超級市場")),
      item("超大型購物中心", absent("marketFacility", "超大型購物中心")),
    ],
  },
  parkPlazaPedestrianZone: {
    raw: "公園廣場徒步區",
    items: [
      item("里鄰公園", present("parkFacility", "中山公園", { inSection: true })),
      item("一般公園", absent("parkFacility", "一般公園")),
      item("廣場.徒步區", absent("parkFacility", "廣場.徒步區")),
    ],
  },
};

const SPECIAL_FACILITIES_CONTENT = {
  utilityGasFacility: {
    raw: "電業氣體燃料",
    items: [
      item("變電所或高壓鐵塔", present("utilityGasFacility", "金山變電所", { distanceValue: 800, distanceUnit: "M" })),
      item("瓦斯槽或儲油槽", absent("utilityGasFacility")),
    ],
  },
  funeralFacility: {
    raw: "殯葬",
    items: [
      item("墓地", present("funeralFacility", "金山公墓", { distanceValue: 1500, distanceUnit: "M" })),
      item("殯儀館", absent("funeralFacility")),
      item("火葬場", absent("funeralFacility")),
      item("納骨塔", present("funeralFacility", "金山納骨塔", { inSection: false })),
    ],
  },
  wasteFacility: {
    raw: "廢棄物處理",
    items: [
      item("污水處理場", absent("wasteFacility")),
      item("垃圾場或掩埋場", present("wasteFacility", "金山掩埋場", { distanceValue: 2000, distanceUnit: "M" })),
      item("焚化爐", absent("wasteFacility")),
    ],
  },
};

const COMMERCIAL_ACTIVITY_CONTENT = {
  departmentStore: item("百貨公司", absent("departmentStore")),
  financialInstitution: item(
    "金融機構",
    present("financialInstitution", "金山區農會", { quantity: 3, inSection: true }),
  ),
  entertainmentFacility: item("娛樂設施", absent("entertainmentFacility")),
  exhibitionCenterOrHotel: item(
    "大型展示中心或觀光飯店",
    present("exhibitionCenterOrHotel", "金山青年活動中心", { distanceValue: 900, distanceUnit: "M" }),
  ),
  customerTraffic: item("顧客之通行量", leafText("假日通行量大")),
  storeContiguity: item("店鋪之毗連狀態", leafText("店鋪連棟毗鄰")),
};

// 環境污染的 5 項刻意打亂順序,驗證是靠 value.type / 標籤比對,不是靠陣列位置。
const ENVIRONMENTAL_POLLUTION_CONTENT = {
  environmentalPollution: {
    raw: "環境污染",
    items: [
      item("其他污染", absent("otherPollution")),
      item("廢棄物污染", present("wastePollution", "資源回收場", { distanceValue: 400, distanceUnit: "M" })),
      item("水污染", absent("waterPollution")),
      item("廢氣污染", absent("airPollution")),
      item("噪音污染", present("noisePollution", "台2線車流", { inSection: true })),
    ],
  },
};

const CONTENT_BY_CATEGORY: Record<DraftCategory, unknown> = {
  trafficAndTransport: TRAFFIC_CONTENT,
  landUseRegulation: LAND_USE_REGULATION_CONTENT,
  naturalConditions: NATURAL_CONDITIONS_CONTENT,
  landImprovement: LAND_IMPROVEMENT_CONTENT,
  publicInfrastructure: PUBLIC_INFRASTRUCTURE_CONTENT,
  specialFacilities: SPECIAL_FACILITIES_CONTENT,
  commercialActivity: COMMERCIAL_ACTIVITY_CONTENT,
  environmentalPollution: ENVIRONMENTAL_POLLUTION_CONTENT,
};

/** 表1 欄位 key → 該 fixture 應該解出來的字串。56 欄全列,一欄漏掉就是對照表有洞。 */
const EXPECTED: Record<string, string> = {
  // 土地使用管制
  urban_plan: "都市計畫內",
  zone_type: "第二種住宅區",
  coverage_ratio: "60 %",
  plot_ratio: "180 %",
  no_build_ban: "無",
  build_restriction: "高度限制 21 M",
  // 交通運輸
  main_road: "中正路 10 M",
  road_avg_width: "8 M",
  road_development: "道路已開闢完成",
  hsr_station: "無高鐵站",
  train_station: "無火車站",
  bus_terminal: "無客運站",
  mrt_station: "無捷運站",
  bus_stop: "金山區公所，本區段內，非常密集",
  interchange: "無交流道",
  approach_settlement: "接近金山市區聚落",
  approach_distribution_center: "距運銷中心較遠",
  approach_market: "接近金山地區消費市場",
  // 自然條件
  drainage: "排水良好",
  terrain: "平坦",
  sunlight: "日照充足",
  view: "面山景觀良好",
  slope: "平坦",
  wind: "東北季風較強",
  soil: "砂質壤土",
  // 土地改良
  site_improvement: "整平或填挖基地、鋪築道路",
  farmland_improvement: "其他：客土",
  // 公共建設
  school: "金山國小，距300M",
  market: "無",
  park: "中山公園，本區段內",
  tourism_facility: "朱銘美術館，距1200M",
  parking: "無",
  service_facility: "金山區公所，本區段內",
  power_resource: "供電充足",
  industrial_water: "自來水供應",
  sewage_facility: "無",
  // 特殊設施
  substation: "金山變電所，距800M",
  gas_tank: "無",
  cemetery: "金山公墓，距1500M",
  funeral_home: "無",
  crematorium: "無",
  columbarium: "金山納骨塔，本區段外",
  sewage_plant: "無",
  landfill: "金山掩埋場，距2000M",
  incinerator: "無",
  // 工商活動
  department_store: "無",
  financial_institution: "金山區農會，數量3，本區段內",
  entertainment: "無",
  exhibition_hotel: "金山青年活動中心，距900M",
  customer_flow: "假日通行量大",
  shop_adjacency: "店鋪連棟毗鄰",
  // 環境污染
  water_pollution: "無",
  noise_pollution: "台2線車流，本區段內",
  air_pollution: "無",
  waste_pollution: "資源回收場，距400M",
  other_pollution: "無",
};

test("8 類 fixture 的每一欄都解得出預期字串", () => {
  for (const [surveyKey, spec] of Object.entries(DRAFT_FIELD_MAP)) {
    const actual = resolveDraftValue(CONTENT_BY_CATEGORY[spec.category], spec);
    assert.equal(actual, EXPECTED[surveyKey], `${surveyKey}（${spec.category}.${spec.prop}）`);
  }
});

test("EXPECTED 與對照表的欄位一一對應(沒有漏測的欄位)", () => {
  assert.deepEqual(
    Object.keys(EXPECTED).sort(),
    Object.keys(DRAFT_FIELD_MAP).sort(),
  );
});

// ---------------------------------------------------------------------------
// 4. 取值的邊界:比不到就回 null,不亂猜
// ---------------------------------------------------------------------------

test("sub-item 標籤比不到、筆數也不符時回 null(不按位置亂取)", () => {
  const spec = DRAFT_FIELD_MAP.cemetery;
  // 殯葬應有 4 筆;只給 2 筆且標籤都不含「墓地」→ 不做 index 回退。
  const content = {
    funeralFacility: {
      raw: "殯葬",
      items: [item("甲", absent("funeralFacility")), item("乙", absent("funeralFacility"))],
    },
  };
  assert.equal(resolveDraftValue(content, spec), null);
});

test("標籤比不到但筆數與表單一致時,才按固定順序回退", () => {
  const spec = DRAFT_FIELD_MAP.landfill;
  const content = {
    wasteFacility: {
      raw: "廢棄物處理",
      items: [
        item("甲", absent("wasteFacility")),
        item("乙", present("wasteFacility", "某掩埋場", { distanceValue: 100, distanceUnit: "M" })),
        item("丙", absent("wasteFacility")),
      ],
    },
  };
  assert.equal(resolveDraftValue(content, spec), "某掩埋場，距100M");
});

test("content 形狀不符(缺 prop / 非物件)一律回 null", () => {
  assert.equal(resolveDraftValue({}, DRAFT_FIELD_MAP.main_road), null);
  assert.equal(resolveDraftValue(null, DRAFT_FIELD_MAP.main_road), null);
  assert.equal(resolveDraftValue({ mainRoad: "中正路" }, DRAFT_FIELD_MAP.main_road), null);
  assert.equal(resolveDraftValue({ majorStation: {} }, DRAFT_FIELD_MAP.hsr_station), null);
});

// ---------------------------------------------------------------------------
// 5. assembleSurveyResponse:usedFacts 閘門 + facilities 優先權
// ---------------------------------------------------------------------------

function draftsFrom(usedFacts: boolean): DraftOutcome[] {
  return DRAFT_CATEGORIES.map((category) => ({
    category,
    content: CONTENT_BY_CATEGORY[category],
    usedFacts,
  }));
}

const FACILITIES: NearbyFacilitiesResponse = {
  area: { kind: "radius", center: { lon: 121.63575, lat: 25.2219 }, radiusMeters: 600 },
  facilities: [
    { kind: "文教設施", name: "金山國民小學", lon: 121.636, lat: 25.222, metersToCenter: 150 },
  ],
};

test("usedFacts=true:draft 值進得了 survey,並帶可回溯的 reference", () => {
  const { survey } = assembleSurveyResponse({
    sectionId: "P002-00",
    facilities: null,
    drafts: draftsFrom(true),
  });
  assert.equal(survey.length, 60);

  const mainRoad = survey.find((f) => f.key === "main_road");
  assert.equal(mainRoad?.value, "中正路 10 M");
  assert.equal(mainRoad?.source, "ai");
  assert.equal(mainRoad?.warning, undefined);
  assert.match(mainRoad?.reference?.derivation ?? "", /content\.mainRoad/);

  const hsr = survey.find((f) => f.key === "hsr_station");
  assert.equal(hsr?.value, "無高鐵站");
  assert.match(hsr?.reference?.derivation ?? "", /content\.majorStation\.items\[0\]/);

  // draft 無對應的四欄維持空白(other_factors 在 8 類 draft 裡沒有對應的產出)。
  for (const key of ["building_density", "building_type", "land_use_status", "other_factors"]) {
    const field = survey.find((f) => f.key === key);
    assert.equal(field?.source, "empty");
    assert.equal(field?.warning, undefined);
  }
  assert.equal(survey.filter((f) => f.source === "empty").length, 4);
});

test("usedFacts=false:草稿是模型編的,維持 empty 只掛 warning", () => {
  const { survey } = assembleSurveyResponse({
    sectionId: "P002-00",
    facilities: null,
    drafts: draftsFrom(false),
  });
  const mainRoad = survey.find((f) => f.key === "main_road");
  assert.equal(mainRoad?.value, "");
  assert.equal(mainRoad?.source, "empty");
  assert.match(mainRoad?.warning ?? "", /未依實測事實/);
  assert.equal(survey.filter((f) => f.source === "ai").length, 0);
});

test("某類失敗只影響該類欄位,其餘照填", () => {
  const drafts = draftsFrom(true).map((d) =>
    d.category === "naturalConditions" ? { category: d.category, error: "HTTP 502" } : d,
  );
  const { survey } = assembleSurveyResponse({ sectionId: "P002-00", facilities: null, drafts });

  const terrain = survey.find((f) => f.key === "terrain");
  assert.equal(terrain?.source, "empty");
  assert.match(terrain?.warning ?? "", /AI 產草稿失敗（自然條件）/);
  assert.equal(survey.find((f) => f.key === "main_road")?.value, "中正路 10 M");
});

test("facilities 的實測距離不被 draft 覆蓋", () => {
  const { survey, benchmark } = assembleSurveyResponse({
    sectionId: "P002-00",
    facilities: FACILITIES,
    drafts: draftsFrom(true),
  });
  const school = survey.find((f) => f.key === "school");
  assert.equal(school?.value, "金山國民小學，距150M");
  assert.equal(school?.items?.length, 1);
  assert.match(school?.origin ?? "", /周邊設施查詢 API/);
  // 表4 連動也要跟著實測值走。
  assert.equal(benchmark.schoolName, "金山國民小學");
  assert.equal(benchmark.schoolDistance, "150");
});

test("facilities 查無的設施欄位,才輪到 draft 填", () => {
  const { survey } = assembleSurveyResponse({
    sectionId: "P002-00",
    facilities: FACILITIES, // 只有文教設施,沒有公園
    drafts: draftsFrom(true),
  });
  const park = survey.find((f) => f.key === "park");
  assert.equal(park?.value, "中山公園，本區段內");
  assert.equal(park?.source, "ai");
  assert.equal(park?.items, undefined);
});

// ---------------------------------------------------------------------------
// 6. 兩個距離:metersToCenter(區段中心,表5 用)/ metersToPoint(比準地,表4 用)
// ---------------------------------------------------------------------------

/** 區段中心與比準地是兩個不同的點:中心在區段形心,比準地在東南側。 */
const SECTION_CENTER = { lon: 121.635, lat: 25.222 };
const BENCHMARK_POINT = { lon: 121.638, lat: 25.22 };

const SECTION_POLYGON = [
  { lat: 25.2235, lng: 121.6335 },
  { lat: 25.2235, lng: 121.6365 },
  { lat: 25.2205, lng: 121.6365 },
  { lat: 25.2205, lng: 121.6335 },
];

/**
 * 兩筆學校,刻意讓兩種「最近」指向不同的那一筆:
 *   A 離區段中心近(80m)、離比準地遠(520m)
 *   B 離區段中心遠(300m)、離比準地近(60m)
 * 表5 要的是 A(區段的條件),表4 要的是 B(這一筆宗地的條件)。
 */
const TWO_POINT_FACILITIES: NearbyFacilitiesResponse = {
  area: {
    kind: "radius",
    center: SECTION_CENTER,
    centerFrom: "polygon",
    point: BENCHMARK_POINT,
    radiusMeters: 1000,
  },
  facilities: [
    {
      kind: "文教設施",
      name: "區段中心旁國小",
      lon: 121.6355,
      lat: 25.2222,
      metersToCenter: 80,
      metersToPoint: 520,
    },
    {
      kind: "文教設施",
      name: "比準地旁國小",
      lon: 121.6381,
      lat: 25.2201,
      metersToCenter: 300,
      metersToPoint: 60,
    },
  ],
};

test("區段中心 ≠ 比準地:items 帶兩個距離,value 附掛比準地距離", () => {
  const { survey } = assembleSurveyResponse({
    sectionId: "P002-00",
    benchmarkLocation: { lat: BENCHMARK_POINT.lat, lng: BENCHMARK_POINT.lon },
    sectionPolygon: SECTION_POLYGON,
    facilities: TWO_POINT_FACILITIES,
    drafts: draftsFrom(true),
  });

  const school = survey.find((f) => f.key === "school");
  // items 依「距區段中心」排序 —— 這份欄位描述的是區段。
  assert.deepEqual(school?.items, [
    { name: "區段中心旁國小", metersToCenter: 80, metersToPoint: 520 },
    { name: "比準地旁國小", metersToCenter: 300, metersToPoint: 60 },
  ]);
  // 基準形「名稱，距NNNM」原封不動,第二個距離純附加 —— 既有解析點行為不變。
  assert.equal(
    school?.value,
    "區段中心旁國小，距80M（距比準地520M）；比準地旁國小，距300M（距比準地60M）",
  );
  assert.equal(school?.reference?.measurement, "直線距離（距區段中心／距比準地）");
  // origin/derivation 的「最近」跟著 items[0] 走(離區段中心最近的那筆),兩個距離都報。
  assert.equal(
    school?.origin,
    "AI 查詢｜周邊設施查詢 API｜共2筆，最近距區段中心80m、距比準地520m",
  );
  assert.match(
    school?.reference?.derivation ?? "",
    /最近：區段中心旁國小 距區段中心80m、距比準地520m$/,
  );
});

test("benchmark(表4)取離比準地最近的那筆,不是離區段中心最近的", () => {
  const { benchmark } = assembleSurveyResponse({
    sectionId: "P002-00",
    benchmarkLocation: { lat: BENCHMARK_POINT.lat, lng: BENCHMARK_POINT.lon },
    sectionPolygon: SECTION_POLYGON,
    facilities: TWO_POINT_FACILITIES,
    drafts: draftsFrom(true),
  });
  assert.equal(benchmark.schoolName, "比準地旁國小");
  assert.equal(benchmark.schoolDistance, "60");
});

test("meta 原樣留下區段多邊形,兩個距離事後可追溯", () => {
  const { meta } = assembleSurveyResponse({
    sectionId: "P002-00",
    benchmarkLocation: { lat: BENCHMARK_POINT.lat, lng: BENCHMARK_POINT.lon },
    sectionPolygon: SECTION_POLYGON,
    facilities: TWO_POINT_FACILITIES,
    drafts: draftsFrom(true),
  });
  assert.deepEqual(meta.sectionPolygon, SECTION_POLYGON);
  // location 仍是比準地(不是區段中心)—— metersToPoint 量到的就是這一點。
  assert.deepEqual(meta.location, { lat: BENCHMARK_POINT.lat, lng: BENCHMARK_POINT.lon });
});

test("沒帶區段多邊形:兩點相同,不寫 metersToPoint,value/佐證維持舊格式", () => {
  const { survey, benchmark, meta } = assembleSurveyResponse({
    sectionId: "P002-00",
    benchmarkLocation: { lat: 25.2219, lng: 121.63575 },
    facilities: FACILITIES, // area.point 未帶 → 查詢中心就是比準地
    drafts: draftsFrom(true),
  });
  const school = survey.find((f) => f.key === "school");
  assert.deepEqual(school?.items, [{ name: "金山國民小學", metersToCenter: 150 }]);
  assert.equal(school?.value, "金山國民小學，距150M");
  assert.equal(school?.reference?.measurement, "直線距離");
  assert.equal(benchmark.schoolDistance, "150");
  assert.equal(meta.sectionPolygon, undefined);
});

test("area.point 與 center 同一點:視同沒有第二個距離(同一個數字不抄兩次)", () => {
  const samePoint: NearbyFacilitiesResponse = {
    area: {
      kind: "radius",
      center: SECTION_CENTER,
      point: SECTION_CENTER,
      radiusMeters: 600,
    },
    facilities: [
      {
        kind: "公園",
        name: "中山公園",
        lon: 121.6352,
        lat: 25.2221,
        metersToCenter: 30,
        metersToPoint: 30,
      },
    ],
  };
  const { survey } = assembleSurveyResponse({
    sectionId: "P002-00",
    facilities: samePoint,
    drafts: draftsFrom(true),
  });
  const park = survey.find((f) => f.key === "park");
  assert.deepEqual(park?.items, [{ name: "中山公園", metersToCenter: 30 }]);
  assert.equal(park?.value, "中山公園，距30M");
});

// ---------------------------------------------------------------------------
// 7. produce-survey → facilities 的接縫:本支組出的 body,facilities 真的吃得下
// ---------------------------------------------------------------------------
//
// 這個接縫的失敗模式特別糟:facilities 回 400 時 produce-survey 是**靜默降級**(log 一行、
// 欄位標「需人工」、整支仍回 200),所以 body 寫錯不會有人發現,只會看到「AI 什麼都查不到」。
// 所以這裡直接把組出來的 body 餵進 facilities 自己的 parseArea,驗它解出預期的 area。

test("接縫:帶區段多邊形 → POST body 被 facilities 解成「重心 + 半徑 + point」", () => {
  const { url, init } = facilitiesRequest(
    "https://facilities.example/",
    { lat: BENCHMARK_POINT.lat, lng: BENCHMARK_POINT.lon },
    SECTION_POLYGON,
    { radius: 600, categories: "bus_stop:800;education:1000" },
  );
  assert.equal(url, "https://facilities.example/");
  assert.equal(init.method, "POST");

  const area = parseArea(JSON.parse(String(init.body)) as Record<string, unknown>);
  assert.equal(area.kind, "radius"); // 多邊形只用來取中心,成員判定走半徑
  if (area.kind !== "radius") return;
  // 圓心是區段多邊形的重心(本例方框 → 中心 121.63575, 25.2219)。
  assert.ok(Math.abs(area.center[0] - 121.6357) < 1e-3, `lon ${area.center[0]}`);
  assert.ok(Math.abs(area.center[1] - 25.222) < 1e-3, `lat ${area.center[1]}`);
  assert.equal(area.radiusMeters, 600);
  // 逐類半徑在這個模式下可用(只帶 polygon 不帶 radius 會是 400)。
  assert.equal(area.categoryRadii?.get("公車站"), 800);
  assert.equal(area.categoryRadii?.get("education"), 1000);
  // point 是比準地,且是 facilities 要的 [lon, lat] 序 —— 不是前端的 {lat, lng}。
  assert.deepEqual(area.point, [BENCHMARK_POINT.lon, BENCHMARK_POINT.lat]);
});

test("接縫:沒帶區段多邊形 → 維持原本的 GET ?lon=&lat=&radius=&cats=", () => {
  const { url, init } = facilitiesRequest(
    "https://facilities.example/",
    { lat: 25.2219, lng: 121.63575 },
    undefined,
    { radius: 600, categories: "bus_stop:800" },
  );
  assert.equal(init.method, "GET");
  assert.equal(init.body, undefined);

  const parsed = new URL(url);
  const area = parseArea(Object.fromEntries(parsed.searchParams));
  assert.equal(area.kind, "radius");
  if (area.kind !== "radius") return;
  assert.deepEqual(area.center, [121.63575, 25.2219]);
  assert.equal(area.radiusMeters, 600);
  assert.equal(area.categoryRadii?.get("公車站"), 800);
  // 沒帶 point —— 查詢中心就是比準地,兩個距離會相同,不該無端生出第二個量測點。
  assert.equal(area.point, undefined);
});

test("接縫:有區段多邊形但沒比準地座標 → body 不帶 point,仍查得到設施", () => {
  const { init } = facilitiesRequest(
    "https://facilities.example/",
    undefined,
    SECTION_POLYGON,
    { radius: 600 },
  );
  const body = JSON.parse(String(init.body)) as Record<string, unknown>;
  assert.equal(body.point, undefined);
  const area = parseArea(body);
  assert.equal(area.kind, "radius");
  assert.equal(area.point, undefined);
});
