// Survey mapper 單元測試（純函式）。用 node:test（runtime 內建）。
// 執行：npm run test:survey（見 infra/package.json；走 register-ts.mjs esm loader）。
//
// 驗：
//   - crosswalk 覆蓋全部 60 個前端 key（缺一不可、不重複）。
//   - 每種 kind 產出對到 coordinates.json 的鍵路徑 + fillEngine 認得的 value 形狀：
//     text / number / measurement / singleChoice(補 text) / facility(單) / arraySlot / arrayFanout / checkGroup。
//   - 空值欄位不產 leaf（text/number）；facility/array 空值產 isExist:false（維持陣列長度）。

import assert from "node:assert/strict";
import { test } from "node:test";
import type { SurveyField } from "../types";
import { SURVEY_CROSSWALK_KEYS, surveyToContentTree } from "./survey";

// 官方 60 key（獨立於實作，測「缺一不可、不重複」）。順序不拘。
const EXPECTED_KEYS = [
  // 土地使用管制 (6)
  "urban_plan", "zone_type", "coverage_ratio", "plot_ratio", "no_build_ban", "build_restriction",
  // 交通運輸 (12)
  "main_road", "road_avg_width", "road_development", "hsr_station", "train_station", "mrt_station",
  "bus_terminal", "bus_stop", "interchange", "approach_settlement", "approach_distribution_center", "approach_market",
  // 自然條件 (7)
  "drainage", "terrain", "sunlight", "view", "slope", "wind", "soil",
  // 土地改良 (2)
  "site_improvement", "farmland_improvement",
  // 公共建設 (9)
  "school", "market", "park", "tourism_facility", "parking", "service_facility",
  "power_resource", "industrial_water", "sewage_facility",
  // 特殊設施 (9)
  "cemetery", "columbarium", "crematorium", "funeral_home", "substation", "gas_tank",
  "sewage_plant", "landfill", "incinerator",
  // 環境污染 (5)
  "water_pollution", "noise_pollution", "air_pollution", "waste_pollution", "other_pollution",
  // 工商活動 (6)
  "department_store", "financial_institution", "entertainment", "exhibition_hotel", "customer_flow", "shop_adjacency",
  // 其他影響因素 (1)
  "other_factors",
  // 房屋建築現況 (2)
  "building_density", "building_type",
  // 土地利用現況 (1)
  "land_use_status",
] as const;

function f(key: string, value: string, extra: Partial<SurveyField> = {}): SurveyField {
  return { key, label: key, group: "", value, source: "edited", ...extra };
}

test("crosswalk covers exactly the 60 frontend survey keys", () => {
  assert.equal(SURVEY_CROSSWALK_KEYS.length, 60);
  const expected = new Set(EXPECTED_KEYS);
  assert.equal(expected.size, 60);
  for (const k of EXPECTED_KEYS) {
    assert.ok(SURVEY_CROSSWALK_KEYS.includes(k), `crosswalk missing key: ${k}`);
  }
  for (const k of SURVEY_CROSSWALK_KEYS) {
    assert.ok(expected.has(k as (typeof EXPECTED_KEYS)[number]), `crosswalk has unexpected key: ${k}`);
  }
});

test("text / number / measurement / singleChoice leaves land on the right path & shape", () => {
  const tree = surveyToContentTree([
    f("zone_type", "第二種商業區"),
    f("coverage_ratio", "70%"),
    f("main_road", "中山路，寬度18M"),
    f("urban_plan", "都市計畫內"),
    f("terrain", "該區地勢平坦"),
  ]) as any;

  // text
  assert.deepEqual(tree.landUseRegulation.zoningDesignation.value, {
    type: "text", raw: "第二種商業區", text: "第二種商業區",
  });
  // number "70%" -> value 70 unit %
  assert.deepEqual(tree.landUseRegulation.buildingCoverageRatio.value, {
    type: "number", raw: "70%", value: 70, unit: "%",
  });
  // measurement "中山路，寬度18M" -> label 中山路 / value 18 / unit M
  assert.deepEqual(tree.trafficAndTransport.mainRoad.value, {
    type: "measurement", raw: "中山路，寬度18M", label: "中山路", value: 18, unit: "M",
  });
  // singleChoice 必須帶 text（fillEngine 只認 text）
  const up = tree.landUseRegulation.insideOutsideUrbanPlan.value;
  assert.equal(up.type, "singleChoice");
  assert.equal(up.selected, "insideUrbanPlan");
  assert.equal(up.text, "都市計畫內");
  // naturalConditions 鍵名對應（terrain）
  assert.equal(tree.naturalConditions.terrain.value.text, "該區地勢平坦");
});

test("urban_plan 外 -> outsideUrbanPlan", () => {
  const tree = surveyToContentTree([f("urban_plan", "都市計畫外")]) as any;
  assert.equal(tree.landUseRegulation.insideOutsideUrbanPlan.value.selected, "outsideUrbanPlan");
});

test("single facility leaf parses 名稱+距離+本區段內外", () => {
  const tree = surveyToContentTree([
    f("bus_stop", "金山區公所站，本區段內", { items: [{ name: "金山區公所站", metersToCenter: 0 }] }),
    f("interchange", "無交流道"),
  ]) as any;
  const bus = tree.trafficAndTransport.busStop.value;
  assert.equal(bus.type, "busStopFacility");
  assert.equal(bus.name, "金山區公所站");
  assert.equal(bus.isExist, true);
  assert.equal(bus.distanceValue, 0);
  // "無交流道" -> isExist:false
  assert.equal(tree.trafficAndTransport.interchange.value.isExist, false);
});

test("arraySlot: 4 個大型車站各佔 majorStation 一格，缺的補 isExist:false", () => {
  const tree = surveyToContentTree([
    f("bus_terminal", "國光客運金山站，距300M"), // index 2
  ]) as any;
  const items = tree.trafficAndTransport.majorStation.items;
  assert.equal(items.length, 4);
  assert.equal(items[0].value.isExist, false); // hsr 未給
  assert.equal(items[2].value.isExist, true);  // bus_terminal
  assert.equal(items[2].value.name, "國光客運金山站");
  assert.equal(items[2].value.distanceValue, 300);
  assert.equal(items[3].value.isExist, false); // mrt 未給
});

test("arrayFanout: school 多筆拆進 4 格固定陣列", () => {
  const tree = surveyToContentTree([
    f("school", "", {
      items: [
        { name: "金美國小", metersToCenter: 88 },
        { name: "金山國小", metersToCenter: 199 },
      ],
    }),
  ]) as any;
  const items = tree.publicInfrastructure.school.items;
  assert.equal(items.length, 4);
  assert.equal(items[0].value.name, "金美國小");
  assert.equal(items[0].value.distanceValue, 88);
  assert.equal(items[1].value.name, "金山國小");
  assert.equal(items[2].value.isExist, false);
  assert.equal(items[3].value.isExist, false);
});

test("checkGroup: 逗號串多選 -> 每格 checked + 未命中入 other", () => {
  const tree = surveyToContentTree([
    f("site_improvement", "鋪築道路,埋設管道,自訂項目"),
  ]) as any;
  const g = tree.landImprovement.buildingSiteImprovement;
  assert.equal(g.items.length, 6);
  const byRaw = Object.fromEntries(g.items.map((it: any) => [it.raw, it.checked]));
  assert.equal(byRaw["鋪築道路"], true);
  assert.equal(byRaw["埋設管道"], true);
  assert.equal(byRaw["整平或填挖基地"], false);
  assert.equal(g.other.checked, true);
  assert.equal(g.other.text, "自訂項目");
});

test("land_use_status 單選走 checkGroup（勾中那格）", () => {
  const tree = surveyToContentTree([f("land_use_status", "商業用")]) as any;
  const g = tree.landUseStatus.landUseStatus;
  assert.equal(g.items.length, 9);
  assert.equal(g.items[0].raw, "商業用");
  assert.equal(g.items[0].checked, true);
});

test("3 類無 draft 也被補上（otherFactors / buildingCondition）", () => {
  const tree = surveyToContentTree([
    f("other_factors", "鄰近溫泉觀光區"),
    f("building_density", "95%"),
    f("building_type", "連棟透天厝、公寓"),
  ]) as any;
  assert.equal(tree.otherFactors.otherFactors.value.text, "鄰近溫泉觀光區");
  assert.equal(tree.buildingCondition.buildingDensity.value.value, 95);
  assert.equal(tree.buildingCondition.buildingType.value.text, "連棟透天厝、公寓");
});

test("meta.yearPeriod/sectionId/range 落在 header（表頭三格）", () => {
  const tree = surveyToContentTree([], {
    yearPeriod: "1110901",
    sectionId: "P002-00",
    district: "新北市樹林區",
    landUseType: "普通住宅用地",
    benchmarkParcel: "新北市樹林區樹德段284地號",
    surveyDate: "",
    range: "沿樹人街以北、長壽街21巷以西、啟智街14巷以南及樹德街136巷以東之第一種住宅區",
  }) as any;
  assert.equal(tree.header.yearPeriod.value.text, "1110901");
  assert.equal(tree.header.sectionId.value.text, "P002-00");
  assert.equal(tree.header.range.value.text, "沿樹人街以北、長壽街21巷以西、啟智街14巷以南及樹德街136巷以東之第一種住宅區");
});

test("沒有 meta 或 meta 欄位為空 -> 不產 header", () => {
  const tree = surveyToContentTree([]) as any;
  assert.equal(tree.header, undefined);
});

test("空值 text/number 不產 leaf；未知 key 跳過不 throw", () => {
  const tree = surveyToContentTree([
    f("zone_type", ""),        // 空 -> 不產
    f("coverage_ratio", "無"), // 空標記 -> 不產
    f("__unknown__", "x"),     // 未知 -> 跳過
  ]) as any;
  assert.equal(tree.landUseRegulation, undefined);
});
