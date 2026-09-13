import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPipeline, buildGroupedPipeline, GROUPS } from "../../src/fillDistrictSurvey/pipeline.js";
import { CATEGORY_KEYS } from "../../src/fillDistrictSurvey/tool.js";

const RAW_SURVEY_DATA = {
  survey: [
    { key: "urban_plan", label: "都市計畫(內外)", group: "土地使用管制", value: "都市計畫內" },
    { key: "main_road", label: "主要道路", group: "交通運輸", value: "中山路，寬度18M" },
    { key: "site_improvement", label: "基地改良", group: "土地改良", value: "整平" },
    { key: "gas_facility", label: "瓦斯設施", group: "特殊設施", value: "無" },
    { key: "other_factors", label: "其他影響因素", group: "其他影響因素", value: "" },
    { key: "building_density", label: "建築密度", group: "房屋建築現況", value: "95%" },
    { key: "land_use_status", label: "土地利用現況", group: "土地利用現況", value: "住商混合" },
  ],
};

test("buildPipeline: returns one pipeline per category, in CATEGORY_KEYS order", () => {
  const pipelines = buildPipeline(RAW_SURVEY_DATA);
  assert.deepEqual(
    pipelines.map((p) => p.categoryKey),
    [
      "landImprovement",
      "specialFacilities",
      "commercialActivity",
      "landUseRegulation",
      "trafficAndTransport",
      "publicInfrastructure",
      "environmentalPollution",
      "naturalConditions",
      "otherFactors",
      "buildingCondition",
      "landUseStatus",
    ],
  );
});

test("buildPipeline: each category's prompt only carries facts matching its own group label", () => {
  const pipelines = buildPipeline(RAW_SURVEY_DATA);
  const landUse = pipelines.find((p) => p.categoryKey === "landUseRegulation")!;
  assert.ok(landUse.promptText.dynamic.includes('"urban_plan"'));
  assert.ok(!landUse.promptText.dynamic.includes('"main_road"'));

  const traffic = pipelines.find((p) => p.categoryKey === "trafficAndTransport")!;
  assert.ok(traffic.promptText.dynamic.includes('"main_road"'));
  assert.ok(!traffic.promptText.dynamic.includes('"urban_plan"'));
});

test("buildPipeline: a 其他影響因素 fact reaches only the otherFactors pipeline", () => {
  const pipelines = buildPipeline(RAW_SURVEY_DATA);
  const otherFactors = pipelines.find((p) => p.categoryKey === "otherFactors")!;
  assert.ok(otherFactors.promptText.dynamic.includes('"other_factors"'));

  for (const pipeline of pipelines) {
    if (pipeline.categoryKey === "otherFactors") continue;
    assert.ok(!pipeline.promptText.dynamic.includes('"other_factors"'));
  }
});

test("buildPipeline: building_density (房屋建築現況) and land_use_status (土地利用現況) each reach only their own category", () => {
  const pipelines = buildPipeline(RAW_SURVEY_DATA);
  const buildingCondition = pipelines.find((p) => p.categoryKey === "buildingCondition")!;
  const landUseStatus = pipelines.find((p) => p.categoryKey === "landUseStatus")!;

  assert.ok(buildingCondition.promptText.dynamic.includes('"building_density"'));
  assert.ok(landUseStatus.promptText.dynamic.includes('"land_use_status"'));

  for (const pipeline of pipelines) {
    if (pipeline.categoryKey !== "buildingCondition") {
      assert.ok(!pipeline.promptText.dynamic.includes('"building_density"'));
    }
    if (pipeline.categoryKey !== "landUseStatus") {
      assert.ok(!pipeline.promptText.dynamic.includes('"land_use_status"'));
    }
  }
});

test("GROUPS: every categoryKey is a valid, non-duplicated CATEGORY_KEYS entry", () => {
  const flattened = GROUPS.flat();
  assert.equal(new Set(flattened).size, flattened.length);
  for (const categoryKey of flattened) {
    assert.ok((CATEGORY_KEYS as readonly string[]).includes(categoryKey), `unknown categoryKey: ${categoryKey}`);
  }
});

test("GROUPS: contains exactly the one merge confirmed safe against the real Bedrock API", () => {
  assert.deepEqual(GROUPS, [["landImprovement", "specialFacilities", "environmentalPollution"]]);
});

test("buildGroupedPipeline: returns one entry per GROUPS group, tool required keys match categoryKeys", () => {
  const groupPipelines = buildGroupedPipeline(RAW_SURVEY_DATA);
  assert.equal(groupPipelines.length, GROUPS.length);
  groupPipelines.forEach((groupPipeline, i) => {
    const expectedCategoryKeys = GROUPS[i]!;
    assert.deepEqual(groupPipeline.categoryKeys, expectedCategoryKeys);
    const schema = groupPipeline.tool.input_schema as { required: string[] };
    assert.deepEqual(schema.required.sort(), [...expectedCategoryKeys].sort());
  });
});

test("buildGroupedPipeline: each group's promptText carries facts from all its member categories, but no others", () => {
  const groupPipelines = buildGroupedPipeline(RAW_SURVEY_DATA);
  const landImprovementGroup = groupPipelines.find((g) => g.categoryKeys.includes("landImprovement"))!;
  assert.ok(landImprovementGroup.promptText.dynamic.includes('"site_improvement"'));
  assert.ok(landImprovementGroup.promptText.dynamic.includes('"gas_facility"'));
  assert.ok(!landImprovementGroup.promptText.dynamic.includes('"urban_plan"'));
  assert.ok(!landImprovementGroup.promptText.dynamic.includes('"main_road"'));
});
