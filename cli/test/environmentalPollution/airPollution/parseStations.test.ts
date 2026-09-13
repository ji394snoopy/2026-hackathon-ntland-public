import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAqiStations } from "../../../src/environmentalPollution/airPollution/parseStations.js";

// Real response captured from
// data.moenv.gov.tw/api/v2/aqx_p_432?limit=2&format=json&api_key=<real key>
// while surveying this module's data source (2026-09-07).
const AQI_RECORDS = [
  {
    sitename: "汐止",
    county: "新北市",
    aqi: "38",
    pollutant: "",
    status: "良好",
    publishtime: "2026/09/07 16:00:00",
    longitude: "121.64081",
    latitude: "25.06624",
    siteid: "2",
  },
  {
    sitename: "基隆",
    county: "基隆市",
    aqi: "45",
    pollutant: "",
    status: "良好",
    publishtime: "2026/09/07 16:00:00",
    longitude: "121.760056",
    latitude: "25.129168",
    siteid: "1",
  },
];

test("parseAqiStations: extracts and numeric-coerces a real captured AQI record", () => {
  const result = parseAqiStations(AQI_RECORDS);
  assert.deepEqual(result[0], {
    siteid: "2",
    sitename: "汐止",
    county: "新北市",
    aqi: 38,
    status: "良好",
    pollutant: "",
    publishtime: "2026/09/07 16:00:00",
    lon: 121.64081,
    lat: 25.06624,
  });
});

test("parseAqiStations: skips a record missing usable coordinates instead of throwing", () => {
  const result = parseAqiStations([{ sitename: "bad", longitude: "not-a-number", latitude: "25" }]);
  assert.equal(result.length, 0);
});
