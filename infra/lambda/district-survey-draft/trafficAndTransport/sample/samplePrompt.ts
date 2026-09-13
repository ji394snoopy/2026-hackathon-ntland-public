import type { CategoryFacts } from "../../shared/facts.js";
import { formatFactsForPrompt } from "../../shared/facts.js";

const DATA_EXAMPLE = JSON.stringify(
  {
    mainRoad: {
      raw: "主要道路",
      value: {
        type: "measurement",
        raw: "中山路 18 M",
        label: "中山路",
        value: 18,
        unit: "M",
      },
    },
    averageRoadWidthInSection: {
      raw: "區段內道路平均寬度",
      value: { type: "number", raw: "12 M", value: 12, unit: "M" },
    },
    majorStation: {
      raw: "大型車站",
      items: [
        {
          raw: "無高鐵站",
          value: {
            type: "majorStationFacility",
            raw: "○無高鐵站 ○本區段內 ○本區段外(距 M)",
            name: "無高鐵站",
            isExist: false,
          },
        },
        {
          raw: "無火車站",
          value: {
            type: "majorStationFacility",
            raw: "○無火車站 ○本區段內 ○本區段外(距 M)",
            name: "無火車站",
            isExist: false,
          },
        },
        {
          raw: "無客運站",
          value: {
            type: "majorStationFacility",
            raw: "●國光客運金山站 ○本區段內 ●本區段外(距 300 M)",
            name: "國光客運金山站",
            isExist: true,
            inSection: false,
            distanceValue: 300,
            distanceUnit: "M",
          },
        },
        {
          raw: "無捷運站",
          value: {
            type: "majorStationFacility",
            raw: "○無捷運站 ○本區段內 ○本區段外(距 M)",
            name: "無捷運站",
            isExist: false,
          },
        },
      ],
    },
    busStop: {
      raw: "站牌",
      value: {
        type: "busStopFacility",
        raw: "名稱:金山區公所站 ●本區段內 ○本區段外(距 M)\n密集程度:○非常密集 ●密集 ○不密集",
        name: "金山區公所站",
        isExist: true,
        inSection: true,
        densityLevel: 1,
      },
    },
    interchange: {
      raw: "交流道",
      value: {
        type: "interchangeFacility",
        raw: "名稱:無交流道 ○本區段內 ○本區段外(距 M)",
        name: "無交流道",
        isExist: false,
      },
    },
    proximityToSettlement: {
      raw: "接近聚落程度",
      value: { type: "text", raw: "", text: "" },
    },
    proximityToDistributionCenter: {
      raw: "接近運銷中心程度",
      value: { type: "text", raw: "", text: "" },
    },
    proximityToMarket: {
      raw: "接近消費市場程度",
      value: { type: "text", raw: "", text: "" },
    },
    roadConstructionLevel: {
      raw: "區段內道路規劃及闢建程度",
      value: { type: "text", raw: "已完全開發", text: "已完全開發" },
    },
  },
  null,
  2,
);

const CATEGORY_CONTEXT =
  "This PDF page is a Taiwanese (Traditional Chinese) 表1 地價區段勘查表 (district survey " +
  "table) for one price-zone. This call handles only the 交通運輸 (traffic and transport) " +
  "category block — one of several main-category blocks printed on the page — so extract " +
  "nothing from any other category. The tool has one fixed field per printed item, in this " +
  "printed order: mainRoad (主要道路), averageRoadWidthInSection (區段內道路平均寬度), " +
  "majorStation (大型車站, bundling four separate 有/無 checks: 高鐵站, 火車站, 客運站, 捷運站), " +
  "busStop (站牌), interchange (交流道), proximityToSettlement (接近聚落程度), " +
  "proximityToDistributionCenter (接近運銷中心程度), proximityToMarket (接近消費市場程度), and " +
  "roadConstructionLevel (區段內道路規劃及闢建程度). Fill in every field — none are optional.";

const IGNORE_ITEM_CODE_RULE =
  'Every item row is preceded by two small printed digits (e.g. "1 2", "3 5"). Their ' +
  "meaning is not confirmed — do not extract them at all; they have no field in the tool " +
  "schema.";

const ANSWER_TYPE_RULE =
  'Every item\'s "value" has a "type" field that says how to read its printed answer. ' +
  "raw always holds the exact printed cell text verbatim, for cross-checking consistency " +
  "against the other fields below — it is never the field downstream code reads as the value:\n" +
  '  - "text" — a bare descriptive sentence/label with no separate number, e.g. 已完全開發, ' +
  "or an empty string if nothing is printed for that item. Set raw and text to the same " +
  "content (or both to an empty string).\n" +
  '  - "number" — a bare number with a trailing unit and no place-name/label attached, ' +
  "e.g. 12 M for averageRoadWidthInSection. Set value to the parsed number and unit to the " +
  "trailing unit text.\n" +
  '  - "measurement" — a place/street name plus a number and unit, e.g. 中山路 18 M for ' +
  "mainRoad. Set label to the place-name portion, value to the parsed number, and unit to " +
  "the trailing unit text.";

const FACILITY_TYPE_RULE =
  "majorStation's sub-items, busStop, and interchange each use their own value type — " +
  "majorStationFacility, busStopFacility, interchangeFacility respectively — for the repeated " +
  "名稱:X ○本區段內/●本區段外(距 N M) checkbox pattern:\n" +
  "  - name is the printed 名稱 text: the actual facility name when one is filled in " +
  "(e.g. 國光客運金山站), or the printed placeholder text itself (e.g. 無高鐵站) when " +
  "nothing is filled in.\n" +
  "  - isExist is true only when an actual facility name is filled in, false when the " +
  "placeholder 無... text is what's printed/circled.\n" +
  "  - inSection is true/false only when 本區段內 or 本區段外 is actually marked (●); " +
  "leave it unset if neither is marked (the usual case when isExist is false).\n" +
  "  - distanceValue/distanceUnit are set only when a distance number is actually printed " +
  "(usually only alongside a marked 本區段外) — leave them unset otherwise.\n" +
  "Both checkboxes — 本區段內 and 本區段外(距 N M) — are always printed on the page side by " +
  "side, and value.raw must always include both verbatim (one ○, one ●), even when only one " +
  "is marked. Never omit the unmarked checkbox from raw.";

const STATION_GROUP_RULE =
  "majorStation bundles four separate 有/無 + 本區段內/外 lines (高鐵站, 火車站, 客運站, 捷運站) " +
  'into one printed row. Set majorStation.raw to "大型車站", and put each of the four as its ' +
  "own entry in majorStation.items (never merge them), each with its own majorStationFacility " +
  'value — see the example below. Each entry\'s own raw stays that station type\'s printed ' +
  'placeholder label (e.g. "無高鐵站"), unchanged even when the facility is actually filled in ' +
  "with a real name.";

const DENSITY_RULE =
  "busStop's 密集程度 line prints three options in a fixed order — 非常密集, 密集, 不密集 — " +
  "with exactly one circled (●). Set densityLevel to that option's 0-based position in " +
  "this printed order (0=非常密集, 1=密集, 2=不密集), not to the option's Chinese text. This " +
  "field is always determinable and must always be set for busStop.";

const EXTRACTION_INSTRUCTION =
  "Extract every field into the extract_traffic_and_transport_items tool, exactly as shown " +
  "in the example below.";

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
    STATION_GROUP_RULE,
    "",
    DENSITY_RULE,
    "",
    EXTRACTION_INSTRUCTION,
    "",
    "Example of a fully-extracted 交通運輸 category:",
    DATA_EXAMPLE,
  ].join("\n");
}

const GENERATION_CONTEXT =
  "There is no source document for this request. Invent one plausible, internally-consistent " +
  "交通運輸 (traffic and transport) category block for a fictional Taiwanese 表1 地價區段勘查表 " +
  "(district survey table) — pick your own place names, road names, station names, and " +
  "distances, but keep every field's shape and semantics exactly as described below. The tool " +
  "has one fixed field per printed item: mainRoad (主要道路), averageRoadWidthInSection " +
  "(區段內道路平均寬度), majorStation (大型車站, bundling four separate 有/無 checks: 高鐵站, " +
  "火車站, 客運站, 捷運站), busStop (站牌), interchange (交流道), proximityToSettlement " +
  "(接近聚落程度), proximityToDistributionCenter (接近運銷中心程度), proximityToMarket " +
  "(接近消費市場程度), and roadConstructionLevel (區段內道路規劃及闢建程度).";

const GENERATION_INSTRUCTION =
  "Generate one complete set of answers for every field listed above into the " +
  "extract_traffic_and_transport_items tool. Use different values than the shape reference " +
  "below — do not copy it verbatim — while keeping each value's raw text consistent with its " +
  "other fields (e.g. isExist:true must correspond to raw showing the ● mark next to an actual " +
  "name rather than next to 無..., a checked 密集程度 option must match densityLevel, and a " +
  "text value's raw must match its text).";

function buildGenerationPrompt(): string {
  return [
    GENERATION_CONTEXT,
    "",
    ANSWER_TYPE_RULE,
    "",
    FACILITY_TYPE_RULE,
    "",
    STATION_GROUP_RULE,
    "",
    DENSITY_RULE,
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
  "plausible, internally-consistent 交通運輸 (traffic and transport) category block for a " +
  "Taiwanese 表1 地價區段勘查表 (district survey table) that is FAITHFUL to those facts. The " +
  "tool has one fixed field per printed item: mainRoad (主要道路), averageRoadWidthInSection " +
  "(區段內道路平均寬度), majorStation (大型車站, bundling four separate 有/無 checks: 高鐵站, " +
  "火車站, 客運站, 捷運站), busStop (站牌), interchange (交流道), proximityToSettlement " +
  "(接近聚落程度), proximityToDistributionCenter (接近運銷中心程度), proximityToMarket " +
  "(接近消費市場程度), and roadConstructionLevel (區段內道路規劃及闢建程度).";

const FACTS_MAPPING_RULE =
  "Use the real facilities below to fill the facility-shaped fields: match 高鐵站→majorStation " +
  "(高鐵站 sub-item), 火車站→majorStation (火車站), 客運站→majorStation (客運站), " +
  "捷運站→majorStation (捷運站), 交流道/motorway_junction→interchange, and bus stops→busStop. " +
  "For each matched facility set isExist:true, put the real name in name, and derive " +
  "inSection/distanceValue from its distance (treat facilities within ~150 M as 本區段內 " +
  "inSection:true, otherwise 本區段外 inSection:false with distanceValue set to the meters and " +
  "distanceUnit \"M\"). For any station type or facility with NO matching entry below, keep its " +
  "no-facility default: isExist:false, name the 無... placeholder, raw showing an unmarked ○. " +
  "Do NOT invent facilities that are not in the list. Fields the facilities can't determine " +
  "(mainRoad, averageRoadWidthInSection, proximityTo*, roadConstructionLevel, and busStop " +
  "densityLevel) may be filled with reasonable values consistent with a zone that has these " +
  "surrounding facilities.";

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
    STATION_GROUP_RULE,
    "",
    DENSITY_RULE,
    "",
    GENERATION_INSTRUCTION,
    "",
    "Shape reference (do not copy these exact values; follow the facts above instead):",
    DATA_EXAMPLE,
  ].join("\n");
}

export { buildGenerationPrompt, buildGenerationPromptFromFacts, buildPrompt };

