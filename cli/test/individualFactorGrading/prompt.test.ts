import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "../../src/individualFactorGrading/prompt.js";
import type { IndividualFactorsTree } from "../../src/individualFactorGrading/resolveGrades.js";

const SAMPLE_DATA = {
  benchmark: {
    area: "113.21",
    shape: "方形",
  },
};

const INDIVIDUAL_FACTORS_TREE: IndividualFactorsTree = {
  raw: "個別因素",
  categories: [
    {
      key: "lotCondition",
      raw: "宗地條件",
      items: [
        {
          key: "area",
          raw: "面積",
          grades: [
            {
              key: "superior",
              raw: "優",
              value: 0,
              criteria: { type: "range", raw: "93m2以上", min: 93, max: null, unit: "m2" },
            },
          ],
        },
      ],
    },
  ],
};

test("buildPrompt: includes the sample-data JSON verbatim", () => {
  const prompt = buildPrompt(SAMPLE_DATA, INDIVIDUAL_FACTORS_TREE);
  assert.ok(prompt.includes(JSON.stringify(SAMPLE_DATA, null, 2)));
});

test("buildPrompt: includes the factor-standard individualFactors JSON verbatim", () => {
  const prompt = buildPrompt(SAMPLE_DATA, INDIVIDUAL_FACTORS_TREE);
  assert.ok(prompt.includes(JSON.stringify(INDIVIDUAL_FACTORS_TREE, null, 2)));
});

test("buildPrompt: instructs not to force a grade without matching data", () => {
  const prompt = buildPrompt(SAMPLE_DATA, INDIVIDUAL_FACTORS_TREE);
  assert.match(prompt, /do not|don't/i);
  assert.match(prompt, /omit|skip/i);
});

test("buildPrompt: instructs extracting evidence rather than picking a grade directly", () => {
  const prompt = buildPrompt(SAMPLE_DATA, INDIVIDUAL_FACTORS_TREE);
  assert.match(prompt, /evidence/i);
  assert.match(prompt, /not the grade itself|not.{0,20}grade/i);
});

test("buildPrompt: instructs emitting one evidence entry per matching fact and that the closest one governs", () => {
  const prompt = buildPrompt(SAMPLE_DATA, INDIVIDUAL_FACTORS_TREE);
  assert.match(prompt, /one (evidence )?entry per/i);
  assert.match(prompt, /closest/i);
});

test("buildPrompt: instructs reporting a single-fact 無/absence as boolean evidence, not omitting it", () => {
  const prompt = buildPrompt(SAMPLE_DATA, INDIVIDUAL_FACTORS_TREE);
  assert.match(prompt, /present["']?\s*:\s*false/i);
  assert.match(prompt, /only (benchmark field|fact)|single (benchmark field|fact)/i);
});
