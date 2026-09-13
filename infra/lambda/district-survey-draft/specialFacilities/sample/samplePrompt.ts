import type { CategoryFacts } from "../../shared/facts.js";
import { formatFactsForPrompt } from "../../shared/facts.js";

const DATA_EXAMPLE = JSON.stringify(
  {
    utilityGasFacility: {
      raw: "電業氣體燃料",
      items: [
        {
          raw: "變電所或高壓鐵塔",
          value: {
            type: "utilityGasFacility",
            raw: "名稱：金山變電所 ○本區段內 ●本區段外(距 600 M)",
            name: "金山變電所",
            isExist: true,
            inSection: false,
            distanceValue: 600,
            distanceUnit: "M",
          },
        },
        {
          raw: "瓦斯槽或儲油槽",
          value: {
            type: "utilityGasFacility",
            raw: "名稱： ○本區段內 ○本區段外(距 M)",
            name: "",
            isExist: false,
          },
        },
      ],
    },
    funeralFacility: {
      raw: "殯葬",
      items: [
        {
          raw: "墓地",
          value: {
            type: "funeralFacility",
            raw: "●墓地 名稱：金山公墓 ●本區段內 ○本區段外(距 M)",
            isExist: true,
            name: "金山公墓",
            inSection: true,
          },
        },
        {
          raw: "殯儀館",
          value: {
            type: "funeralFacility",
            raw: "○殯儀館 名稱： ○本區段內 ○本區段外(距 M)",
            isExist: false,
            name: "",
          },
        },
        {
          raw: "火葬場",
          value: {
            type: "funeralFacility",
            raw: "○火葬場 名稱： ○本區段內 ○本區段外(距 M)",
            isExist: false,
            name: "",
          },
        },
        {
          raw: "納骨塔",
          value: {
            type: "funeralFacility",
            raw: "●納骨塔 名稱：金山寶塔 ○本區段內 ●本區段外(距 1200 M)",
            isExist: true,
            name: "金山寶塔",
            inSection: false,
            distanceValue: 1200,
            distanceUnit: "M",
          },
        },
      ],
    },
    wasteFacility: {
      raw: "廢棄物處理",
      items: [
        {
          raw: "污水處理場",
          value: {
            type: "wasteFacility",
            raw: "●污水處理場 名稱：金山污水處理廠 ○本區段內 ●本區段外(距 800 M)",
            isExist: true,
            name: "金山污水處理廠",
            inSection: false,
            distanceValue: 800,
            distanceUnit: "M",
          },
        },
        {
          raw: "垃圾場或掩埋場",
          value: {
            type: "wasteFacility",
            raw: "○垃圾場或掩埋場 名稱： ○本區段內 ○本區段外(距 M)",
            isExist: false,
            name: "",
          },
        },
        {
          raw: "焚化爐",
          value: {
            type: "wasteFacility",
            raw: "○焚化爐 名稱： ○本區段內 ○本區段外(距 M)",
            isExist: false,
            name: "",
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
  "table) for one price-zone. This call handles only the 特殊設施 (special facilities) category " +
  "block — one of several main-category blocks printed on the page, spanning three group rows: " +
  "電業氣體燃料 (utilityGasFacility), 殯葬 (funeralFacility), and 廢棄物處理 (wasteFacility) — so " +
  "extract nothing from any other category. Fill in every field — none are optional.";

const IGNORE_ITEM_CODE_RULE =
  'Every group row is preceded by two small printed digits (e.g. "5 5", "1 5"). Their meaning ' +
  "is not confirmed — do not extract them at all; they have no field in the tool schema.";

const UTILITY_GAS_RULE =
  "utilityGasFacility's two sub-items (變電所或高壓鐵塔, 瓦斯槽或儲油槽) each use the " +
  "utilityGasFacility value type for the repeated 名稱:X ○本區段內/●本區段外(距 N M) checkbox " +
  "pattern, with no leading existence checkbox of their own and no 無... placeholder — the 名稱 " +
  "field is either filled in with a real name or left entirely blank:\n" +
  "  - name is the printed 名稱 text, or an empty string if nothing is filled in.\n" +
  "  - isExist is true only when a name is actually filled in, false when the name field is " +
  "blank.\n" +
  "  - inSection is true/false only when 本區段內 or 本區段外 is actually marked (●); leave it " +
  "unset if neither is marked (the usual case when isExist is false).\n" +
  "  - distanceValue/distanceUnit are set only when a distance number is actually printed.\n" +
  "Both checkboxes — 本區段內 and 本區段外(距 N M) — are always printed on the page side by " +
  "side, and value.raw must always include both verbatim (one ○, one ●), even when only one " +
  "is marked. Never omit the unmarked checkbox from raw.";

const CHECKED_FACILITY_RULE =
  "funeralFacility's four sub-items (墓地, 殯儀館, 火葬場, 納骨塔) and wasteFacility's three " +
  "sub-items (污水處理場, 垃圾場或掩埋場, 焚化爐) each use the matching checkedFacilityValue " +
  "type (funeralFacility/wasteFacility) for a leading existence checkbox (○/●) before the " +
  "item's own fixed printed label, plus a separate 名稱：field, plus the usual 本區段內/外(距 N " +
  "M) checkboxes:\n" +
  "  - isExist is true only when the leading checkbox before this sub-item's own fixed label is " +
  "marked (●), false when it is not.\n" +
  "  - name is the printed 名稱：text only when isExist is true; leave it as an empty string " +
  "when isExist is false — never fill in a name for an unmarked row.\n" +
  "  - inSection is true/false only when 本區段內 or 本區段外 is actually marked (●) — this " +
  "only happens when isExist is true; leave it unset when isExist is false.\n" +
  "  - distanceValue/distanceUnit are set only when a distance number is actually printed (only " +
  "possible when isExist is true and 本區段外 is marked).\n" +
  "When isExist is false, leave every other field on that row exactly at its unmarked default — " +
  "no name, no inSection, no distance. value.raw must always capture the exact printed cell " +
  "text verbatim, including both the leading checkbox and the 名稱：field.";

const GROUP_RULE =
  "utilityGasFacility, funeralFacility, and wasteFacility each bundle several fixed-order " +
  "sub-items into one printed block: utilityGasFacility's two sub-items are 變電所或高壓鐵塔, " +
  "瓦斯槽或儲油槽; funeralFacility's four are 墓地, 殯儀館, 火葬場, 納骨塔; wasteFacility's " +
  "three are 污水處理場, 垃圾場或掩埋場, 焚化爐. Set each group's raw to its own printed group " +
  "label (電業氣體燃料/殯葬/廢棄物處理), and put each sub-item as its own entry in that group's " +
  "items array (never merge them), in this exact fixed order — see the example below.";

const EXTRACTION_INSTRUCTION =
  "Extract every field into the extract_special_facilities_items tool, exactly as shown in the " +
  "example below.";

function buildPrompt(): string {
  return [
    CATEGORY_CONTEXT,
    "",
    IGNORE_ITEM_CODE_RULE,
    "",
    UTILITY_GAS_RULE,
    "",
    CHECKED_FACILITY_RULE,
    "",
    GROUP_RULE,
    "",
    EXTRACTION_INSTRUCTION,
    "",
    "Example of a fully-extracted 特殊設施 category:",
    DATA_EXAMPLE,
  ].join("\n");
}

const GENERATION_CONTEXT =
  "There is no source document for this request. Invent one plausible, internally-consistent " +
  "特殊設施 (special facilities) category block for a fictional Taiwanese 表1 地價區段勘查表 " +
  "(district survey table) — pick your own facility names and distances, but keep every field's " +
  "shape and semantics exactly as described below. The category has three group fields " +
  "(utilityGasFacility, funeralFacility, wasteFacility).";

const GENERATION_INSTRUCTION =
  "Generate one complete set of answers for every field listed above into the " +
  "extract_special_facilities_items tool. Use different values than the shape reference below — " +
  "do not copy it verbatim — while keeping each value's raw text consistent with its other " +
  "fields (e.g. isExist:true must correspond to raw showing the ● mark next to an actual name " +
  "or checkbox rather than an unmarked ○).";

function buildGenerationPrompt(): string {
  return [
    GENERATION_CONTEXT,
    "",
    UTILITY_GAS_RULE,
    "",
    CHECKED_FACILITY_RULE,
    "",
    GROUP_RULE,
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
  "plausible, internally-consistent 特殊設施 (special facilities) category block for a Taiwanese " +
  "表1 地價區段勘查表 (district survey table) that is FAITHFUL to those facts. The category has " +
  "three group fields (utilityGasFacility, funeralFacility, wasteFacility).";

const FACTS_MAPPING_RULE =
  "Use the real facilities below to fill the sub-items: match 變電所/substation and " +
  "高壓鐵塔/power_tower to utilityGasFacility's 變電所或高壓鐵塔, gas/oil storage " +
  "(gas_storage/瓦斯槽/儲油槽) to utilityGasFacility's 瓦斯槽或儲油槽; cemetery/墓地 to " +
  "funeralFacility's 墓地, 殯儀館 to 殯儀館, 火葬場 to 火葬場, 納骨塔 to 納骨塔; " +
  "污水處理場/wastewater to wasteFacility's 污水處理場, landfill/掩埋場/垃圾場/waste to " +
  "垃圾場或掩埋場, 焚化爐/incinerator to 焚化爐. For each matched facility set isExist:true, put " +
  "the real name in name, and derive inSection/distanceValue from its distance (within ~150 M → " +
  "本區段內 inSection:true; otherwise 本區段外 inSection:false with distanceValue in M and " +
  "distanceUnit \"M\"). For any sub-item with NO matching facility below, keep its no-facility " +
  "default: isExist:false, blank name, raw showing an unmarked ○. Do NOT invent facilities " +
  "absent from the list.";

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
    UTILITY_GAS_RULE,
    "",
    CHECKED_FACILITY_RULE,
    "",
    GROUP_RULE,
    "",
    GENERATION_INSTRUCTION,
    "",
    "Shape reference (do not copy these exact values; follow the facts above instead):",
    DATA_EXAMPLE,
  ].join("\n");
}

export { buildGenerationPrompt, buildGenerationPromptFromFacts, buildPrompt };

