import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNoiseStations } from "../../../src/environmentalPollution/noisePollution/parseStations.js";

// Real response captured from
// data.moenv.gov.tw/api/v2/NOS_P_08?limit=2&format=json&api_key=<real key>
// while surveying this module's data source (2026-09-07).
const NOS_P_08_RECORDS = [
  {
    stationid: "0400120EN004",
    county: "新北市",
    stationname: "板橋中正路",
    areatype: "第三類",
    noisetype: "一般地區環境音量",
    address: "板橋區中正路370號對面玫瑰公園內",
    status: "使用中",
    sideroad: "中正路",
    sideroadwidth: "15",
    longitude: "121.455754",
    latitude: "25.023488",
  },
  {
    stationid: "0400120TN002",
    county: "新北市",
    stationname: "板橋永豐街",
    areatype: "第三類",
    noisetype: "道路交通噪音",
    address: "板橋市永豐街55巷62號對面華江公園內",
    status: "使用中",
    sideroad: "縣民大道",
    sideroadwidth: "20",
    longitude: "121.471831",
    latitude: "25.019198",
  },
];

test("parseNoiseStations: extracts and numeric-coerces a real captured station record", () => {
  const result = parseNoiseStations(NOS_P_08_RECORDS);
  assert.deepEqual(result[0], {
    stationid: "0400120EN004",
    county: "新北市",
    stationname: "板橋中正路",
    areatype: "第三類",
    noisetype: "一般地區環境音量",
    address: "板橋區中正路370號對面玫瑰公園內",
    status: "使用中",
    sideroad: "中正路",
    sideroadwidth: "15",
    lon: 121.455754,
    lat: 25.023488,
  });
});

test("parseNoiseStations: skips a record missing usable coordinates instead of throwing", () => {
  const result = parseNoiseStations([{ stationname: "bad", longitude: "", latitude: "25" }]);
  assert.equal(result.length, 0);
});
