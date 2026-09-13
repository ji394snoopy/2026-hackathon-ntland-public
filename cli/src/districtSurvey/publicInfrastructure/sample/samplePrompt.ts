import type { CategoryFacts } from "../../shared/facts.js";
import { formatFactsForPrompt } from "../../shared/facts.js";

const DATA_EXAMPLE = JSON.stringify(
  {
    touristRecreationFacility: {
      raw: "觀光遊憩設施",
      value: {
        type: "touristRecreationFacility",
        raw: "名稱：陽明山國家公園 ○本區段內 ●本區段外(距 1500 M)",
        name: "陽明山國家公園",
        isExist: true,
        inSection: false,
        distanceValue: 1500,
        distanceUnit: "M",
      },
    },
    parkingArea: {
      raw: "停車場地",
      value: {
        type: "parkingAreaFacility",
        raw: "名稱： ○本區段內 ○本區段外(距 M)",
        name: "",
        isExist: false,
      },
    },
    proximityToServiceFacility: {
      raw: "接近服務性設施的程度",
      value: {
        type: "serviceFacilityProximityFacility",
        raw: "名稱：金山區公所 ●本區段內 ○本區段外(距 M)",
        name: "金山區公所",
        isExist: true,
        inSection: true,
      },
    },
    electricPowerResources: {
      raw: "電力資源",
      value: { type: "text", raw: "台電金山變電站供電", text: "台電金山變電站供電" },
    },
    industrialWaterSupply: {
      raw: "產業用水及設施",
      value: { type: "text", raw: "", text: "" },
    },
    wastewaterTreatmentFacility: {
      raw: "污廢水及廢棄物處理設施",
      value: {
        type: "wastewaterTreatmentFacility",
        raw: "名稱：金山污水處理廠 ○本區段內 ●本區段外(距 800 M)",
        name: "金山污水處理廠",
        isExist: true,
        inSection: false,
        distanceValue: 800,
        distanceUnit: "M",
      },
    },
    school: {
      raw: "學校",
      items: [
        {
          raw: "國小",
          value: {
            type: "schoolFacility",
            raw: "●金山國小 ○本區段內 ●本區段外(距 400 M)",
            name: "金山國小",
            isExist: true,
            inSection: false,
            distanceValue: 400,
            distanceUnit: "M",
          },
        },
        {
          raw: "國中",
          value: {
            type: "schoolFacility",
            raw: "○國中 ○本區段內 ○本區段外(距 M)",
            name: "國中",
            isExist: false,
          },
        },
        {
          raw: "高中",
          value: {
            type: "schoolFacility",
            raw: "○高中 ○本區段內 ○本區段外(距 M)",
            name: "高中",
            isExist: false,
          },
        },
        {
          raw: "大專院校",
          value: {
            type: "schoolFacility",
            raw: "○大專院校 ○本區段內 ○本區段外(距 M)",
            name: "大專院校",
            isExist: false,
          },
        },
      ],
    },
    market: {
      raw: "市場",
      items: [
        {
          raw: "傳統市場",
          value: {
            type: "marketFacility",
            raw: "●金山傳統市場 ●本區段內 ○本區段外(距 M)",
            name: "金山傳統市場",
            isExist: true,
            inSection: true,
          },
        },
        {
          raw: "超級市場",
          value: {
            type: "marketFacility",
            raw: "○超級市場 ○本區段內 ○本區段外(距 M)",
            name: "超級市場",
            isExist: false,
          },
        },
        {
          raw: "超大型購物中心",
          value: {
            type: "marketFacility",
            raw: "○超大型購物中心 ○本區段內 ○本區段外(距 M)",
            name: "超大型購物中心",
            isExist: false,
          },
        },
      ],
    },
    parkPlazaPedestrianZone: {
      raw: "公園廣場徒步區",
      items: [
        {
          raw: "里鄰公園",
          value: {
            type: "parkFacility",
            raw: "●金山里鄰公園 ●本區段內 ○本區段外(距 M)",
            name: "金山里鄰公園",
            isExist: true,
            inSection: true,
          },
        },
        {
          raw: "一般公園",
          value: {
            type: "parkFacility",
            raw: "○一般公園 ○本區段內 ○本區段外(距 M)",
            name: "一般公園",
            isExist: false,
          },
        },
        {
          raw: "廣場.徒步區",
          value: {
            type: "parkFacility",
            raw: "●市民廣場 ●本區段內 ○本區段外(距 M)",
            name: "市民廣場",
            isExist: true,
            inSection: true,
          },
        },
      ],
    },
  },
  null,
  2,
);

const CATEGORY_CONTEXT =
  "This PDF page is a Taiwanese (Traditional Chinese) 表1 地價區段勘查表 (district survey " +
  "table) for one price-zone. This call handles only the 公共建設 (public infrastructure) " +
  "category block — one of several main-category blocks printed on the page, spanning two " +
  "separate visual blocks: a top-right block (touristRecreationFacility, parkingArea, " +
  "proximityToServiceFacility, electricPowerResources, industrialWaterSupply, " +
  "wastewaterTreatmentFacility) and a bottom-left block (school, market, " +
  "parkPlazaPedestrianZone) — so extract nothing from any other category. Fill in every field " +
  "— none are optional.";

const IGNORE_ITEM_CODE_RULE =
  'Every item row is preceded by two small printed digits (e.g. "1 5", "2 5"). Their meaning ' +
  "is not confirmed — do not extract them at all; they have no field in the tool schema.";

const ANSWER_TYPE_RULE =
  'electricPowerResources and industrialWaterSupply\'s "value" has a "type" field that says ' +
  "how to read its printed answer. raw always holds the exact printed cell text verbatim, for " +
  "cross-checking consistency against the other fields below — it is never the field " +
  "downstream code reads as the value:\n" +
  '  - "text" — a bare descriptive sentence/label with no separate number, or an empty string ' +
  "if nothing is printed for that item. Set raw and text to the same content (or both to an " +
  "empty string).\n" +
  '  - "number" — a bare number with a trailing unit and no place-name/label attached. Set ' +
  "value to the parsed number and unit to the trailing unit text.\n" +
  '  - "measurement" — a place/street name plus a number and unit. Set label to the ' +
  "place-name portion, value to the parsed number, and unit to the trailing unit text.\n" +
  "Default both fields to type \"text\": electricPowerResources and industrialWaterSupply are " +
  "always either blank or a plain descriptive sentence in practice, never a structured " +
  "number/measurement cell. Only use \"number\" or \"measurement\" if the printed cell " +
  "unambiguously matches that pattern and there is no simpler text reading — when in doubt, " +
  "use \"text\". These two fields' types should normally match each other.";

const FACILITY_TYPE_RULE =
  "touristRecreationFacility, parkingArea, proximityToServiceFacility, and " +
  "wastewaterTreatmentFacility each use the facility value type matching their own field name " +
  "for the repeated 名稱:X ○本區段內/●本區段外(距 N M) checkbox pattern. Unlike interchange-style " +
  "items elsewhere in this form, none of these four print a 無... placeholder — the 名稱 field " +
  "is either filled in with a real name or left entirely blank:\n" +
  "  - name is the printed 名稱 text, or an empty string if nothing is filled in.\n" +
  "  - isExist is true only when a name is actually filled in, false when the name field is " +
  "blank.\n" +
  "  - inSection is true/false only when 本區段內 or 本區段外 is actually marked (●); leave it " +
  "unset if neither is marked (the usual case when isExist is false).\n" +
  "  - distanceValue/distanceUnit are set only when a distance number is actually printed " +
  "(usually only alongside a marked 本區段外) — leave them unset otherwise.\n" +
  "Both checkboxes — 本區段內 and 本區段外(距 N M) — are always printed on the page side by " +
  "side, and value.raw must always include both verbatim (one ○, one ●), even when only one " +
  "is marked. Never omit the unmarked checkbox from raw.";

const GROUP_RULE =
  "school, market, and parkPlazaPedestrianZone each bundle several fixed-order sub-items into " +
  "one printed block: school's four sub-items are 國小, 國中, 高中, 大專院校; market's three are " +
  "傳統市場, 超級市場, 超大型購物中心; parkPlazaPedestrianZone's three are 里鄰公園, 一般公園, " +
  "廣場.徒步區. Set each group's raw to its own printed group label (學校/市場/公園廣場徒步區), " +
  "and put each sub-item as its own entry in that group's items array (never merge them), in " +
  "this exact fixed order — see the example below.";

const FIXED_LABEL_RULE =
  "market's first sub-item (傳統市場) and parkPlazaPedestrianZone's first sub-item (里鄰公園) " +
  "print no label text on the page when their checkbox is unmarked and no name is filled in. " +
  "Never write a literal \"...\" or other placeholder in value.raw for this blank case — " +
  "substitute the fixed label itself as the default name, exactly as if it had been printed: " +
  "value.raw becomes \"○傳統市場 ○本區段內 ○本區段外(距 M)\" for 傳統市場 and " +
  "\"○里鄰公園 ○本區段內 ○本區段外(距 M)\" for 里鄰公園, and value.name falls back to that " +
  "same fixed label (\"傳統市場\"/\"里鄰公園\"). item.raw must always be exactly " +
  "\"傳統市場\"/\"里鄰公園\" respectively — a known fixed category for that position — " +
  "regardless of whether anything is printed. But when the checkbox IS marked and a real " +
  "name is written in, treat these two exactly like every other school/market/park sub-item: " +
  "value.name becomes that real name in place of the fixed label, and isExist is true — see " +
  "the existence-check rule below.";

const EXISTENCE_CHECK_RULE =
  "school's, market's, and parkPlazaPedestrianZone's sub-items each use the existenceCheck " +
  "value type matching their own group (schoolFacility/marketFacility/parkFacility) for the " +
  "checkbox + ○本區段內/●本區段外(距 N M) pattern:\n" +
  "  - name is a real facility name when one is written in place of the fixed label (e.g. an " +
  "actual supermarket name replacing 超級市場, or a real school name replacing 國小), or the " +
  "sub-item's own fixed printed label itself (e.g. 超級市場) when nothing more specific is " +
  "filled in.\n" +
  "  - isExist is true only when the leading checkbox before this sub-item's own label or " +
  "filled-in name (printed or, per the fixed-label rule above, not) is marked (●).\n" +
  "  - inSection is true/false only when 本區段內 or 本區段外 is actually marked (●); leave it " +
  "unset if neither is marked.\n" +
  "  - distanceValue/distanceUnit are set only when a distance number is actually printed.\n" +
  "Both checkboxes — 本區段內 and 本區段外(距 N M) — are always printed on the page side by " +
  "side, and value.raw must always include both verbatim (one ○, one ●), even when only one " +
  "is marked. Never omit the unmarked checkbox from raw.";

const EXTRACTION_INSTRUCTION =
  "Extract every field into the extract_public_infrastructure_items tool, exactly as shown in " +
  "the example below.";

function buildPrompt(): string {
  return [
    CATEGORY_CONTEXT,
    "",
    IGNORE_ITEM_CODE_RULE,
    "",
    ANSWER_TYPE_RULE,
    "",
    FACILITY_TYPE_RULE,
    "",
    GROUP_RULE,
    "",
    FIXED_LABEL_RULE,
    "",
    EXISTENCE_CHECK_RULE,
    "",
    EXTRACTION_INSTRUCTION,
    "",
    "Example of a fully-extracted 公共建設 category:",
    DATA_EXAMPLE,
  ].join("\n");
}

const GENERATION_CONTEXT =
  "There is no source document for this request. Invent one plausible, internally-consistent " +
  "公共建設 (public infrastructure) category block for a fictional Taiwanese 表1 地價區段勘查表 " +
  "(district survey table) — pick your own facility names and distances, but keep every " +
  "field's shape and semantics exactly as described below. The category has six standalone " +
  "fields (touristRecreationFacility, parkingArea, proximityToServiceFacility, " +
  "electricPowerResources, industrialWaterSupply, wastewaterTreatmentFacility) and three group " +
  "fields (school, market, parkPlazaPedestrianZone).";

const GENERATION_INSTRUCTION =
  "Generate one complete set of answers for every field listed above into the " +
  "extract_public_infrastructure_items tool. Use different values than the shape reference " +
  "below — do not copy it verbatim — while keeping each value's raw text consistent with its " +
  "other fields (e.g. isExist:true must correspond to raw showing the ● mark next to an actual " +
  "name or checkbox rather than an unmarked ○, and a text value's raw must match its text).";

function buildGenerationPrompt(): string {
  return [
    GENERATION_CONTEXT,
    "",
    ANSWER_TYPE_RULE,
    "",
    FACILITY_TYPE_RULE,
    "",
    GROUP_RULE,
    "",
    FIXED_LABEL_RULE,
    "",
    EXISTENCE_CHECK_RULE,
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
  "plausible, internally-consistent 公共建設 (public infrastructure) category block for a " +
  "Taiwanese 表1 地價區段勘查表 (district survey table) that is FAITHFUL to those facts. The " +
  "category has six standalone fields (touristRecreationFacility, parkingArea, " +
  "proximityToServiceFacility, electricPowerResources, industrialWaterSupply, " +
  "wastewaterTreatmentFacility) and three group fields (school, market, parkPlazaPedestrianZone).";

const FACTS_MAPPING_RULE =
  "Use the real facilities below to fill the facility-shaped fields: match schools/文教設施 " +
  "(education) to school's sub-items (國小/國中/高中/大專院校, best-effort by name), markets " +
  "(market/傳統市場/超級市場) to market's sub-items, parks (park/公園) to " +
  "parkPlazaPedestrianZone's sub-items, tourism/觀光遊憩 to touristRecreationFacility, parking " +
  "(parking/停車場) to parkingArea, and wastewater/污水/污廢水 to wastewaterTreatmentFacility. " +
  "For each matched facility set isExist:true, put the real name in name, and derive " +
  "inSection/distanceValue from its distance (within ~150 M → 本區段內 inSection:true; otherwise " +
  "本區段外 inSection:false with distanceValue in M and distanceUnit \"M\"). For any sub-item or " +
  "field with NO matching facility below, keep its no-facility default: isExist:false, blank " +
  "name (or the fixed sub-item label per the fixed-label rule), raw showing unmarked ○. Do NOT " +
  "invent facilities absent from the list. Fields the facilities can't determine " +
  "(proximityToServiceFacility, electricPowerResources, industrialWaterSupply) may be filled " +
  "with reasonable values or left blank text as appropriate.";

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
    ANSWER_TYPE_RULE,
    "",
    FACILITY_TYPE_RULE,
    "",
    GROUP_RULE,
    "",
    FIXED_LABEL_RULE,
    "",
    EXISTENCE_CHECK_RULE,
    "",
    GENERATION_INSTRUCTION,
    "",
    "Shape reference (do not copy these exact values; follow the facts above instead):",
    DATA_EXAMPLE,
  ].join("\n");
}

export { buildGenerationPrompt, buildGenerationPromptFromFacts, buildPrompt };

