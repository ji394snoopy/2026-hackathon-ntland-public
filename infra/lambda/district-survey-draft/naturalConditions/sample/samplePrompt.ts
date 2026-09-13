
const DATA_EXAMPLE = JSON.stringify(
  {
    sunlight: {
      raw: "日照",
      value: { type: "text", raw: "充足", text: "充足" },
    },
    view: {
      raw: "景觀",
      value: { type: "text", raw: "普通", text: "普通" },
    },
    slope: {
      raw: "傾斜度",
      value: { type: "number", raw: "5%", value: 5, unit: "%" },
    },
    drainageQuality: {
      raw: "保（排）水之良否",
      value: { type: "text", raw: "尚可", text: "尚可" },
    },
    terrain: {
      raw: "地勢",
      value: { type: "text", raw: "平坦", text: "平坦" },
    },
    windCondition: {
      raw: "風勢",
      value: { type: "text", raw: "微風", text: "微風" },
    },
    soilQuality: {
      raw: "土質",
      value: { type: "text", raw: "壤土", text: "壤土" },
    },
  },
  null,
  2,
);

const CATEGORY_CONTEXT =
  "This PDF page is a Taiwanese (Traditional Chinese) 表1 地價區段勘查表 (district survey " +
  "table) for one price-zone. This call handles only the 自然條件 (natural conditions) " +
  "category block — one of several main-category blocks printed on the page — so extract " +
  "nothing from any other category. The tool has one fixed field per printed item, in this " +
  "printed order: sunlight (日照), view (景觀), slope (傾斜度), drainageQuality " +
  "(保（排）水之良否), terrain (地勢), windCondition (風勢), and soilQuality (土質). Fill in " +
  "every field — none are optional.";

const IGNORE_ITEM_CODE_RULE =
  'Every item row is preceded by two small printed digits (e.g. "1 5", "2 5"). Their ' +
  "meaning is not confirmed — do not extract them at all; they have no field in the tool " +
  "schema.";

const ANSWER_TYPE_RULE =
  'Every plain item\'s "value" has a "type" field that says how to read its printed answer. ' +
  "raw always holds the exact printed cell text verbatim, for cross-checking consistency " +
  "against the other fields below — it is never the field downstream code reads as the value:\n" +
  '  - "text" — a bare descriptive sentence/label with no separate number, e.g. 良好 or 平坦. ' +
  "Set raw and text to the same content (or both to an empty string if nothing is printed).\n" +
  '  - "number" — a bare number with a trailing unit and no place-name/label attached, e.g. 5% ' +
  "for slope. Set value to the parsed number and unit to the trailing unit text.";

const EXTRACTION_INSTRUCTION =
  "Extract every field into the extract_natural_conditions_items tool, exactly as shown in the " +
  "example below.";

function buildPrompt(): string {
  return [
    CATEGORY_CONTEXT,
    "",
    IGNORE_ITEM_CODE_RULE,
    "",
    ANSWER_TYPE_RULE,
    "",
    EXTRACTION_INSTRUCTION,
    "",
    "Example of a fully-extracted 自然條件 category:",
    DATA_EXAMPLE,
  ].join("\n");
}

const GENERATION_CONTEXT =
  "There is no source document for this request. Invent one plausible, internally-consistent " +
  "自然條件 (natural conditions) category block for a fictional Taiwanese 表1 地價區段勘查表 " +
  "(district survey table) — pick your own descriptive values, but keep every field's shape and " +
  "semantics exactly as described below. The tool has one fixed field per printed item: sunlight " +
  "(日照), view (景觀), slope (傾斜度), drainageQuality (保（排）水之良否), terrain (地勢), " +
  "windCondition (風勢), and soilQuality (土質).";

const GENERATION_INSTRUCTION =
  "Generate one complete set of answers for every field listed above into the " +
  "extract_natural_conditions_items tool. Use different values than the shape reference below " +
  "— do not copy it verbatim — while keeping each value's raw text consistent with its other " +
  "fields (e.g. a number's raw must match its parsed value/unit, and a text value's raw must " +
  "match its text).";

function buildGenerationPrompt(): string {
  return [
    GENERATION_CONTEXT,
    "",
    ANSWER_TYPE_RULE,
    "",
    GENERATION_INSTRUCTION,
    "",
    "Shape reference (do not copy these exact values):",
    DATA_EXAMPLE,
  ].join("\n");
}

// 自然條件 (natural conditions) has essentially no correspondence to the nearby-facilities
// query (see plan §2.2), so pickFactsForCategory always hands this an empty slice and the
// fact-aware builder always falls back to the invent path. Kept for a uniform registry
// across all 8 categories.
function buildGenerationPromptFromFacts(_facts: unknown): string {
  return buildGenerationPrompt();
}

export { buildGenerationPrompt, buildGenerationPromptFromFacts, buildPrompt };

