import type { CategoryFacts } from "../../shared/facts.js";
import { formatFactsForPrompt } from "../../shared/facts.js";

const DATA_EXAMPLE = JSON.stringify(
  {
    environmentalPollution: {
      raw: "環境污染",
      items: [
        {
          raw: "水污染",
          value: {
            type: "waterPollution",
            raw: "●水污染 名稱：八掌溪沿岸工廠排放 ●本區段內 ○本區段外(距 M)",
            isExist: true,
            name: "八掌溪沿岸工廠排放",
            inSection: true,
          },
        },
        {
          raw: "噪音污染",
          value: {
            type: "noisePollution",
            raw: "○噪音污染 名稱： ○本區段內 ○本區段外(距 M)",
            isExist: false,
            name: "",
          },
        },
        {
          raw: "廢氣污染",
          value: {
            type: "airPollution",
            raw: "●廢氣污染 名稱：中興紙廠 ○本區段內 ●本區段外(距 850 M)",
            isExist: true,
            name: "中興紙廠",
            inSection: false,
            distanceValue: 850,
            distanceUnit: "M",
          },
        },
        {
          raw: "廢棄物污染",
          value: {
            type: "wastePollution",
            raw: "○廢棄物污染 名稱： ○本區段內 ○本區段外(距 M)",
            isExist: false,
            name: "",
          },
        },
        {
          raw: "其他污染",
          value: {
            type: "otherPollution",
            raw: "○其他污染 名稱： ○本區段內 ○本區段外(距 M)",
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
  "table) for one price-zone. This call handles only the 環境污染 (environmental pollution) " +
  "category block — one of several main-category blocks printed on the page, a single group of " +
  "5 fixed-order items: 水污染, 噪音污染, 廢氣污染, 廢棄物污染, 其他污染 — so extract nothing " +
  "from any other category. Fill in every field — none are optional.";

const IGNORE_ITEM_CODE_RULE =
  'This category block is preceded by two small printed digits ("1 5"). Their meaning is not ' +
  "confirmed — do not extract them at all; they have no field in the tool schema.";

const ITEM_RULE =
  "環境污染's five items (水污染, 噪音污染, 廢氣污染, 廢棄物污染, 其他污染) each use the " +
  "checkedFacilityValue type for a leading existence checkbox (○/●) before the item's own fixed " +
  "printed label, plus a separate 名稱：field, plus the usual 本區段內/外(距 N M) checkboxes:\n" +
  "  - isExist is true only when the leading checkbox before this item's own fixed label is " +
  "marked (●), false when it is not.\n" +
  "  - name is the printed 名稱：text only when isExist is true; leave it as an empty string " +
  "when isExist is false — never fill in a name for an unmarked row.\n" +
  "  - inSection is true/false only when 本區段內 or 本區段外 is actually marked (●) — this " +
  "only happens when isExist is true; leave it unset when isExist is false.\n" +
  "  - distanceValue/distanceUnit are set only when a distance number is actually printed (only " +
  "possible when isExist is true and 本區段外 is marked).\n" +
  "When isExist is false, leave every other field on that row exactly at its unmarked default — " +
  "no name, no inSection, no distance. value.raw must always capture the exact printed cell " +
  "text verbatim, including both the leading checkbox and the 名稱：field. Each item's type must " +
  "match its own identity exactly (waterPollution/noisePollution/airPollution/wastePollution/" +
  "otherPollution) — unlike some other categories on this page, these five types are never " +
  "shared across items.";

const GROUP_RULE =
  "環境污染 bundles all 5 fixed-order items into one printed block: 水污染, 噪音污染, 廢氣污染, " +
  "廢棄物污染, 其他污染, in that exact order. Set environmentalPollution's raw to its own printed " +
  "group label (環境污染), and put each item as its own entry in the items array (never merge " +
  "them), in this exact fixed order — see the example below.";

const EXTRACTION_INSTRUCTION =
  "Extract every field into the extract_environmental_pollution_items tool, exactly as shown in " +
  "the example below.";

function buildPrompt(): string {
  return [
    CATEGORY_CONTEXT,
    "",
    IGNORE_ITEM_CODE_RULE,
    "",
    ITEM_RULE,
    "",
    GROUP_RULE,
    "",
    EXTRACTION_INSTRUCTION,
    "",
    "Example of a fully-extracted 環境污染 category:",
    DATA_EXAMPLE,
  ].join("\n");
}

const GENERATION_CONTEXT =
  "There is no source document for this request. Invent one plausible, internally-consistent " +
  "環境污染 (environmental pollution) category block for a fictional Taiwanese 表1 地價區段勘查表 " +
  "(district survey table) — pick your own facility names and distances, but keep every field's " +
  "shape and semantics exactly as described below. The category has one group field " +
  "(environmentalPollution) with 5 fixed-order items.";

const GENERATION_INSTRUCTION =
  "Generate one complete set of answers for every field listed above into the " +
  "extract_environmental_pollution_items tool. Use different values than the shape reference " +
  "below — do not copy it verbatim — while keeping each value's raw text consistent with its " +
  "other fields (e.g. isExist:true must correspond to raw showing the ● mark next to an actual " +
  "name or checkbox rather than an unmarked ○).";

function buildGenerationPrompt(): string {
  return [
    GENERATION_CONTEXT,
    "",
    ITEM_RULE,
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
  "There is no source PDF for this request. Instead, you are given some ACTUAL nearby " +
  "facilities found around this price-zone's benchmark location by a spatial query — only the " +
  "pollution-adjacent ones (waste/wastewater/substation/power-tower type). Produce a plausible, " +
  "internally-consistent 環境污染 (environmental pollution) category block for a Taiwanese 表1 " +
  "地價區段勘查表 (district survey table) that is FAITHFUL to those facts. The category has one " +
  "group field (environmentalPollution) with 5 fixed-order items: 水污染, 噪音污染, 廢氣污染, " +
  "廢棄物污染, 其他污染.";

const FACTS_MAPPING_RULE =
  "Pollution sources are not measured directly, but the nearby facilities below can be used as " +
  "evidence: a nearby wastewater/污水處理場 or 掩埋場/waste site supports 廢棄物污染 (and " +
  "possibly 水污染); an incinerator/焚化爐 or heavy plant supports 廢氣污染; a substation/變電所 " +
  "or 高壓鐵塔 may support 其他污染. For an item you mark isExist:true on this basis, set name to " +
  "the real facility name from the list and derive inSection/distanceValue from its distance " +
  "(within ~150 M → 本區段內 inSection:true; otherwise 本區段外 inSection:false with distanceValue " +
  "in M and distanceUnit \"M\"). For any of the 5 items with NO supporting facility below, keep " +
  "its no-pollution default: isExist:false, blank name, raw showing an unmarked ○. Do NOT invent " +
  "pollution sources that aren't supported by the facilities list — when in doubt, leave the " +
  "item isExist:false.";

function buildGenerationPromptFromFacts(facts: CategoryFacts): string {
  const factsBlock = formatFactsForPrompt(facts);
  if (!factsBlock) return buildGenerationPrompt();
  return [
    FACTS_CONTEXT,
    "",
    "Real nearby pollution-adjacent facilities found for this zone (nearest first):",
    factsBlock,
    "",
    FACTS_MAPPING_RULE,
    "",
    ITEM_RULE,
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

