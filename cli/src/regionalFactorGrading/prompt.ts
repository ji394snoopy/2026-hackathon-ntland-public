import type { RegionalFactorsTree } from "./resolveGrades.js";

const TASK_DESCRIPTION =
  "You are supplying the raw evidence needed to grade one land parcel's regional factors " +
  "(區域因素) for a Taiwanese (Traditional Chinese) 地價區段調查估價 appraisal — not the grade " +
  "itself, which is computed afterward in code from what you extract here. Below are two JSON " +
  "documents: a district survey (地價區段勘查表) describing the actual facts of this parcel's " +
  "section, and a grading table (區域因素評價基準明細表) defining, for every category/sub-item, " +
  "which grade (優/稍優/普通/稍劣/劣) applies under which criteria.";

const MATCHING_INSTRUCTION =
  "For every regionalFactors item where the district survey gives you enough information to " +
  "judge, add one entry to the grade_regional_factors tool's extractions array: { categoryKey, " +
  "itemKey, evidence }, using the exact key values from the grading table below (not the Chinese " +
  "labels). evidence reports the raw fact only — a number+unit for a distance/percentage " +
  '(type: "range"), a closed-vocabulary classification matching one of the grading table\'s enum ' +
  'criteria (type: "enum"), or a presence/absence flag (type: "boolean") — never which grade it ' +
  "resolves to. Match by meaning, not by field name — the district survey's JSON keys and " +
  'wording will often differ from the grading table\'s, e.g. a survey field named "busStop" with ' +
  'distance 153m maps to the grading item "proximityToBusStop", with evidence ' +
  '{ type: "range", value: 153, unit: "m" }.';

const ABSENCE_INSTRUCTION =
  "A survey fact stating that a specific named thing does not exist (e.g. \"無交流道\", or a " +
  "pollution type recorded as \"無\") is real evidence, not missing data — report it as " +
  '{ type: "boolean", present: false }, even when it is the only survey field feeding that item. ' +
  "This is different from genuinely unavailable data (an empty value, or \"AI 查無資料，需人工現場" +
  "確認\"), which should be omitted per the instruction below instead.";

const MULTI_FACT_INSTRUCTION =
  "Some items are fed by more than one named survey fact (e.g. a category combining several " +
  "distinct hazards, or several distinct pollution types, under one grading item). In that " +
  "case, add one entry per matching fact — present or absent — all sharing the same " +
  "categoryKey/itemKey — do not average or pick among them yourself. The closest one to the " +
  'parcel automatically governs the final grade downstream (an "in the section"/present fact ' +
  "counts as the closest possible; an absent fact counts as infinitely far).";

const NO_GUESS_INSTRUCTION =
  "Do not force evidence for an item the district survey has no bearing on — omit that item " +
  "from extractions entirely rather than guessing. Absence of matching data is not evidence of " +
  "the worst grade (劣); it just means that item should be skipped.";

function buildPrompt(
  sampleData: unknown,
  regionalFactors: RegionalFactorsTree,
): string {
  return [
    TASK_DESCRIPTION,
    "",
    MATCHING_INSTRUCTION,
    "",
    ABSENCE_INSTRUCTION,
    "",
    MULTI_FACT_INSTRUCTION,
    "",
    NO_GUESS_INSTRUCTION,
    "",
    "District survey (地價區段勘查表) facts for this parcel:",
    JSON.stringify(sampleData, null, 2),
    "",
    "Regional factors grading table (區域因素評價基準明細表):",
    JSON.stringify(regionalFactors, null, 2),
  ].join("\n");
}

export { buildPrompt };
