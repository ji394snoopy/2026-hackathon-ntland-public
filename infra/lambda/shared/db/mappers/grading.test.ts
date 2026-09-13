// Grading mapper 單元測試(純函式)。用 node:test(runtime 內建)。
// 執行:npm run test:grading(見 infra/package.json;走 register-ts.mjs esm loader)。
//
// 用 cli 真正的 exampleOutput/graded.json 當 fixture(plan §5 指定):
//   - regionalFactorGrading/exampleOutput/graded.json  → mapRegionalGradedToRows
//   - individualFactorGrading/exampleOutput/graded.json → mapIndividualGraded
//
// 驗:攤平(28 列 / 19 列)、cli key → 前端 {key,label,group} 對照、
// selectedGrade.raw → subject.grade、compare[] 階段 1 留空、meta/benchmark 近 identity、
// totalScore 透傳、個別因素 Option B 形狀(grade + value + displayValue)。

import assert from "node:assert/strict";
import { test } from "node:test";
import regionalComparison from "../../grading/gradingComparison/exampleOutput/comparison.json" with { type: "json" };
import individualGraded from "../../grading/individualFactorGrading/exampleOutput/graded.json" with { type: "json" };
import regionalGraded from "../../grading/regionalFactorGrading/exampleOutput/graded.json" with { type: "json" };
import {
    comparisonFormToContentTree,
    mapGradedBenchmark,
    mapGradedMeta,
    mapIndividualGraded,
    mapRegionalComparisonToRows,
    REGIONAL_CROSSWALK_KEYS,
    regionalRowsToAnalysisContent,
    type ComparisonResult,
    type IndividualGradedResult
} from "./grading";

// regional mapper 現在吃 gradingComparison 的 comparison.json(含 base + comparables),
// 才能填 compare[](plan §1.5 決策 1)。graded.json 仍用於 meta/benchmark 近 identity 測試。
const comparison = regionalComparison as unknown as ComparisonResult;
const individual = individualGraded as unknown as IndividualGradedResult;

// 官方表5-2 的 28 個前端 key(獨立於實作,測「缺一不可、不重複」)。
const EXPECTED_FRONTEND_KEYS = [
  "urban_plan_r", "zone_type_r", "coverage_ratio_r", "plot_ratio_r", "no_build_ban_r",
  "build_restriction_r", "road_r", "road_avg_width_r", "station_access_r", "bus_r",
  "interchange_r", "road_plan_r", "drain_r", "terrain_r", "market_r", "park_r",
  "recreation_access_r", "parking_r", "power_r", "cemetery_r", "waste_facility_r", "air_r",
  "dept_store_r", "financial_r", "entertainment_r", "exhibition_hotel_r", "customer_flow_r",
  "shop_frontage_r",
] as const;

test("crosswalk covers exactly the 28 official 表5 items", () => {
  assert.equal(REGIONAL_CROSSWALK_KEYS.length, 28);
  const frontendKeys = new Set(EXPECTED_FRONTEND_KEYS);
  assert.equal(frontendKeys.size, 28);
});

test("regional: flattens all categories.items into one flat row array", () => {
  const rows = mapRegionalComparisonToRows(comparison);
  // comparison.json 的 categories[].items[] 攤平；官方 7 大類固定細項共 28 項
  //（第 8「其他影響因素」無固定細項，comparison.json 的 otherFactors 類 items 為空）。
  const totalItems = comparison.categories.reduce((n, c) => n + c.items.length, 0);
  assert.equal(rows.length, totalItems);
  assert.equal(rows.length, 28);
});

test("regional: every row maps to a known frontend key/label/group (no unknowns)", () => {
  const rows = mapRegionalComparisonToRows(comparison);
  const seen = new Set<string>();
  for (const row of rows) {
    assert.ok(
      EXPECTED_FRONTEND_KEYS.includes(row.key as (typeof EXPECTED_FRONTEND_KEYS)[number]),
      `row.key「${row.key}」不在前端 28 key 內(未知 cli key 未對照)`,
    );
    assert.ok(row.label.length > 0, `${row.key} label 為空`);
    assert.ok(row.group.length > 0, `${row.key} group 為空`);
    assert.ok(
      !row.subject.warning,
      `${row.key} 帶了未知 key 的 warning，代表對照表漏項`,
    );
    seen.add(row.key);
  }
  // 28 項不重複且全覆蓋。
  assert.equal(seen.size, 28);
});

test("regional: base.raw -> subject.grade; points/rank carried; reference unset", () => {
  const rows = mapRegionalComparisonToRows(comparison);
  // 抽查:交通運輸/接近大型車站 cli superior → 前端 station_access_r grade「優」。
  const station = rows.find((r) => r.key === "station_access_r");
  assert.ok(station, "找不到 station_access_r 列");
  assert.equal(station!.subject.grade, "優");

  // A2：評分點數放進 subject.points / rank（不再塞 reference）。
  assert.equal(typeof station!.subject.points, "number");
  assert.equal(typeof station!.subject.rank, "number");

  // 決策 3：reference 一律留空（subject 與 compare 皆然）。
  for (const row of rows) {
    assert.equal(row.subject.reference, undefined, `${row.key} subject.reference 應留空`);
    for (const c of row.compare) {
      assert.equal(c.reference, undefined, `${row.key} compare.reference 應留空`);
    }
  }
});

test("regional: compare[] filled from comparables; rate null; sectionId + same-section flag", () => {
  const rows = mapRegionalComparisonToRows(comparison);
  const nComparables = comparison.comparableSectionIds.length; // fixture: 3 個比較標的
  assert.ok(nComparables > 0, "fixture 應有比較標的");

  for (const row of rows) {
    assert.equal(row.compare.length, nComparables, `${row.key} compare 數應等於比較標的數`);
    for (const c of row.compare) {
      assert.equal(c.rate, null, "修正率 % 由前端算 → rate 應為 null（決策 2）");
      assert.equal(typeof c.sectionId, "string");
      assert.equal(c.sameSectionAsBenchmark, c.sectionId === comparison.sectionIdBase);
    }
  }
});

test("regional: meta / benchmark near-identity passthrough", () => {
  const meta = mapGradedMeta(regionalGraded.meta as never);
  assert.equal(meta.sectionId, (regionalGraded as { meta: { sectionId: string } }).meta.sectionId);

  const benchmark = mapGradedBenchmark(regionalGraded.benchmark as never);
  assert.deepEqual(benchmark, regionalGraded.benchmark);
  // ComparisonCondition 28 欄齊全。
  assert.equal(Object.keys(benchmark).length, 28);
});

test("individual (Option B): flat grading-shaped rows keep cli key/label + grade + value", () => {
  const out = mapIndividualGraded(individual);
  const totalItems = individual.individualFactors.categories.reduce(
    (n, c) => n + c.items.length,
    0,
  );
  assert.equal(out.rows.length, totalItems);
  assert.equal(out.rows.length, 19); // fixture: 5 類共 19 項個別因素

  // 抽查:寬度 cli slightlyInferior(-3) → grade「稍劣」、value -3、保留 cli key。
  const width = out.rows.find((r) => r.key === "width");
  assert.ok(width, "找不到 width 列");
  assert.equal(width!.grade, "稍劣");
  assert.equal(width!.gradeKey, "slightlyInferior");
  assert.equal(width!.value, -3);
  assert.equal(width!.group, "宗地條件");
  assert.equal(width!.displayValue, "5"); // 純字串 displayValue

  // 抽查:面前道路寬度 displayValue 是 {name,distance,unit} 物件。
  const roadWidth = out.rows.find((r) => r.key === "frontageRoadWidth");
  assert.ok(roadWidth, "找不到 frontageRoadWidth 列");
  assert.deepEqual(roadWidth!.displayValue, { name: "中山路", distance: "18", unit: "M" });

  // totalScore 透傳、meta/benchmark 近 identity。
  assert.equal(out.totalScore, individual.totalScore);
  assert.equal(out.meta.sectionId, individual.meta.sectionId);
  assert.deepEqual(out.benchmark, individual.benchmark);
});

// ---------------------------------------------------------------------------
// 反向 mapper：RegionalFactorRow[] -> fill-regional-analysis content tree
// round-trip：comparison.json -正向-> rows -反向-> content，驗形狀 = fillEngine 要的。
// ---------------------------------------------------------------------------

test("reverse regional: rows -> analysis content 形狀對得上 fillEngine", () => {
  const rows = mapRegionalComparisonToRows(comparison);
  const content = regionalRowsToAnalysisContent(rows, comparison.sectionIdBase);

  // 頂層欄位齊備。
  assert.equal(content.sectionIdBase, comparison.sectionIdBase);
  assert.ok(Array.isArray(content.categories) && content.categories.length > 0);
  assert.ok(Array.isArray(content.comparableSectionIds));
  assert.ok(Array.isArray(content.comparableTotalScores));

  // 攤平總數守恆：反向後所有 category.items 加總 = 正向的列數（28）。
  const totalItems = content.categories.reduce((n: number, c) => n + c.items.length, 0);
  assert.equal(totalItems, rows.length);

  // 每個 item 用中文 itemRaw（fillEngine 靠中文比對，不是 key）+ base:{rank,raw}。
  const first = content.categories[0].items[0];
  assert.ok(first.itemRaw.length > 0);
  if (first.base) {
    assert.equal(typeof first.base.rate, "number");
    assert.equal(typeof first.base.raw, "string");
  }
  // comparable label 是 "1".."N" 字串，grade:{rank,raw}，delta 數字。
  const cmp = first.comparables[0];
  assert.ok(cmp);
  assert.equal(cmp.label, "1");
  if (cmp.grade) {
    assert.equal(typeof cmp.grade.rate, "number");
    assert.equal(typeof cmp.grade.raw, "string");
  }

  // category 有 comparableTotals（每 label 一筆 Σdelta）。
  assert.ok(Array.isArray(content.categories[0].comparableTotals));
});

test("reverse regional: comparableSectionIds 由 compare[].sectionId 還原", () => {
  const rows = mapRegionalComparisonToRows(comparison);
  const content = regionalRowsToAnalysisContent(rows, comparison.sectionIdBase);
  // 正向的 comparableSectionIds 應能被反向還原（label -> sectionId 對得上）。
  for (const { label, sectionId } of comparison.comparableSectionIds) {
    const found = content.comparableSectionIds.find((e: { label: string; sectionId: string }) => e.label === label);
    assert.ok(found, `反向後缺 comparable label ${label}`);
    assert.equal(found!.sectionId, sectionId);
  }
});

test("reverse regional: 空 grade（缺 rank）的 cell 省略 base，不畫 bogus 值", () => {
  const content = regionalRowsToAnalysisContent(
    [
      {
        key: "urban_plan_r",
        label: "都市計畫（內、外）",
        group: "土地使用管制",
        subject: { grade: "" }, // 無 grade / 無 rank
        compare: [{ sectionId: "P003-00", sameSectionAsBenchmark: false, grade: "", rate: null }],
      },
    ],
    "P002-00",
  );
  const item = content.categories[0].items[0];
  assert.equal(item.base, undefined); // 無 rank -> base 省略
  assert.equal(item.comparables[0].grade, undefined); // 同理
});

// ---------------------------------------------------------------------------
// 表4 mapper：ComparisonForm -> fill-individual-analysis content tree
// ---------------------------------------------------------------------------

// 手刻最小 ComparisonForm：benchmark + 1 個比較標的（帶 rates）。
const sampleForm = {
  benchmark: {
    location: "新北市金山區金美段489地號",
    area: "113.21", width: "5", depth: "23", shape: "方形", frontage: "單面臨街", terrain: "平坦",
    roadType: "主要道路", roadName: "中山路", roadWidth: "18",
    schoolName: "金山國小", schoolDistance: "150", marketName: "金山市場", marketDistance: "30",
    parkName: "中山公園", parkDistance: "190", stationName: "金山區公所站", stationDistance: "80",
    districtName: "老街商圈", districtDistance: "0", disamenityName: "金山第一公墓", disamenityDistance: "260",
    parking: "可路邊停車", zoning: "第二種商業區", coverageRatio: "70%", plotRatio: "240%", buildRestriction: "無",
    sectionId: "P002-00",
  },
  cases: [
    {
      caseNo: "1", sectionId: "P003-00", location: "新北市金山區金美段501地號",
      area: "95", width: "22", depth: "20", shape: "方形", frontage: "單面臨街", terrain: "平坦",
      roadType: "主要道路", roadName: "民生路", roadWidth: "16",
      schoolName: "金美國小", schoolDistance: "200", marketName: "金山市場", marketDistance: "50",
      parkName: "中山公園", parkDistance: "0", stationName: "金山區公所站", stationDistance: "0",
      districtName: "老街商圈", districtDistance: "0", disamenityName: "金山第一公墓", disamenityDistance: "300",
      parking: "可路邊停車", zoning: "第二種商業區", coverageRatio: "70%", plotRatio: "240%", buildRestriction: "無",
      rates: {
        area: 0, width: -3, depth: 0, shape: 0, frontage: 0, terrain: 0,
        roadType: 0, roadWidth: -2, school: 0, market: 0, park: 0, station: 0, district: 0,
        disamenity: 0, parking: 0, zoning: 0, coverageRatio: 0, plotRatio: 0, buildRestriction: 0,
      },
    },
  ],
};

test("individual: ComparisonForm -> content tree 形狀對得上 fillEngine", () => {
  const tree = comparisonFormToContentTree(sampleForm) as any;

  // 頂層。
  assert.equal(tree.sectionIdBase, "P002-00");
  assert.equal(tree.locationBase, "新北市金山區金美段489地號");
  assert.equal(tree.comparableIdentities.length, 1);
  assert.deepEqual(tree.comparableIdentities[0], { label: "1", sectionId: "P003-00", location: "新北市金山區金美段501地號" });

  // 19 項 + otherFactors 空類 = 6 個 category。
  const nonEmpty = tree.categories.filter((c: any) => c.items.length > 0);
  const totalItems = nonEmpty.reduce((n: number, c: any) => n + c.items.length, 0);
  assert.equal(totalItems, 19);
  const other = tree.categories.find((c: any) => c.categoryKey === "otherFactors");
  assert.ok(other && other.items.length === 0, "缺 otherFactors 空類");

  // 純字串項：lotCondition::area，base=benchmark.area、comparable=case.area、delta=rates.area。
  const area = nonEmpty.flatMap((c: any) => c.items).find((it: any) => it.itemKey === "area");
  assert.equal(area.base.value, "113.21");
  assert.equal(area.comparables[0].item.value, "95");
  assert.equal(area.comparables[0].delta, 0);

  // {name,distance,unit} 項：roadCondition::frontageRoadWidth。
  const road = nonEmpty.flatMap((c: any) => c.items).find((it: any) => it.itemKey === "frontageRoadWidth");
  assert.deepEqual(road.base.value, { name: "中山路", distance: "18", unit: "M" });
  assert.deepEqual(road.comparables[0].item.value, { name: "民生路", distance: "16", unit: "M" });
  assert.equal(road.comparables[0].delta, -2); // rates.roadWidth

  // 接近條件也是 {name,distance,unit}：proximityToSchool。
  const school = nonEmpty.flatMap((c: any) => c.items).find((it: any) => it.itemKey === "proximityToSchool");
  assert.deepEqual(school.base.value, { name: "金山國小", distance: "150", unit: "M" });
});

test("individual: comparableTotalScores.delta = Σ 該 case 的 19 rates", () => {
  const tree = comparisonFormToContentTree(sampleForm) as any;
  // sampleForm case1 rates 只有 width:-3、roadWidth:-2，其餘 0 → 合計 -5。
  assert.equal(tree.comparableTotalScores[0].delta, -5);
});

test("individual: 每個 categoryKey::itemKey 都在 coordinates 的 19 key 內", () => {
  const tree = comparisonFormToContentTree(sampleForm) as any;
  const EXPECTED = new Set([
    "lotCondition::area", "lotCondition::width", "lotCondition::depth", "lotCondition::shape",
    "lotCondition::roadFrontageCondition", "lotCondition::terrain",
    "roadCondition::roadType", "roadCondition::frontageRoadWidth",
    "proximityCondition::proximityToSchool", "proximityCondition::proximityToMarket",
    "proximityCondition::proximityToParkPlaza", "proximityCondition::proximityToStation",
    "proximityCondition::proximityToCommercialDistrict",
    "surroundingEnvironment::presenceOfNoxiousFacility", "surroundingEnvironment::parkingConvenience",
    "administrativeCondition::zoningDesignation", "administrativeCondition::buildingCoverageRatio",
    "administrativeCondition::floorAreaRatio", "administrativeCondition::buildingProhibitionOrRestriction",
  ]);
  const seen = new Set<string>();
  for (const c of tree.categories) {
    for (const it of c.items) seen.add(`${it.categoryKey}::${it.itemKey}`);
  }
  assert.equal(seen.size, 19);
  for (const k of EXPECTED) assert.ok(seen.has(k), `缺 ${k}`);
});
