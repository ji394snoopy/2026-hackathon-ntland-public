import type { PromptSections } from "../shared/claude.js";

function buildTaskDescription(groupLabel: string): string {
  return (
    `Below are this parcel's ${groupLabel} district-survey facts (地價區段勘查表), each with a ` +
    'Chinese label describing what it recorded (either by a human, source:"manual", or an ' +
    'automated facility/API lookup, source:"ai"). Map these facts onto the tool\'s fixed field ' +
    "structure, which mirrors this specific PDF template's printed layout for this category " +
    "exactly. Match by meaning (the fact's label and content), not by its JSON key — the " +
    "survey's key names are an internal convention that won't line up with the tool schema's " +
    "field names."
  );
}

const EMPTY_VALUE_INSTRUCTION =
  'A fact with an empty value (source:"empty", typically with origin "AI 查無資料，需人工現場' +
  '確認") means no data was ever collected — map it to that field\'s empty/absent form ' +
  "(isExist:false with name omitted for a facility row, text:\"\" for a text row) rather than " +
  "guessing or inventing content.";

const PLACEHOLDER_INSTRUCTION =
  "Most facility rows (utilityGasFacility, funeralFacility, wasteFacility, majorStation, " +
  "interchange, touristRecreationFacility, parkingArea, proximityToServiceFacility, " +
  "wastewaterTreatmentFacility, school, market, parkPlazaPedestrianZone, " +
  "environmentalPollution) start out pre-printed on the PDF as either a 無/○ placeholder or a " +
  "blank cell, and the fill step only overwrites that when isExist is true — so when the " +
  "survey says a specific thing does not exist (e.g. \"無交流道\", a pollution type recorded as " +
  '"無"), set isExist:false and leave name empty; do not put the negative statement itself into ' +
  "name. busStop (站牌) is the one exception — it is always printed fresh, so always give it a " +
  "real name.";

const FIXED_ORDER_INSTRUCTION =
  "Several fields bundle multiple fixed-order sub-items into one array — position matters more " +
  "than the survey's own ordering, so place each fact by which named sub-item it matches, not " +
  "by the order facts happen to appear in below:\n" +
  "  - majorStation (4): 高鐵站, 火車站, 客運站(國光客運/統聯等客運站), 捷運站\n" +
  "  - school (4): 國小, 國中, 高中, 大專院校\n" +
  "  - market (3): 傳統市場, 超級市場, 超大型購物中心\n" +
  "  - parkPlazaPedestrianZone (3): 里鄰公園, 一般公園, 廣場.徒步區\n" +
  "  - utilityGasFacility (2): 變電所或高壓鐵塔, 瓦斯槽或儲油槽\n" +
  "  - funeralFacility (4): 墓地, 殯儀館, 火葬場, 納骨塔\n" +
  "  - wasteFacility (3): 污水處理場, 垃圾場或掩埋場, 焚化爐\n" +
  "  - environmentalPollution (5): 水污染, 噪音污染, 廢氣污染, 廢棄物污染, 其他污染\n" +
  "A survey fact naming only one specific instance (e.g. one named market) still only fills the " +
  "single best-matching sub-item slot above; leave the other slots in that group isExist:false.";

const QUANTITY_INSTRUCTION =
  "commercialActivity's four facility-with-count fields (departmentStore, financialInstitution, " +
  "entertainmentFacility, exhibitionCenterOrHotel) always need a quantity when isExist is true — " +
  'read an explicit count from the survey text when one is given (e.g. "數量1" → 1, "共3家" → 3), ' +
  "and default to 1 when isExist is true but the survey gives no count at all. Never omit " +
  "quantity when isExist is true, and never include it when isExist is false.";

const CHECKBOX_INSTRUCTION =
  "landImprovement's two groups (buildingSiteImprovement, farmlandImprovement) and " +
  "landUseStatus's own field are checkbox lists over a fixed option vocabulary (see each " +
  "field's own description for the exact options and order) plus a trailing free-text \"other\" " +
  "row. If the survey fact's value names specific selected options (matched against that fixed " +
  "vocabulary), set checked:true only for those items; anything named that isn't in the fixed " +
  "vocabulary goes into other (checked:true, text:<that description>) instead of being dropped. " +
  "An empty/no-data fact means every item and other are all checked:false.";

const EXAMPLE = JSON.stringify(
  {
    trafficAndTransport: {
      mainRoad: { value: { label: "中山路", value: 18 } },
      interchange: { value: { name: "", isExist: false } },
      majorStation: {
        items: [
          { value: { name: "", isExist: false } },
          { value: { name: "", isExist: false } },
          { value: { name: "國光客運金山站", isExist: true, inSection: false, distanceValue: 300 } },
          { value: { name: "", isExist: false } },
        ],
      },
      busStop: { value: { name: "金山區公所站", inSection: true, densityLevel: 1 } },
    },
    landUseRegulation: {
      insideOutsideUrbanPlan: { value: { text: "都市計畫內" } },
      buildingCoverageRatio: { value: { text: "70%" } },
    },
    landImprovement: {
      buildingSiteImprovement: {
        items: [
          { checked: false },
          { checked: false },
          { checked: false },
          { checked: false },
          { checked: false },
          { checked: false },
        ],
        other: { checked: false },
      },
    },
  },
  null,
  2,
);

// Byte-for-byte identical on every one of fillDistrictSurvey's 6 sequential calls per run (both
// the solo-category and merged-group prompt builders below use it verbatim) — split out as its
// own cacheable prefix (see PromptSections/claude.ts's cache_control checkpoint) so Bedrock can
// serve it from cache instead of reprocessing it on calls 2-6, which keeps this pipeline's TPM
// usage down. Dynamic, per-call content (task description, facts) stays out of this block and
// goes last, since a cache checkpoint only covers a contiguous static prefix.
const STATIC_INSTRUCTIONS = [
  EMPTY_VALUE_INSTRUCTION,
  "",
  PLACEHOLDER_INSTRUCTION,
  "",
  FIXED_ORDER_INSTRUCTION,
  "",
  QUANTITY_INSTRUCTION,
  "",
  CHECKBOX_INSTRUCTION,
  "",
  "Partial example showing the placeholder/gated shape, a split label+number field, a plain " +
    "text field, and an all-unchecked checkbox group (drawn from other categories, for " +
    "illustration of the general pattern only — every field the relevant category's own schema " +
    "requires must still be filled in):",
  EXAMPLE,
].join("\n");

function buildPrompt(groupLabel: string, categoryFacts: unknown[]): PromptSections {
  return {
    static: STATIC_INSTRUCTIONS,
    dynamic: [
      buildTaskDescription(groupLabel),
      "",
      `${groupLabel} district-survey facts for this case:`,
      JSON.stringify(categoryFacts, null, 2),
    ].join("\n"),
  };
}

interface GroupPromptSection {
  categoryKey: string;
  groupLabel: string;
  facts: unknown[];
}

function buildGroupTaskDescription(sections: GroupPromptSection[]): string {
  const categoryKeys = sections.map((s) => s.categoryKey);
  const groupLabels = sections.map((s) => s.groupLabel).join("、");
  return (
    `Below are this parcel's district-survey facts (地價區段勘查表) for ${sections.length} ` +
    `categories in one call: ${groupLabels}. Each fact carries a Chinese label describing what ` +
    'it recorded (either by a human, source:"manual", or an automated facility/API lookup, ' +
    "source:\"ai\"). Map each category's facts onto that category's own field structure, which " +
    "mirrors this specific PDF template's printed layout for that category exactly. Match by " +
    "meaning (the fact's label and content), not by its JSON key — the survey's key names are " +
    "an internal convention that won't line up with the tool schema's field names. This call " +
    "covers multiple categories at once — put each category's fields under its own top-level " +
    `key in the tool call (${categoryKeys.join(", ")}), matching the category each fact's ` +
    "section below belongs to; never mix a fact into a different category's key."
  );
}

function buildGroupPrompt(sections: GroupPromptSection[]): PromptSections {
  return {
    static: STATIC_INSTRUCTIONS,
    dynamic: [
      buildGroupTaskDescription(sections),
      "",
      ...sections.flatMap((section) => [
        `${section.categoryKey} (${section.groupLabel}) district-survey facts for this case:`,
        JSON.stringify(section.facts, null, 2),
        "",
      ]),
    ].join("\n"),
  };
}

export { buildPrompt, buildGroupPrompt };
export type { GroupPromptSection };
