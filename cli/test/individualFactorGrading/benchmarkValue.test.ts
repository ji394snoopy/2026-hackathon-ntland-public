import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveBenchmarkValue } from "../../src/individualFactorGrading/benchmarkValue.js";
import type { Benchmark } from "../../src/individualFactorGrading/benchmarkValue.js";

const BENCHMARK: Benchmark = {
  location: "新北市金山區金美段489地號",
  area: "113.21",
  width: "5",
  depth: "23",
  shape: "方形",
  frontage: "單面臨街",
  terrain: "平坦",
  roadType: "主要道路",
  roadName: "中山路",
  roadWidth: "18",
  schoolName: "金山國小",
  schoolDistance: "150",
  marketName: "金山區第一零售傳統市場",
  marketDistance: "0",
  parkName: "中山溫泉里郡公園",
  parkDistance: "0",
  stationName: "金山區公所站",
  stationDistance: "0",
  districtName: "老街商圈",
  districtDistance: "0",
  disamenityName: "金山第1公墓",
  disamenityDistance: "80",
  parking: "可路邊停車",
  zoning: "第二種商業區",
  coverageRatio: "70%",
  plotRatio: "240%",
  buildRestriction: "無",
  sectionId: "P002-00",
};

test("deriveBenchmarkValue: bare numeric/text fields pass through verbatim", () => {
  assert.equal(deriveBenchmarkValue("area", BENCHMARK), "113.21");
  assert.equal(deriveBenchmarkValue("width", BENCHMARK), "5");
  assert.equal(deriveBenchmarkValue("depth", BENCHMARK), "23");
  assert.equal(deriveBenchmarkValue("shape", BENCHMARK), "方形");
  assert.equal(deriveBenchmarkValue("terrain", BENCHMARK), "平坦");
  assert.equal(deriveBenchmarkValue("roadType", BENCHMARK), "主要道路");
  assert.equal(deriveBenchmarkValue("parkingConvenience", BENCHMARK), "可路邊停車");
  assert.equal(deriveBenchmarkValue("zoningDesignation", BENCHMARK), "第二種商業區");
  assert.equal(deriveBenchmarkValue("buildingCoverageRatio", BENCHMARK), "70%");
  assert.equal(deriveBenchmarkValue("floorAreaRatio", BENCHMARK), "240%");
  assert.equal(deriveBenchmarkValue("buildingProhibitionOrRestriction", BENCHMARK), "無");
});

test("deriveBenchmarkValue: roadFrontageCondition maps from the frontage field", () => {
  assert.equal(deriveBenchmarkValue("roadFrontageCondition", BENCHMARK), "單面臨街");
});

test("deriveBenchmarkValue: name+distance facility items return separate name/distance/unit fields, not a merged string", () => {
  assert.deepEqual(deriveBenchmarkValue("frontageRoadWidth", BENCHMARK), {
    name: "中山路",
    distance: "18",
    unit: "M",
  });
  assert.deepEqual(deriveBenchmarkValue("proximityToSchool", BENCHMARK), {
    name: "金山國小",
    distance: "150",
    unit: "M",
  });
  assert.deepEqual(deriveBenchmarkValue("proximityToMarket", BENCHMARK), {
    name: "金山區第一零售傳統市場",
    distance: "0",
    unit: "M",
  });
  assert.deepEqual(deriveBenchmarkValue("proximityToParkPlaza", BENCHMARK), {
    name: "中山溫泉里郡公園",
    distance: "0",
    unit: "M",
  });
  assert.deepEqual(deriveBenchmarkValue("proximityToStation", BENCHMARK), {
    name: "金山區公所站",
    distance: "0",
    unit: "M",
  });
  assert.deepEqual(deriveBenchmarkValue("proximityToCommercialDistrict", BENCHMARK), {
    name: "老街商圈",
    distance: "0",
    unit: "M",
  });
  assert.deepEqual(deriveBenchmarkValue("presenceOfNoxiousFacility", BENCHMARK), {
    name: "金山第1公墓",
    distance: "80",
    unit: "M",
  });
});

test("deriveBenchmarkValue: a name+distance item with an empty name returns null", () => {
  const noSchool: Benchmark = { ...BENCHMARK, schoolName: "" };
  assert.equal(deriveBenchmarkValue("proximityToSchool", noSchool), null);
});

test("deriveBenchmarkValue: unknown itemKey returns null", () => {
  assert.equal(deriveBenchmarkValue("doesNotExist", BENCHMARK), null);
});

test("deriveBenchmarkValue: an empty-string source field returns null", () => {
  const emptyShape: Benchmark = { ...BENCHMARK, shape: "" };
  assert.equal(deriveBenchmarkValue("shape", emptyShape), null);
});
