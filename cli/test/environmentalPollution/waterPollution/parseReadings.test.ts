import { test } from "node:test";
import assert from "node:assert/strict";
import { pickLatestReadingForSite } from "../../../src/environmentalPollution/waterPollution/parseReadings.js";

// Shaped after a real response captured from
// data.moenv.gov.tw/api/v2/WQX_P_01?limit=...&sort=sampledate desc&format=json
// while surveying this module's data source (2026-09-07) — siteid/itemname query
// params are confirmed (live) to be silently ignored server-side, so this module
// always filters client-side across whatever batch was fetched.
const WQX_P_01_RECORDS = [
  {
    siteid: "1116",
    sitename: "大甲溪橋",
    sampledate: "2026-07-27 15:30:00",
    itemname: "河川污染分類指標",
    itemengabbreviation: "RPI",
    itemvalue: "1",
    itemunit: "",
  },
  {
    siteid: "1116",
    sitename: "大甲溪橋",
    sampledate: "2026-07-27 15:30:00",
    itemname: "水溫",
    itemengabbreviation: "WT",
    itemvalue: "27.6",
    itemunit: "℃",
  },
  {
    siteid: "1003",
    sitename: "關渡大橋",
    sampledate: "2026-07-07 09:35:02",
    itemname: "酸鹼值",
    itemengabbreviation: "pH",
    itemvalue: "7.23",
    itemunit: " ",
  },
  {
    siteid: "1116",
    sitename: "大甲溪橋",
    sampledate: "2026-04-01 10:00:00",
    itemname: "水溫",
    itemengabbreviation: "WT",
    itemvalue: "20.1",
    itemunit: "℃",
  },
];

test("pickLatestReadingForSite: filters to the given siteid and groups its most recent sampledate", () => {
  const result = pickLatestReadingForSite(WQX_P_01_RECORDS, "1116");
  assert.equal(result?.sampledate, "2026-07-27 15:30:00");
  assert.equal(result?.items.length, 2);
  assert.deepEqual(
    result?.items.map((i) => i.itemengabbreviation).sort(),
    ["RPI", "WT"],
  );
});

test("pickLatestReadingForSite: returns null when the siteid isn't present in the batch", () => {
  assert.equal(pickLatestReadingForSite(WQX_P_01_RECORDS, "9999"), null);
});
