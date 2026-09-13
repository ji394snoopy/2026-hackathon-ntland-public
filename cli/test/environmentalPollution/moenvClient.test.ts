import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMoenvUrl, readMoenvApiKey, parseMoenvArrayResponse } from "../../src/environmentalPollution/moenvClient.js";

// Real response captured from
// data.moenv.gov.tw/api/v2/aqx_p_432?limit=2&format=json&api_key=<real key>
// while surveying this module's data source (2026-09-07).
const AQI_SUCCESS_TEXT = JSON.stringify([
  {
    sitename: "汐止",
    county: "新北市",
    aqi: "38",
    longitude: "121.64081",
    latitude: "25.06624",
    siteid: "2",
  },
  {
    sitename: "基隆",
    county: "基隆市",
    aqi: "45",
    longitude: "121.760056",
    latitude: "25.129168",
    siteid: "1",
  },
]);

// Real error body captured from the same endpoint with a garbage api_key (HTTP 500) —
// a Chinese message directly prefixed to a JSON blob, not valid JSON on its own.
const BAD_KEY_ERROR_TEXT =
  '該 API KEY 不存在或是已經到期。{"success":false,"code":500,"s_message":"有錯請通知系統管理員。"}';

test("buildMoenvUrl: builds the expected URL for a dataset + apiKey, no extra params", () => {
  const url = buildMoenvUrl("aqx_p_432", "test-key-123");
  assert.equal(url, "https://data.moenv.gov.tw/api/v2/aqx_p_432?format=json&api_key=test-key-123");
});

test("buildMoenvUrl: appends extra params (e.g. limit/offset) correctly", () => {
  const url = buildMoenvUrl("aqx_p_432", "test-key-123", { limit: 2000, offset: 0 });
  assert.equal(
    url,
    "https://data.moenv.gov.tw/api/v2/aqx_p_432?format=json&api_key=test-key-123&limit=2000&offset=0",
  );
});

test("readMoenvApiKey: returns the key when MOENV_API_KEY is set in the given env", () => {
  assert.equal(readMoenvApiKey({ MOENV_API_KEY: "abc-123" }), "abc-123");
});

test("readMoenvApiKey: throws a clear error when MOENV_API_KEY is unset/empty", () => {
  assert.throws(() => readMoenvApiKey({}), /MOENV_API_KEY/);
  assert.throws(() => readMoenvApiKey({ MOENV_API_KEY: "" }), /MOENV_API_KEY/);
});

test("parseMoenvArrayResponse: parses a real captured success array correctly", () => {
  const result = parseMoenvArrayResponse(AQI_SUCCESS_TEXT);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    sitename: "汐止",
    county: "新北市",
    aqi: "38",
    longitude: "121.64081",
    latitude: "25.06624",
    siteid: "2",
  });
});

test("parseMoenvArrayResponse: throws a clear error on a real captured bad-key error body", () => {
  assert.throws(() => parseMoenvArrayResponse(BAD_KEY_ERROR_TEXT), /MOENV_API_KEY|not valid JSON/);
});

test("parseMoenvArrayResponse: throws a clear error when the body is valid JSON but not an array", () => {
  assert.throws(() => parseMoenvArrayResponse('{"foo":"bar"}'), /array/);
});
