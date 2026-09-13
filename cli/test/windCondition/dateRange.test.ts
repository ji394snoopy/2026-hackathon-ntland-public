import { test } from "node:test";
import assert from "node:assert/strict";
import { pastYearRange } from "../../src/windCondition/dateRange.js";

test("pastYearRange: endDate is exactly 7 days before today", () => {
  const { endDate } = pastYearRange(new Date("2026-09-04T00:00:00Z"));
  assert.equal(endDate, "2026-08-28");
});

test("pastYearRange: startDate..endDate spans exactly 365 calendar days inclusive", () => {
  const { startDate, endDate } = pastYearRange(new Date("2026-09-04T00:00:00Z"));
  const spanDays = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 + 1;
  assert.equal(spanDays, 365);
});

test("pastYearRange: rolls over a year/month boundary correctly", () => {
  const { startDate, endDate } = pastYearRange(new Date("2026-01-03T00:00:00Z"));
  assert.equal(endDate, "2025-12-27");
  assert.equal(startDate, "2024-12-28");
});
