import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadData } from "../../src/districtSurvey/loadData.js";

test("loadData: returns undefined when given undefined", () => {
  assert.equal(loadData(undefined), undefined);
});

test("loadData: passes an object through unchanged", () => {
  const data = { landImprovement: { a: 1 } };
  assert.equal(loadData(data), data);
});

test("loadData: reads and JSON-parses the file at a given path", () => {
  const dir = mkdtempSync(join(tmpdir(), "loadData-test-"));
  const filePath = join(dir, "data.json");
  const data = { naturalConditions: { sunlight: { text: "普通" } } };
  writeFileSync(filePath, JSON.stringify(data));

  try {
    assert.deepEqual(loadData(filePath), data);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadData: throws when the given file path doesn't exist", () => {
  assert.throws(() => loadData("/nonexistent/path/does-not-exist.json"));
});
