import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTownVillageXml } from "../../src/drainageQuality/resolveCity.js";

// Real response captured from api.nlsc.gov.tw/other/TownVillagePointQuery/121.4627/25.0111
// (Banqiao, New Taipei City) while surveying this module's data sources.
const BANQIAO_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<townVillageItem>
    <ctyCode>F</ctyCode>
    <ctyName>新北市</ctyName>
    <townCode>F14</townCode>
    <townName>板橋區</townName>
    <officeCode>FA</officeCode>
    <officeName>板橋</officeName>
    <sectCode>0188</sectCode>
    <sectName>新板段三小段</sectName>
    <villageCode>65000010070</villageCode>
    <villageName>福丘里</villageName>
</townVillageItem>`;

test("parseTownVillageXml: extracts ctyName/townName from a real captured response", () => {
  const result = parseTownVillageXml(BANQIAO_XML);
  assert.deepEqual(result, { ctyName: "新北市", townName: "板橋區" });
});

test("parseTownVillageXml: returns null for malformed/empty XML", () => {
  assert.equal(parseTownVillageXml(""), null);
  assert.equal(parseTownVillageXml("<not>the expected shape</not>"), null);
});
