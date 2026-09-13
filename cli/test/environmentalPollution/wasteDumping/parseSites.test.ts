import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWasteDumpingSites } from "../../../src/environmentalPollution/wasteDumping/parseSites.js";

// Real feature captured (via the `shapefile` package, big5-decoded) from the WR_P_244
// dataset's downloadable WDMS-WGS84-*.zip snapshot while surveying this module's data
// source (2026-09-07).
const WDMS_FEATURES = [
  {
    type: "Feature",
    properties: {
      案件編號: 20,
      縣市: "臺南市",
      行政區: "安南區",
      地址: null,
      場址名稱: "臺南市安南區神榕段328、349、349-1、349-5地號",
      Lon: 120.1777,
      Lat: 23.0731,
      廢棄物種類: "一般",
      最後更新日: "2026-05-06T16:00:00.000Z",
      土水列管: "否",
      現場狀態: "巡查紀錄文字",
    },
    geometry: { type: "Point", coordinates: [120.1777, 23.0731] },
  },
];

test("parseWasteDumpingSites: extracts fields from a real captured feature", () => {
  const result = parseWasteDumpingSites(WDMS_FEATURES);
  assert.deepEqual(result[0], {
    caseId: "20",
    county: "臺南市",
    district: "安南區",
    address: "",
    siteName: "臺南市安南區神榕段328、349、349-1、349-5地號",
    wasteKind: "一般",
    lastUpdated: "2026-05-06T16:00:00.000Z",
    soilWaterControlled: "否",
    siteStatus: "巡查紀錄文字",
    lon: 120.1777,
    lat: 23.0731,
  });
});

test("parseWasteDumpingSites: formats a real Date object (shapefile's DBF date parsing) as ISO, not toString()", () => {
  // Confirmed live: the `shapefile` package parses DBF date-typed fields into real
  // Date objects, not strings — a naive String(value) fallback produces
  // "Fri May 08 2026 00:00:00 GMT+0800 (Taiwan Standard Time)" instead of ISO.
  const result = parseWasteDumpingSites([
    {
      type: "Feature",
      properties: { 場址名稱: "x", Lon: 120.1, Lat: 23.1, 最後更新日: new Date("2026-05-08T00:00:00.000Z") },
      geometry: { type: "Point", coordinates: [120.1, 23.1] },
    },
  ]);
  assert.equal(result[0]!.lastUpdated, "2026-05-08T00:00:00.000Z");
});

test("parseWasteDumpingSites: skips a feature missing usable coordinates instead of throwing", () => {
  const result = parseWasteDumpingSites([
    { type: "Feature", properties: { 場址名稱: "bad", Lon: null, Lat: 23 }, geometry: null },
  ]);
  assert.equal(result.length, 0);
});
