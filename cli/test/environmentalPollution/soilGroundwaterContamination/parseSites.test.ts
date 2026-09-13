import { test } from "node:test";
import assert from "node:assert/strict";
import { parseContaminationSites } from "../../../src/environmentalPollution/soilGroundwaterContamination/parseSites.js";

// Real response captured from
// data.moenv.gov.tw/api/v2/ems_s_07?limit=2&format=json&api_key=<real key>
// while surveying this module's data source (2026-09-07).
const EMS_S_07_RECORDS = [
  {
    site_id: "A00002",
    site_name: "台北市北投區八仙段一小段三四四地號",
    county: "臺北市",
    township: "北投區",
    site_type: "農地",
    site_use: "種植農作物使用",
    pollutant: "土壤污染物：銅；地下水污染物：無",
    controltype: "公告解除控制場址",
    anno_date: "2002-10-04",
    sitearea: "7738",
    wgs84_lng: "121.508319428664",
    wgs84_lat: "25.1038071798673",
  },
];

test("parseContaminationSites: extracts and numeric-coerces a real captured site record", () => {
  const result = parseContaminationSites(EMS_S_07_RECORDS);
  assert.deepEqual(result[0], {
    site_id: "A00002",
    site_name: "台北市北投區八仙段一小段三四四地號",
    county: "臺北市",
    township: "北投區",
    site_type: "農地",
    site_use: "種植農作物使用",
    pollutant: "土壤污染物：銅；地下水污染物：無",
    controltype: "公告解除控制場址",
    anno_date: "2002-10-04",
    sitearea: 7738,
    lon: 121.508319428664,
    lat: 25.1038071798673,
  });
});

test("parseContaminationSites: skips a record missing usable coordinates instead of throwing", () => {
  const result = parseContaminationSites([{ site_name: "bad", wgs84_lng: "", wgs84_lat: "25" }]);
  assert.equal(result.length, 0);
});
