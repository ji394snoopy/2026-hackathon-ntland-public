import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, buildGroupPrompt } from "../../src/fillDistrictSurvey/prompt.js";
import type { PromptSections } from "../../src/shared/claude.js";

// buildPrompt/buildGroupPrompt now split their output into a cacheable static prefix and a
// dynamic remainder (see PromptSections) — join them back into one string for assertions that
// don't care which half a given piece of text lives in.
function text(sections: PromptSections): string {
  return `${sections.static}\n${sections.dynamic}`;
}

const GROUP_LABEL = "土地使用管制";
const CATEGORY_FACTS = [
  { key: "urban_plan", label: "都市計畫(內外)", group: GROUP_LABEL, value: "都市計畫內", source: "manual" },
];

test("buildPrompt: includes only the given category's facts, verbatim", () => {
  const prompt = text(buildPrompt(GROUP_LABEL, CATEGORY_FACTS));
  assert.ok(prompt.includes(JSON.stringify(CATEGORY_FACTS, null, 2)));
});

test("buildPrompt: names the category's own group label in the task description", () => {
  const prompt = text(buildPrompt(GROUP_LABEL, CATEGORY_FACTS));
  assert.ok(prompt.includes(GROUP_LABEL));
});

test("buildPrompt: instructs matching by meaning rather than by JSON key", () => {
  const prompt = text(buildPrompt(GROUP_LABEL, CATEGORY_FACTS));
  assert.match(prompt, /match by meaning/i);
  assert.match(prompt, /not by its json key/i);
});

test("buildPrompt: instructs leaving placeholder-gated facility rows alone when isExist is false", () => {
  const prompt = text(buildPrompt(GROUP_LABEL, CATEGORY_FACTS));
  assert.match(prompt, /isExist:false/);
  assert.match(prompt, /busStop.*exception/i);
});

test("buildPrompt: states the fixed printed order for every grouped-item field", () => {
  const prompt = text(buildPrompt(GROUP_LABEL, CATEGORY_FACTS));
  for (const order of [
    "高鐵站, 火車站, 客運站",
    "國小, 國中, 高中, 大專院校",
    "傳統市場, 超級市場, 超大型購物中心",
    "里鄰公園, 一般公園, 廣場.徒步區",
    "變電所或高壓鐵塔, 瓦斯槽或儲油槽",
    "墓地, 殯儀館, 火葬場, 納骨塔",
    "污水處理場, 垃圾場或掩埋場, 焚化爐",
    "水污染, 噪音污染, 廢氣污染, 廢棄物污染, 其他污染",
  ]) {
    assert.ok(prompt.includes(order), `expected prompt to state fixed order: ${order}`);
  }
});

test("buildPrompt: CHECKBOX_INSTRUCTION mentions landUseStatus alongside landImprovement's two groups", () => {
  const prompt = text(buildPrompt(GROUP_LABEL, CATEGORY_FACTS));
  assert.match(prompt, /landUseStatus/);
});

test("buildPrompt: static section is byte-for-byte identical across categories, so it's cacheable as a shared prefix", () => {
  const a = buildPrompt("土地使用管制", CATEGORY_FACTS);
  const b = buildPrompt("交通運輸", [{ key: "main_road", label: "主要道路", group: "交通運輸", value: "中山路" }]);
  assert.equal(a.static, b.static);
  assert.notEqual(a.dynamic, b.dynamic);
});

const GROUP_SECTIONS = [
  {
    categoryKey: "landUseRegulation" as const,
    groupLabel: "土地使用管制",
    facts: [{ key: "urban_plan", label: "都市計畫(內外)", group: "土地使用管制", value: "都市計畫內" }],
  },
  {
    categoryKey: "naturalConditions" as const,
    groupLabel: "自然條件",
    facts: [{ key: "sunlight", label: "日照", group: "自然條件", value: "良好" }],
  },
];

test("buildGroupPrompt: includes every section's facts verbatim, under its own categoryKey/groupLabel heading", () => {
  const prompt = text(buildGroupPrompt(GROUP_SECTIONS));
  for (const section of GROUP_SECTIONS) {
    assert.ok(prompt.includes(section.categoryKey));
    assert.ok(prompt.includes(section.groupLabel));
    assert.ok(prompt.includes(JSON.stringify(section.facts, null, 2)));
  }
});

test("buildGroupPrompt: keeps the shared instructions present exactly once", () => {
  const prompt = text(buildGroupPrompt(GROUP_SECTIONS));
  assert.match(prompt, /match by meaning/i);
  assert.match(prompt, /isExist:false/);
  assert.ok(prompt.includes("高鐵站, 火車站, 客運站"));

  const occurrences = (prompt.match(/match by meaning/gi) ?? []).length;
  assert.equal(occurrences, 1);
});

test("buildGroupPrompt: instructs routing each category's fields under its own top-level key", () => {
  const prompt = text(buildGroupPrompt(GROUP_SECTIONS));
  assert.match(prompt, /top-level key/i);
  assert.ok(prompt.includes("landUseRegulation"));
  assert.ok(prompt.includes("naturalConditions"));
});

test("buildGroupPrompt: static section matches buildPrompt's, so solo and group calls in the same run share one cache", () => {
  const groupPrompt = buildGroupPrompt(GROUP_SECTIONS);
  const soloPrompt = buildPrompt(GROUP_LABEL, CATEGORY_FACTS);
  assert.equal(groupPrompt.static, soloPrompt.static);
});
