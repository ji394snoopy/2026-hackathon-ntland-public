// produce-comparison / mergeComparison 單元測試(純函式,不 import cli、不連網)。
// 執行:npm run test:comparison(見 infra/package.json;走 esbuild ts-loader)。
//
// 用兩份 fixture:
//   1. cli individualComparison/exampleOutput/comparison.json —— 比較標的 = 比準地,
//      delta 全 0(只能驗結構:19 鍵 crosswalk、rate 全 0、價格鏈可算)。
//   2. 手工造一份 delta 非 0 的 FillReport(比較標的宗地條件不同)—— 驗 delta → rate、
//      價格鏈 trialPrice、computed 四欄。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ComparisonCondition } from "../shared/db";
import {
  CLI_TO_RATE_KEY,
  mergeComparison,
  RATE_KEYS,
  ratesByLabel,
  signedRateSum,
  type CaseMarketInput,
  type CliFillReport,
} from "./mergeComparison";

const EXPECTED_RATE_KEYS = [
  "area", "width", "depth", "shape", "frontage", "terrain", "roadType", "roadWidth",
  "school", "market", "park", "station", "district", "disamenity", "parking", "zoning",
  "coverageRatio", "plotRatio", "buildRestriction",
] as const;

// cli exampleOutput/comparison.json 就是一份 FillReport(delta 全 0)。
const FIXTURE_PATH = fileURLToPath(
  new URL(
    "../shared/grading/individualComparison/exampleOutput/comparison.json",
    import.meta.url,
  ),
);
function loadFixture(): CliFillReport {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as CliFillReport;
}

function benchmarkCond(overrides: Partial<ComparisonCondition> = {}): ComparisonCondition {
  return {
    location: "比準地",
    area: "113.21", width: "5", depth: "23", shape: "方形", frontage: "單面臨街",
    terrain: "平坦", roadType: "主要道路", roadName: "中山路", roadWidth: "18",
    schoolName: "金山國小", schoolDistance: "150", marketName: "金山市場", marketDistance: "30",
    parkName: "中山溫泉公園", parkDistance: "190", stationName: "金山區公所站", stationDistance: "80",
    districtName: "老街商圈", districtDistance: "0", disamenityName: "金山第一公墓", disamenityDistance: "260",
    parking: "可路邊停車", zoning: "第二種商業區", coverageRatio: "70%", plotRatio: "240%",
    buildRestriction: "無", sectionId: "P002-00",
    ...overrides,
  };
}

// ── crosswalk 完整性 ────────────────────────────────────────────────────────────
test("crosswalk:19 個契約 rate key 全被涵蓋", () => {
  assert.equal(RATE_KEYS.length, 19);
  assert.deepEqual([...RATE_KEYS].sort(), [...EXPECTED_RATE_KEYS].sort());
  // crosswalk 的 value(契約鍵)去重後,應是 19 鍵的子集且無多餘鍵。
  const mapped = new Set(Object.values(CLI_TO_RATE_KEY));
  for (const k of mapped) assert.ok(EXPECTED_RATE_KEYS.includes(k as never), `${k} 不在 19 鍵`);
});

// ── fixture(delta 全 0):結構正確 ───────────────────────────────────────────────
test("fixture(比較標的=比準地):ratesByLabel 每標的 19 鍵齊全且全 0", () => {
  const report = loadFixture();
  const perLabel = ratesByLabel(report);
  assert.equal(perLabel.length, 3); // 三個比較標的
  for (const { rates } of perLabel) {
    assert.deepEqual(Object.keys(rates).sort(), [...EXPECTED_RATE_KEYS].sort());
    for (const k of EXPECTED_RATE_KEYS) assert.equal(rates[k], 0, `${k} 應為 0`);
  }
});

test("fixture:mergeComparison 產出契約三塊、19 鍵、價格鏈(delta 0 → trialPrice = adjusted)", () => {
  const report = loadFixture();
  const cases: CaseMarketInput[] = report.comparableIdentities.map((c, i) => ({
    label: c.label,
    address: `標的${i + 1}`,
    condition: benchmarkCond(),
    normalPrice: 184763,
    regionalAdjRate: 0,
    weight: 100 / report.comparableIdentities.length,
  }));

  const { comparison, comparisonForm, computed } = mergeComparison({
    report,
    benchmark: benchmarkCond(),
    sectionId: "P002-00",
    cases,
    regionalTotal: 0,
  });

  // comparison(FactorRow[]):19 列、鍵齊全、rate 全 0。
  assert.equal(comparison.length, 19);
  assert.deepEqual(comparison.map((r) => r.key).sort(), [...EXPECTED_RATE_KEYS].sort());
  for (const row of comparison) assert.equal(row.rate, 0);

  // comparisonForm.cases:每筆 rates 19 鍵齊全;delta 0 → individualTotal 0 → trialPrice = adjusted。
  assert.equal(comparisonForm.cases.length, 3);
  for (const c of comparisonForm.cases) {
    assert.deepEqual(Object.keys(c.rates).sort(), [...EXPECTED_RATE_KEYS].sort());
    assert.equal(c.dateAdjRate, 0);
    assert.equal(c.adjustedPrice, 184763); // normalPrice × (1 + 0/100)
    assert.equal(c.trialPrice, 184763); // × (1+0) × (1+0)
    assert.equal(c.absRateSum, 0);
  }

  // computed 四欄齊全。
  assert.deepEqual(Object.keys(computed).sort(), ["dateAdj", "individualTotal", "regionalTotal", "trialPrice"]);
  assert.equal(computed.individualTotal, 0);
  assert.equal(computed.trialPrice, 184763);
  assert.equal(comparisonForm.benchmark.sectionId, "P002-00");
});

// ── 手工 FillReport(delta 非 0):delta → rate、價格鏈 ─────────────────────────────
// 造一份最小 FillReport:一個比較標的("1"),兩個 item —— depth(delta +3)與 roadType(delta +2)。
function nonZeroReport(): CliFillReport {
  const grade = (value: number) => ({ key: "x", raw: "x", value, rate: 1 });
  return {
    sectionIdBase: "P002-00",
    locationBase: "比準地",
    comparableIdentities: [{ label: "1", sectionId: "P003-00", location: "比較標的1" }],
    categories: [
      {
        categoryKey: "lotCondition",
        categoryRaw: "宗地條件",
        items: [
          {
            categoryKey: "lotCondition", categoryRaw: "宗地條件",
            itemKey: "depth", itemRaw: "深度",
            base: { key: "depth", raw: "深度", value: "23", selectedGrade: grade(0) },
            comparables: [
              { label: "1", item: { key: "depth", raw: "深度", value: "16", selectedGrade: grade(-3) }, delta: 3 },
            ],
          },
        ],
      },
      {
        categoryKey: "roadCondition",
        categoryRaw: "道路條件",
        items: [
          {
            categoryKey: "roadCondition", categoryRaw: "道路條件",
            itemKey: "roadType", itemRaw: "道路種類",
            base: { key: "roadType", raw: "道路種類", value: "主要道路", selectedGrade: grade(0) },
            comparables: [
              { label: "1", item: { key: "roadType", raw: "道路種類", value: "次要道路", selectedGrade: grade(-2) }, delta: 2 },
            ],
          },
        ],
      },
    ],
  };
}

test("delta 非 0:delta → 對應 rate key(depth=3, roadType=2),其餘 0", () => {
  const [{ rates }] = ratesByLabel(nonZeroReport());
  assert.equal(rates.depth, 3);
  assert.equal(rates.roadType, 2);
  // 其餘 17 鍵維持 0。
  for (const k of EXPECTED_RATE_KEYS) {
    if (k === "depth" || k === "roadType") continue;
    assert.equal(rates[k], 0, `${k} 應為 0`);
  }
  assert.equal(signedRateSum(rates), 5); // 3 + 2
});

test("delta 非 0:價格鏈 + computed(individualTotal 5、含區域/日期調整)", () => {
  const report = nonZeroReport();
  const cases: CaseMarketInput[] = [
    {
      label: "1",
      address: "比較標的1",
      condition: benchmarkCond({ depth: "16", roadType: "次要道路", sectionId: "P003-00" }),
      normalPrice: 200000,
      dateAdjRate: 0,
      regionalAdjRate: -1, // 跨區段
      weight: 100,
    },
  ];
  const { comparisonForm, computed } = mergeComparison({
    report,
    benchmark: benchmarkCond(),
    sectionId: "P002-00",
    cases,
    regionalTotal: -1,
  });

  const c = comparisonForm.cases[0];
  const expectedAdjusted = Math.round(200000 * (1 + 0 / 100)); // 200000
  const expectedTrial = Math.round(expectedAdjusted * (1 + -1 / 100) * (1 + 5 / 100));
  assert.equal(c.adjustedPrice, expectedAdjusted);
  assert.equal(c.regionalAdjRate, -1);
  assert.equal(c.trialPrice, expectedTrial);
  assert.equal(c.absRateSum, 5);
  // 比較標的自己的宗地條件填進條件欄。
  assert.equal(c.depth, "16");
  assert.equal(c.roadType, "次要道路");

  assert.equal(computed.individualTotal, 5);
  assert.equal(computed.regionalTotal, -1);
  assert.equal(computed.trialPrice, expectedTrial);
  assert.equal(comparisonForm.benchmarkComparedPrice, expectedTrial); // weight 100%
});
