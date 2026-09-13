const VALUE_READING_RULE =
  "Each grading item has a small price-correction-rate grid with one row and one column per grade " +
  "(優/稍優/普通/稍劣/劣, or just 優/劣 for 2-grade items). To read a grade's point value: use the " +
  "number in that grade's row, in the LEFTMOST column of the grid (the column for the 優 grade). " +
  "優's own value is always 0; lower grades are increasingly negative. Do not use any other column — " +
  "the grid is a full pairwise comparison matrix, and only the leftmost column gives each grade's " +
  "standalone value.";

const CRITERIA_VS_REMARKS_RULE =
  "Each sub-item carries two different pieces of Chinese text — do not merge or duplicate them. " +
  "備註 (remarks) is a single sentence shared by the whole item, describing what it measures overall, " +
  'e.g. "以宗地面積是否達最適開發規模衡量其優劣". Each grade also has its own short criteria text — ' +
  'the specific value, range, or condition that qualifies a case for that grade, e.g. "93m2以上" for ' +
  '優 and "未滿63m2" for 劣 on a 面積 item. Put the shared sentence in the item\'s remarks field and ' +
  "each grade's own qualifying text in that grade's criteria field; never copy the remarks sentence " +
  "into criteria.";

const CRITERIA_TYPE_RULE =
  "Every grade's criteria object has a \"type\" field that says how to read its qualifying text. " +
  "type is chosen per grade, not per item — grades within the same item can use different types " +
  '(e.g. 區段內有 on one grade is "enum" while the other grades of that same item are "range"). ' +
  "Always keep raw as the exact original Chinese criteria text no matter which type applies:\n" +
  '  - "enum" — a categorical label, e.g. 都市計畫內, 第二種商業區, 區段內有. Set value to the ' +
  "English key from the vocabulary below that matches raw exactly; only fall back to reusing the " +
  "Chinese text if no vocabulary entry matches.\n" +
  '  - "range" — a numeric threshold or band, e.g. 60%以上, 未滿63m2, 500m以上未滿1,000m. Parse the ' +
  'number(s) and set min/max to null for an open-ended bound (e.g. "60%以上" → min:60, max:null; ' +
  '"未滿63m2" → min:null, max:63; "500m以上未滿1,000m" → min:500, max:1000), and set unit to the ' +
  "trailing unit text (%, m, m2, ...).\n" +
  '  - "boolean" — a 有/無 (present/absent) pair, typically on a 有無... item. Set present to false ' +
  "for 無 and true for 有.";

const TABLE_STRUCTURE_DESCRIPTION =
  "This PDF is a Taiwanese (Traditional Chinese) land-value appraisal grading table with two " +
  "top-level tables:\n" +
  "  - 區域因素評價基準明細表 (regional factors) — main categories: 土地使用管制, 交通運輸,\n" +
  "    自然條件, 公共建設, 特殊設施, 環境汙染, 工商活動\n" +
  "  - 個別因素評價基準明細表 (individual factors) — main categories: 宗地條件, 道路條件,\n" +
  "    接近條件, 周邊環境條件, 行政條件\n" +
  "Each table has columns 主要項目 (main category) → 細項 (sub-item) → a price-correction-rate grid " +
  "per grade (優/稍優/普通/稍劣/劣) → 備註 (remarks, a one-sentence description of how the item is " +
  "graded).";

const EXTRACTION_INSTRUCTION =
  "Extract every main category, every sub-item within it, and every grade row for that sub-item " +
  "(including its own criteria text) into the extract_land_valuation_table tool. categories, items, " +
  "and grades are each arrays of entries carrying their own English key field (not objects keyed by " +
  "name) — see the example below. Put the regional-factors table under regionalFactors " +
  '(raw: "區域因素") and the individual-factors table under individualFactors (raw: "個別因素").';

const EXTRACTION_EXAMPLE = JSON.stringify(
  {
    key: "landUseRegulation",
    raw: "土地使用管制",
    items: [
      {
        key: "insideOutsideUrbanPlan",
        raw: "都市計畫內外",
        remarks: "以都市計畫內外來制定其優劣",
        grades: [
          {
            key: "superior",
            raw: "優",
            value: 0,
            criteria: {
              type: "enum",
              raw: "都市計畫內",
              value: "insideUrbanPlan",
            },
          },
          {
            key: "inferior",
            raw: "劣",
            value: -20,
            criteria: {
              type: "enum",
              raw: "都市計畫外",
              value: "outsideUrbanPlan",
            },
          },
        ],
      },
      {
        key: "buildingProhibition",
        raw: "有無禁止建築",
        remarks: "以區段內有無禁止建築來衡量其優劣等級",
        grades: [
          {
            key: "superior",
            raw: "優",
            value: 0,
            criteria: { type: "boolean", raw: "無", present: false },
          },
          {
            key: "inferior",
            raw: "劣",
            value: -40,
            criteria: { type: "boolean", raw: "有", present: true },
          },
        ],
      },
      {
        key: "buildingCoverageRatio",
        raw: "建蔽率",
        remarks: "以建蔽率高低來制定其優劣等級",
        grades: [
          {
            key: "superior",
            raw: "優",
            value: 0,
            criteria: {
              type: "range",
              raw: "60%以上",
              min: 60,
              max: null,
              unit: "%",
            },
          },
          {
            key: "inferior",
            raw: "劣",
            value: -10,
            criteria: {
              type: "range",
              raw: "未滿40%",
              min: null,
              max: 40,
              unit: "%",
            },
          },
        ],
      },
    ],
  },
  null,
  2,
);

const VOCABULARY_INSTRUCTION =
  "Use this English key vocabulary wherever a Chinese term below matches a category, sub-item, or " +
  "grade name, or an enum criteria value, in the document (exact string keys → camelCase English " +
  "key). This vocabulary is only for those four uses — never use it to translate remarks text or " +
  "range/boolean criteria, which always stay in the original Chinese/numbers. Category, sub-item, " +
  "and grade key fields only accept one of the fixed values the tool schema defines for that level " +
  "— every category, sub-item, and grade name printed on a standard grading table is covered by the " +
  "vocabulary below. For enum criteria values, reuse the original Chinese text as value only if no " +
  "vocabulary entry matches:";

function buildPrompt(keyMapping: Record<string, string>): string {
  return [
    TABLE_STRUCTURE_DESCRIPTION,
    "",
    VALUE_READING_RULE,
    "",
    CRITERIA_VS_REMARKS_RULE,
    "",
    CRITERIA_TYPE_RULE,
    "",
    EXTRACTION_INSTRUCTION,
    "",
    "Example of two fully-extracted sub-items, showing the remarks/criteria split, the value",
    "convention above, and the enum/range/boolean criteria types:",
    EXTRACTION_EXAMPLE,
    "",
    VOCABULARY_INSTRUCTION,
    JSON.stringify(keyMapping, null, 2),
  ].join("\n");
}

export { buildPrompt };
