import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "../../src/regionalFactorGrading/prompt.js";
import type { RegionalFactorsTree } from "../../src/regionalFactorGrading/resolveGrades.js";

const SAMPLE_DATA = {
  landUseRegulation: {
    buildingCoverageRatio: { value: { type: "number", value: 45, unit: "%" } },
  },
};

const REGIONAL_FACTORS_TREE: RegionalFactorsTree = {
  raw: "區域因素",
  categories: [
    {
      key: "landUseRegulation",
      raw: "土地使用管制",
      items: [
        {
          key: "buildingCoverageRatio",
          raw: "建蔽率",
          grades: [
            {
              key: "superior",
              raw: "優",
              value: 0,
              criteria: { type: "range", raw: "60%以上", min: 60, max: null, unit: "%" },
            },
          ],
        },
      ],
    },
  ],
};

test("buildPrompt: includes the sample-data JSON verbatim", () => {
  const prompt = buildPrompt(SAMPLE_DATA, REGIONAL_FACTORS_TREE);
  assert.ok(prompt.includes(JSON.stringify(SAMPLE_DATA, null, 2)));
});

test("buildPrompt: includes the factor-standard regionalFactors JSON verbatim", () => {
  const prompt = buildPrompt(SAMPLE_DATA, REGIONAL_FACTORS_TREE);
  assert.ok(prompt.includes(JSON.stringify(REGIONAL_FACTORS_TREE, null, 2)));
});

test("buildPrompt: instructs not to force a grade without matching data", () => {
  const prompt = buildPrompt(SAMPLE_DATA, REGIONAL_FACTORS_TREE);
  assert.match(prompt, /do not|don't/i);
  assert.match(prompt, /omit|skip/i);
});

test("buildPrompt: instructs extracting evidence rather than picking a grade directly", () => {
  const prompt = buildPrompt(SAMPLE_DATA, REGIONAL_FACTORS_TREE);
  assert.match(prompt, /evidence/i);
  assert.match(prompt, /not the grade itself|not.{0,20}grade/i);
});

test("buildPrompt: instructs emitting one evidence entry per matching fact and that the closest one governs", () => {
  const prompt = buildPrompt(SAMPLE_DATA, REGIONAL_FACTORS_TREE);
  assert.match(prompt, /one (evidence )?entry per/i);
  assert.match(prompt, /closest/i);
});

test("buildPrompt: instructs reporting a single-fact 無/absence as boolean evidence, not omitting it", () => {
  const prompt = buildPrompt(SAMPLE_DATA, REGIONAL_FACTORS_TREE);
  assert.match(prompt, /present["']?\s*:\s*false/i);
  assert.match(prompt, /only (survey field|fact)|single (survey field|fact)/i);
});
