
const DATA_EXAMPLE = JSON.stringify(
  {
    buildingSiteImprovement: {
      raw: "建築基地改良",
      items: [
        { raw: "整平或填挖基地", checked: true },
        { raw: "開挖水溝", checked: false },
        { raw: "水土保持", checked: true },
        { raw: "鋪築道路", checked: false },
        { raw: "埋設管道", checked: false },
        { raw: "修築駁嵌", checked: false },
      ],
      other: { checked: false, text: "" },
    },
    farmlandImprovement: {
      raw: "農地改良",
      items: [
        { raw: "耕地整理", checked: true },
        { raw: "水土保持", checked: false },
        { raw: "土壤改良", checked: false },
        { raw: "修築農路", checked: false },
        { raw: "灌溉", checked: true },
        { raw: "排水", checked: false },
        { raw: "防風", checked: false },
        { raw: "防砂", checked: false },
        { raw: "堤防", checked: false },
      ],
      other: { checked: true, text: "客土回填" },
    },
  },
  null,
  2,
);

const CATEGORY_CONTEXT =
  "This PDF page is a Taiwanese (Traditional Chinese) 表1 地價區段勘查表 (district survey " +
  "table) for one price-zone. This call handles only the 土地改良 (land improvement) category " +
  "block — one of several main-category blocks printed on the page, printed as two rows: " +
  "建築基地改良 (buildingSiteImprovement) and 農地改良 (farmlandImprovement) — so extract " +
  "nothing from any other category. Fill in every field — none are optional.";

const CHECKED_RULE =
  "Each group is a multi-select checkbox list: every item has its own □ checkbox, and any " +
  "number of a group's items can be checked (●/■/✓ or otherwise visibly marked) at once — " +
  "unlike the single-choice and existence-check patterns used elsewhere in this form. Set " +
  "checked to true only for items whose checkbox is actually marked; every other item in the " +
  "group is checked:false. raw is always the item's fixed printed label regardless of whether " +
  "it is checked.";

const GROUP_RULE =
  "buildingSiteImprovement's items must stay in this fixed printed order (6 entries): " +
  "整平或填挖基地, 開挖水溝, 水土保持, 鋪築道路, 埋設管道, 修築駁嵌. farmlandImprovement's " +
  "items must stay in this fixed printed order (9 entries): 耕地整理, 水土保持, 土壤改良, " +
  "修築農路, 灌溉, 排水, 防風, 防砂, 堤防. Set each group's raw to its own printed group label " +
  "(建築基地改良/農地改良), and put each item as its own entry in that group's items array " +
  "(never merge them), in this exact fixed order — see the example below.";

const OTHER_RULE =
  "Each group also prints a trailing 其他＿＿＿＿＿＿ option after its fixed-label items: a " +
  "□ checkbox followed by a blank for handwritten free text. This is a separate other field, " +
  "not a 7th/10th entry in items. other.checked is true only if 其他's own checkbox is marked. " +
  "other.text is the handwritten text filling the blank, if any; use an empty string if the " +
  "blank is empty or the checkbox is unmarked — text can be non-empty even when checked is " +
  "false only if something is written but the box itself isn't marked, though in practice they " +
  "normally agree.";

const EXTRACTION_INSTRUCTION =
  "Extract every field into the extract_land_improvement_items tool, exactly as shown in the " +
  "example below.";

function buildPrompt(): string {
  return [
    CATEGORY_CONTEXT,
    "",
    CHECKED_RULE,
    "",
    GROUP_RULE,
    "",
    OTHER_RULE,
    "",
    EXTRACTION_INSTRUCTION,
    "",
    "Example of a fully-extracted 土地改良 category:",
    DATA_EXAMPLE,
  ].join("\n");
}

const GENERATION_CONTEXT =
  "There is no source document for this request. Invent one plausible, internally-consistent " +
  "土地改良 (land improvement) category block for a fictional Taiwanese 表1 地價區段勘查表 " +
  "(district survey table) — pick your own checked items and, if you check 其他, your own " +
  "free-text answer — but keep every field's shape and semantics exactly as described below. " +
  "The category has two group fields (buildingSiteImprovement, farmlandImprovement).";

const GENERATION_INSTRUCTION =
  "Generate one complete set of answers for every field listed above into the " +
  "extract_land_improvement_items tool. Use different checked items/text than the shape " +
  "reference below — do not copy it verbatim — while keeping each group internally consistent " +
  "(e.g. other.checked:true should correspond to a non-empty other.text).";

function buildGenerationPrompt(): string {
  return [
    GENERATION_CONTEXT,
    "",
    CHECKED_RULE,
    "",
    GROUP_RULE,
    "",
    OTHER_RULE,
    "",
    GENERATION_INSTRUCTION,
    "",
    "Shape reference (do not copy these exact values):",
    DATA_EXAMPLE,
  ].join("\n");
}

// 土地改良 (land improvement) has essentially no correspondence to the nearby-facilities
// query (see plan §2.2), so pickFactsForCategory always hands this an empty slice and the
// fact-aware builder always falls back to the invent path. Kept for a uniform registry
// across all 8 categories.
function buildGenerationPromptFromFacts(_facts: unknown): string {
  return buildGenerationPrompt();
}

export { buildGenerationPrompt, buildGenerationPromptFromFacts, buildPrompt };

