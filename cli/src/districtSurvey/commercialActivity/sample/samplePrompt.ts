import type { CategoryFacts } from "../../shared/facts.js";
import { formatFactsForPrompt } from "../../shared/facts.js";

const DATA_EXAMPLE = JSON.stringify(
  {
    departmentStore: {
      raw: "百貨公司",
      value: {
        type: "departmentStore",
        raw: "百貨公司 名稱：喜互惠百貨 數量:1 ○本區段內 ○本區段外(距 M)",
        isExist: true,
        name: "喜互惠百貨",
        quantity: 1,
        inSection: true,
      },
    },
    financialInstitution: {
      raw: "金融機構",
      value: {
        type: "financialInstitution",
        raw: "金融機構 名稱：合作金庫嘉義分行 數量:2 ○本區段內 ○本區段外(距 M)",
        isExist: true,
        name: "合作金庫嘉義分行",
        quantity: 2,
        inSection: true,
      },
    },
    entertainmentFacility: {
      raw: "娛樂設施",
      value: {
        type: "entertainmentFacility",
        raw: "娛樂設施 名稱： 數量: ○本區段內 ○本區段外(距 M)",
        isExist: false,
        name: "",
      },
    },
    exhibitionCenterOrHotel: {
      raw: "大型展示中心或觀光飯店",
      value: {
        type: "exhibitionCenterOrHotel",
        raw: "大型展示中心或觀光飯店 名稱：耐斯王子大飯店 數量: ○本區段內 ●本區段外(距 650 M)",
        isExist: true,
        name: "耐斯王子大飯店",
        inSection: false,
        distanceValue: 650,
        distanceUnit: "M",
      },
    },
    customerTraffic: {
      raw: "顧客之通行量",
      value: {
        type: "text",
        raw: "尚可",
        text: "尚可",
      },
    },
    storeContiguity: {
      raw: "店鋪之毗連狀態",
      value: {
        type: "text",
        raw: "連續",
        text: "連續",
      },
    },
  },
  null,
  2,
);

const CATEGORY_CONTEXT =
  "This PDF page is a Taiwanese (Traditional Chinese) 表1 地價區段勘查表 (district survey " +
  "table) for one price-zone. This call handles only the 工商活動 (commercial activity) " +
  "category block — one of several main-category blocks printed on the page: four " +
  "名稱：+數量+checkbox facility items (百貨公司, 金融機構, 娛樂設施, 大型展示中心或觀光飯店) " +
  "plus two bare-text items (顧客之通行量, 店鋪之毗連狀態) — so extract nothing from any other " +
  "category. Fill in every field — none are optional.";

const FACILITY_ITEM_RULE =
  "百貨公司, 金融機構, 娛樂設施, 大型展示中心或觀光飯店 each use the facilityWithQuantityValue " +
  "type: a 名稱：answer plus a 數量 (quantity) count on one line, and the usual " +
  "本區段內/外(距 N M) checkboxes on the line below, with no leading existence checkbox of " +
  "their own:\n" +
  "  - isExist is true only when 名稱 is actually filled in, false when it is blank.\n" +
  "  - name is the printed 名稱：text only when isExist is true; leave it as an empty string " +
  "when isExist is false.\n" +
  "  - quantity is set only when isExist is true and a number is actually printed after 數量:.\n" +
  "  - inSection is true/false only when 本區段內 or 本區段外 is actually marked (●) — leave it " +
  "unset when neither is marked.\n" +
  "  - distanceValue/distanceUnit are set only when a distance number is actually printed (only " +
  "possible when 本區段外 is marked).\n" +
  "value.raw must always capture the exact printed cell text verbatim, including the 名稱/數量 " +
  "line and the checkbox line. Each item's type must match its own identity exactly " +
  "(departmentStore/financialInstitution/entertainmentFacility/exhibitionCenterOrHotel).";

const LEAF_ITEM_RULE =
  "顧客之通行量 and 店鋪之毗連狀態 print no checkbox, 名稱, or 數量 structure at all — just a " +
  "bare blank cell for a descriptive answer. Use the leafValue type: type is almost always " +
  '"text" for these two fields (a short descriptive phrase, or an empty string if the cell is ' +
  "blank). raw must capture the exact printed cell text verbatim, and text must hold that same " +
  "content — raw exists only for the model's own consistency cross-check, never read downstream.";

const EXTRACTION_INSTRUCTION =
  "Extract every field into the extract_commercial_activity_items tool, exactly as shown in the " +
  "example below.";

function buildPrompt(): string {
  return [
    CATEGORY_CONTEXT,
    "",
    FACILITY_ITEM_RULE,
    "",
    LEAF_ITEM_RULE,
    "",
    EXTRACTION_INSTRUCTION,
    "",
    "Example of a fully-extracted 工商活動 category:",
    DATA_EXAMPLE,
  ].join("\n");
}

const GENERATION_CONTEXT =
  "There is no source document for this request. Invent one plausible, internally-consistent " +
  "工商活動 (commercial activity) category block for a fictional Taiwanese 表1 地價區段勘查表 " +
  "(district survey table) — pick your own facility names, quantities, and distances, but keep " +
  "every field's shape and semantics exactly as described below.";

const GENERATION_INSTRUCTION =
  "Generate one complete set of answers for every field listed above into the " +
  "extract_commercial_activity_items tool. Use different values than the shape reference below " +
  "— do not copy it verbatim — while keeping each value's raw text consistent with its other " +
  "fields (e.g. isExist:true must correspond to raw showing an actual name/quantity rather than " +
  "a blank 名稱：/數量: line, and a text value's raw must match its text).";

function buildGenerationPrompt(): string {
  return [
    GENERATION_CONTEXT,
    "",
    FACILITY_ITEM_RULE,
    "",
    LEAF_ITEM_RULE,
    "",
    GENERATION_INSTRUCTION,
    "",
    "Shape reference (do not copy these exact values):",
    DATA_EXAMPLE,
  ].join("\n");
}

const FACTS_CONTEXT =
  "There is no source PDF for this request. Instead, you are given the ACTUAL nearby " +
  "facilities found around this price-zone's benchmark location by a spatial query. Produce a " +
  "plausible, internally-consistent 工商活動 (commercial activity) category block for a " +
  "Taiwanese 表1 地價區段勘查表 (district survey table) that is FAITHFUL to those facts. The " +
  "category has four 名稱：+數量+checkbox facility items (departmentStore 百貨公司, " +
  "financialInstitution 金融機構, entertainmentFacility 娛樂設施, exhibitionCenterOrHotel " +
  "大型展示中心或觀光飯店) plus two bare-text items (customerTraffic 顧客之通行量, " +
  "storeContiguity 店鋪之毗連狀態).";

const FACTS_MAPPING_RULE =
  "Use the real facilities below to fill the facility items: match department stores " +
  "(department_store/百貨) to departmentStore, banks/金融機構 (bank) to financialInstitution, " +
  "entertainment (entertainment/娛樂) to entertainmentFacility, and hotels/觀光飯店 " +
  "(hotel/大型展示中心) to exhibitionCenterOrHotel. For each matched facility set isExist:true, " +
  "put the real name in name, set quantity to how many of that kind appear in the list (if more " +
  "than one), and derive inSection/distanceValue from the nearest one's distance (within ~150 M " +
  "→ 本區段內 inSection:true; otherwise 本區段外 inSection:false with distanceValue in M and " +
  "distanceUnit \"M\"). For any item with NO matching facility below, keep its no-facility " +
  "default: isExist:false, blank name, no quantity. Do NOT invent facilities absent from the " +
  "list. The two bare-text items (customerTraffic, storeContiguity) can't be derived from " +
  "facilities — fill them with reasonable short descriptive text consistent with a zone that " +
  "has the surrounding commerce shown, or leave blank.";

function buildGenerationPromptFromFacts(facts: CategoryFacts): string {
  const factsBlock = formatFactsForPrompt(facts);
  if (!factsBlock) return buildGenerationPrompt();
  return [
    FACTS_CONTEXT,
    "",
    "Real nearby facilities found for this zone (nearest first):",
    factsBlock,
    "",
    FACTS_MAPPING_RULE,
    "",
    FACILITY_ITEM_RULE,
    "",
    LEAF_ITEM_RULE,
    "",
    GENERATION_INSTRUCTION,
    "",
    "Shape reference (do not copy these exact values; follow the facts above instead):",
    DATA_EXAMPLE,
  ].join("\n");
}

export { buildGenerationPrompt, buildGenerationPromptFromFacts, buildPrompt };

