import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWaterStations } from "../../../src/environmentalPollution/waterPollution/parseStations.js";

// Real response captured from
// data.moenv.gov.tw/api/v2/WQX_P_06?limit=2&format=json&api_key=<real key>
// while surveying this module's data source (2026-09-07). Field names carry a
// "twd97" prefix but are confirmed to be plain WGS84 decimal degrees (values in
// Taiwan's normal lon/lat range) — the actual TWD97 TM2 meters are the separate
// twd97tm2x/twd97tm2y fields, unused here.
const WQX_P_06_RECORDS = [
  {
    siteid: "1724",
    sitename: "歪仔歪橋",
    county: "宜蘭縣",
    township: "三星鄉",
    basin: "蘭陽溪流域",
    river: "羅東溪",
    twd97lon: "121.7530833",
    twd97lat: "24.7028333",
    statusofuse: "啟用",
  },
  {
    siteid: "1723",
    sitename: "佳德橋",
    county: "屏東縣",
    township: "牡丹鄉",
    basin: "牡丹溪流域",
    river: "牡丹溪",
    twd97lon: "120.8075833",
    twd97lat: "22.1448611",
    statusofuse: "停用",
  },
];

test("parseWaterStations: extracts and numeric-coerces a real captured station record", () => {
  const result = parseWaterStations(WQX_P_06_RECORDS);
  assert.deepEqual(result[0], {
    siteid: "1724",
    sitename: "歪仔歪橋",
    county: "宜蘭縣",
    township: "三星鄉",
    basin: "蘭陽溪流域",
    river: "羅東溪",
    statusofuse: "啟用",
    lon: 121.7530833,
    lat: 24.7028333,
  });
});

test("parseWaterStations: skips a record missing usable coordinates instead of throwing", () => {
  const result = parseWaterStations([{ siteid: "x", twd97lon: "", twd97lat: "22" }]);
  assert.equal(result.length, 0);
});
