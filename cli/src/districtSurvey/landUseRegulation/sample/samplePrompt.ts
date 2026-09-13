
const DATA_EXAMPLE = JSON.stringify(
  {
    insideOutsideUrbanPlan: {
      raw: "都市計畫（內外）",
      value: {
        type: "singleChoice",
        raw: "都市計畫內",
        selected: "insideUrbanPlan",
      },
    },
    zoningDesignation: {
      raw: "使用分區（使用地類別）",
      value: { type: "text", raw: "第二種商業區", text: "第二種商業區" },
    },
    buildingCoverageRatio: {
      raw: "建蔽率",
      value: { type: "number", raw: "70%", value: 70, unit: "%" },
    },
    floorAreaRatio: {
      raw: "容積率",
      value: { type: "number", raw: "240%", value: 240, unit: "%" },
    },
    buildingProhibition: {
      raw: "有無禁止建築",
      value: { type: "text", raw: "無", text: "無" },
    },
    buildingRestriction: {
      raw: "有無限制建築（整體開發、面積限制、高度限制）",
      value: { type: "text", raw: "無", text: "無" },
    },
  },
  null,
  2,
);

const CATEGORY_CONTEXT =
  "This PDF page is a Taiwanese (Traditional Chinese) 表1 地價區段勘查表 (district survey " +
  "table) for one price-zone. This call handles only the 土地使用管制 (land use regulation) " +
  "category block — one of several main-category blocks printed on the page — so extract " +
  "nothing from any other category. The tool has one fixed field per printed item, in this " +
  "printed order: insideOutsideUrbanPlan (都市計畫（內外）), zoningDesignation " +
  "(使用分區（使用地類別）), buildingCoverageRatio (建蔽率), floorAreaRatio (容積率), " +
  "buildingProhibition (有無禁止建築), and buildingRestriction " +
  "(有無限制建築（整體開發、面積限制、高度限制）). Fill in every field — none are optional.";

const IGNORE_ITEM_CODE_RULE =
  'Every item row is preceded by two small printed digits (e.g. "1 2", "1 5"). Their ' +
  "meaning is not confirmed — do not extract them at all; they have no field in the tool " +
  "schema.";

const ANSWER_TYPE_RULE =
  'Every plain item\'s "value" has a "type" field that says how to read its printed answer. ' +
  "raw always holds the exact printed cell text verbatim, for cross-checking consistency " +
  "against the other fields below — it is never the field downstream code reads as the value:\n" +
  '  - "text" — a bare descriptive sentence/label with no separate number, e.g. 無 or 第二種商業區. ' +
  "Set raw and text to the same content (or both to an empty string if nothing is printed).\n" +
  '  - "number" — a bare number with a trailing unit and no place-name/label attached, e.g. 70% ' +
  "for buildingCoverageRatio. Set value to the parsed number and unit to the trailing unit text.";

const URBAN_PLAN_RULE =
  "insideOutsideUrbanPlan's cell prints no checkbox options — this row's blank cell is filled in " +
  "with free text directly — but the answer always states one of two fixed outcomes. Set value's " +
  'raw to the exact printed/handwritten text (kept only for cross-checking selected — never read ' +
  'downstream), and set selected to "insideUrbanPlan" if it states 都市計畫內 (inside the urban ' +
  'plan), or "outsideUrbanPlan" if it states 都市計畫外 (outside the urban plan).';

const EXTRACTION_INSTRUCTION =
  "Extract every field into the extract_land_use_regulation_items tool, exactly as shown in the " +
  "example below.";

function buildPrompt(): string {
  return [
    CATEGORY_CONTEXT,
    "",
    IGNORE_ITEM_CODE_RULE,
    "",
    ANSWER_TYPE_RULE,
    "",
    URBAN_PLAN_RULE,
    "",
    EXTRACTION_INSTRUCTION,
    "",
    "Example of a fully-extracted 土地使用管制 category:",
    DATA_EXAMPLE,
  ].join("\n");
}

const GENERATION_CONTEXT =
  "There is no source document for this request. Invent one plausible, internally-consistent " +
  "土地使用管制 (land use regulation) category block for a fictional Taiwanese 表1 " +
  "地價區段勘查表 (district survey table) — pick your own zoning designation, ratios, and " +
  "restriction text, but keep every field's shape and semantics exactly as described below. The " +
  "tool has one fixed field per printed item: insideOutsideUrbanPlan (都市計畫（內外）), " +
  "zoningDesignation (使用分區（使用地類別）), buildingCoverageRatio (建蔽率), floorAreaRatio " +
  "(容積率), buildingProhibition (有無禁止建築), and buildingRestriction " +
  "(有無限制建築（整體開發、面積限制、高度限制）).";

const GENERATION_INSTRUCTION =
  "Generate one complete set of answers for every field listed above into the " +
  "extract_land_use_regulation_items tool. Use different values than the shape reference below " +
  "— do not copy it verbatim — while keeping each value's raw text consistent with its other " +
  "fields (e.g. selected must match what raw actually states, a number's raw must match its " +
  "parsed value/unit, and a text value's raw must match its text).";

function buildGenerationPrompt(): string {
  return [
    GENERATION_CONTEXT,
    "",
    ANSWER_TYPE_RULE,
    "",
    URBAN_PLAN_RULE,
    "",
    GENERATION_INSTRUCTION,
    "",
    "Shape reference (do not copy these exact values):",
    DATA_EXAMPLE,
  ].join("\n");
}

// 土地使用管制 (land use regulation) has essentially no correspondence to the
// nearby-facilities query (see plan §2.2), so pickFactsForCategory always hands this an
// empty slice and the fact-aware builder always falls back to the invent path. Kept for a
// uniform registry across all 8 categories.
function buildGenerationPromptFromFacts(_facts: unknown): string {
  return buildGenerationPrompt();
}

export { buildGenerationPrompt, buildGenerationPromptFromFacts, buildPrompt };

