import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArchiveResponse } from "../../src/windCondition/fetchWindHistory.js";

// Real response captured from
// archive-api.open-meteo.com/v1/archive?latitude=25.0111&longitude=121.4627&start_date=2025-08-20&end_date=2025-08-25&daily=windspeed_10m_max,winddirection_10m_dominant
// while surveying this module's data source.
const BANQIAO_RESPONSE = {
  latitude: 24.99121,
  longitude: 121.485466,
  daily_units: { time: "iso8601", windspeed_10m_max: "km/h", winddirection_10m_dominant: "°" },
  daily: {
    time: ["2025-08-20", "2025-08-21", "2025-08-22"],
    windspeed_10m_max: [9.9, 17.1, 13.2],
    winddirection_10m_dominant: [228, 134, 96],
  },
};

test("parseArchiveResponse: extracts dates/speed/direction from a real captured response", () => {
  const result = parseArchiveResponse(BANQIAO_RESPONSE);
  assert.deepEqual(result, {
    dates: ["2025-08-20", "2025-08-21", "2025-08-22"],
    windSpeedMaxKmh: [9.9, 17.1, 13.2],
    windDirectionDominantDeg: [228, 134, 96],
  });
});

test("parseArchiveResponse: throws on a response missing the daily block", () => {
  assert.throws(() => parseArchiveResponse({}));
  assert.throws(() => parseArchiveResponse({ daily: { time: "not-an-array" } }));
});
