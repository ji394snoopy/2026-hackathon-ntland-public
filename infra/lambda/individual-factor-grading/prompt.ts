import type { IndividualFactorsTree } from "../shared/grading/individualFactorGrading/resolveGrades.js";

const TASK_DESCRIPTION =
  "You are supplying the raw evidence needed to grade one land parcel's individual factors " +
  "(個別因素) for a Taiwanese (Traditional Chinese) 地價區段調查估價 appraisal — not the grade " +
  "itself, which is computed afterward in code from what you extract here. Below are two JSON " +
  "documents: this parcel's own benchmark/survey data (its lot, road frontage, and proximity " +
  "facts), and a grading table (個別因素評價基準明細表) defining, for every category/sub-item, " +
  "which grade (優/稍優/普通/稍劣/劣) applies under which criteria.";

const MATCHING_INSTRUCTION =
  "For every individualFactors item where the parcel data gives you enough information to " +
  "judge, add one entry to the grade_individual_factors tool's extractions array: { categoryKey, " +
  "itemKey, evidence }, using the exact key values from the grading table below (not the Chinese " +
  "labels). evidence reports the raw fact only — a number+unit for a distance/area/percentage " +
  '(type: "range"), a closed-vocabulary classification matching one of the grading table\'s enum ' +
  'criteria (type: "enum"), or a presence/absence flag (type: "boolean") — never which grade it ' +
  "resolves to. Match by meaning, not by field name — the parcel data's JSON keys and wording " +
  'will often differ from the grading table\'s, e.g. a benchmark field named "zoning" with value ' +
  '"第二種商業區" maps to the grading item "zoningDesignation", with evidence ' +
  '{ type: "enum", enumValue: "commercialZone" } (a subtype still belongs to its parent zone ' +
  "type when no more specific criteria value exists).";

// 個別因素評的是這一筆宗地自己,基準點是宗地(比準地),不是區段中心。benchmark 的
// *Distance 欄位已經是「距比準地」的值(produce-survey 挑的是離比準地最近的那筆設施),所以
// 優先讀 benchmark;真的要從 survey 取數字時才需要這條規則,別抓到區段中心那個距離。
const DISTANCE_BASIS_INSTRUCTION =
  "Distances: prefer the benchmark's own *Distance fields — they already measure from THIS " +
  "parcel. If you read a distance off the survey instead, its `items[]` entries may carry " +
  "two: `metersToCenter` (to the 地價區段's centre) and `metersToPoint` (to this parcel). " +
  "個別因素 grade the PARCEL, so use `metersToPoint` whenever it is present, and the number " +
  'in parentheses of a value like "金山國小，距150M（距比準地210M）" — i.e. 210, not 150. ' +
  "Fall back to the single/centre distance only when no parcel distance exists at all.";

const ABSENCE_INSTRUCTION =
  "A benchmark fact stating that a specific named thing does not exist (e.g. a build " +
  "restriction recorded as \"無\") is real evidence, not missing data — report it as " +
  '{ type: "boolean", present: false }, even when it is the only benchmark field feeding that ' +
  "item. This is different from genuinely unavailable data (an empty value), which should be " +
  "omitted per the instruction below instead.";

const MULTI_FACT_INSTRUCTION =
  "Some items could in principle be fed by more than one named fact. In that case, add one " +
  "entry per matching fact — present or absent — all sharing the same categoryKey/itemKey — do " +
  'not average or pick among them yourself. The closest one to the parcel automatically governs ' +
  "the final grade downstream (a present fact counts as the closest possible; an absent fact " +
  "counts as infinitely far).";

const NO_GUESS_INSTRUCTION =
  "Do not force evidence for an item the parcel data has no bearing on — omit that item from " +
  "extractions entirely rather than guessing. Absence of matching data is not evidence of the " +
  "worst grade (劣); it just means that item should be skipped.";

function buildPrompt(
  sampleData: unknown,
  individualFactors: IndividualFactorsTree,
): string {
  return [
    TASK_DESCRIPTION,
    "",
    MATCHING_INSTRUCTION,
    "",
    DISTANCE_BASIS_INSTRUCTION,
    "",
    ABSENCE_INSTRUCTION,
    "",
    MULTI_FACT_INSTRUCTION,
    "",
    NO_GUESS_INSTRUCTION,
    "",
    "Parcel benchmark/survey data (地價區段調查估價 case facts):",
    JSON.stringify(sampleData, null, 2),
    "",
    "Individual factors grading table (個別因素評價基準明細表):",
    JSON.stringify(individualFactors, null, 2),
  ].join("\n");
}

export { buildPrompt };
