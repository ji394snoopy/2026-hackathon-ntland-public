// Survey mapper — the single place that translates the frontend-facing 表1 勘查表
// `SurveyField[]` (the unified schema stored in case_survey / edited by the appraiser)
// into the cli "content tree" that `fill-district-survey` consumes to draw 表1 PDF.
//
// Why this exists (docs/流程對照與缺口.md #7「mapper 未接線」):
//   - The frontend / case-store use a FLAT `SurveyField[]` (60 keys, every value a string;
//     multi-facility fields carry `items[]` or a "；"-joined value). See ../types.SurveyField.
//   - fill-district-survey draws by structurally matching a NESTED content tree against
//     input/coordinates.json, where each leaf is `{ raw, value: { type, ... } }` and the
//     value.type drives what gets drawn (see fill-district-survey/fillEngine.ts:resolveText
//     + leafDraw). The two schemas do NOT share keys or shape.
//   - This file is the reverse of produce-survey/mapToSurvey.ts (which builds SurveyField[]
//     from facilities + drafts). Here we go SurveyField[] -> content tree.
//
// Authority for the output shape (do not guess): fill-district-survey/input/coordinates.json
// (key paths + which nodes are arrays / .items groups / leaf slots) and each
// district-survey-draft/*/sample/samplePrompt.ts DATA_EXAMPLE (known-good content instances).
// The mapping below was built field-by-field against those.
//
// fill-district-survey handler is NOT changed: it still takes a content tree. Orchestration
// (producing 表1 PDF) calls surveyToContentTree() first, then POSTs the result.

import type { CaseMeta, ComparisonCondition, SurveyField } from "../types";

// ---------------------------------------------------------------------------
// content tree value shapes (output) — mirror fillEngine.ts's resolveText / leafDraw
// contract. `raw` is carried for parity with DATA_EXAMPLE (fillEngine ignores it); the
// real drawing keys are text / value+unit / label+value+unit / name+isExist+inSection+… .
// ---------------------------------------------------------------------------

interface TextValue {
  type: "text";
  raw: string;
  text: string;
}
interface NumberValue {
  type: "number";
  raw: string;
  value: number;
  unit: string;
}
interface MeasurementValue {
  type: "measurement";
  raw: string;
  label: string;
  value: number;
  unit: string;
}
/** singleChoice needs `text` too — fillEngine.resolveText returns undefined for it otherwise. */
interface SingleChoiceValue {
  type: "singleChoice";
  raw: string;
  selected: string;
  text: string;
}
/** The shared facility/existence value used by all 有/無 + 本區段內外(距 N M) leaves & array items. */
interface FacilityValue {
  type: string; // majorStationFacility / busStopFacility / interchangeFacility / departmentStore / …
  raw?: string;
  name?: string;
  isExist: boolean;
  inSection?: boolean;
  distanceValue?: number;
  distanceUnit?: string;
  quantity?: number;
  densityLevel?: number;
}

type LeafValue = TextValue | NumberValue | MeasurementValue | SingleChoiceValue | FacilityValue;

interface Leaf {
  raw: string;
  value: LeafValue;
}
interface CheckItem {
  raw: string;
  checked: boolean;
}
interface CheckGroup {
  raw: string;
  items: CheckItem[];
  other: { checked: boolean; text: string };
}

/** The content tree POSTed to fill-district-survey. Loosely typed on purpose (nested). */
export type SurveyContentTree = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Parsing helpers — SurveyField values are all strings; recover structured facts from
// the frontend conventions ("名稱，距NNNM"、"；"-joined、"70%"、"中山路，寬度18M").
// ---------------------------------------------------------------------------

const EMPTY_MARKERS = new Set(["", "無", "無資料", "查無", "-", "—"]);

function isBlank(v: string | undefined): boolean {
  return v == null || EMPTY_MARKERS.has(v.trim());
}

/** Unlike isBlank, "無" is a real answer here (e.g. no_build_ban/build_restriction), not a missing-data marker. */
function isEmptyString(v: string | undefined): boolean {
  return v == null || v.trim() === "";
}

/** "名稱，距NNNM" / "名稱，距 NNN M" → { name, distance }. */
const FACILITY_RE = /^(.+?)[，,]\s*距\s*([\d.]+)\s*M?/i;
/** "…本區段內…" / "…本區段外…" markers. */
function inSectionFrom(text: string): boolean | undefined {
  if (text.includes("本區段內")) return true;
  if (text.includes("本區段外")) return false;
  return undefined;
}

interface ParsedFacility {
  name: string;
  distanceValue?: number;
  inSection?: boolean;
}

/** Parse one facility token: prefer items[i], else the "名稱，距NNNM" / "…本區段內/外…" convention. */
function parseFacilityToken(token: string): ParsedFacility | null {
  const t = token.trim();
  if (!t || EMPTY_MARKERS.has(t)) return null;
  // 「無交流道」「無高鐵站」等「無…」開頭且不含距離數字 → 視為不存在（isExist:false）。
  if (/^無/.test(t) && !/\d/.test(t)) return null;
  const m = t.match(FACILITY_RE);
  const inSection = inSectionFrom(t);
  if (m) {
    return { name: m[1].trim(), distanceValue: Number(m[2]), inSection };
  }
  // No distance pattern — take the leading name-ish part (strip 「本區段…」 tail).
  const name = t.replace(/[，,]?\s*本區段.*$/, "").trim() || t;
  return { name, inSection };
}

/** All facility tokens for a field: items[] wins; else split value on ；/;. */
function facilityTokens(field: SurveyField): ParsedFacility[] {
  if (field.items && field.items.length > 0) {
    return field.items.map((it) => ({
      name: it.name,
      distanceValue: Number.isFinite(it.metersToCenter) ? it.metersToCenter : undefined,
      inSection: undefined,
    }));
  }
  if (isBlank(field.value)) return [];
  return field.value
    .split(/[；;]/)
    .map(parseFacilityToken)
    .filter((p): p is ParsedFacility => p !== null);
}

/** "70%" → { value:70, unit:"%" }; "12M" → { value:12, unit:"M" }; "8" → {8,""}. */
function parseNumberUnit(raw: string): { value: number; unit: string } | null {
  const m = raw.trim().match(/^([\d.]+)\s*(.*)$/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  return { value, unit: m[2].trim() };
}

/** "中山路，寬度18M" / "中山路 18 M" → { label:"中山路", value:18, unit:"M" }. */
function parseMeasurement(raw: string): { label: string; value: number; unit: string } | null {
  const m = raw.match(/^(.+?)[，,]?\s*(?:寬度)?\s*([\d.]+)\s*([^\d\s]*)\s*$/);
  if (!m) return null;
  const value = Number(m[2]);
  if (!Number.isFinite(value)) return null;
  return { label: m[1].replace(/[，,]$/, "").trim(), value, unit: m[3].trim() };
}

// ---------------------------------------------------------------------------
// Leaf value builders (one per content-tree value.type family).
// ---------------------------------------------------------------------------

function textLeaf(raw: string, value: string): Leaf {
  return { raw, value: { type: "text", raw: value, text: value } };
}

function numberLeaf(raw: string, value: string): Leaf {
  const parsed = parseNumberUnit(value);
  if (!parsed) return textLeaf(raw, value); // 非數字就當文字，不丟資料
  return { raw, value: { type: "number", raw: value, value: parsed.value, unit: parsed.unit } };
}

function measurementLeaf(raw: string, value: string): Leaf {
  const parsed = parseMeasurement(value);
  if (!parsed) return textLeaf(raw, value);
  return {
    raw,
    value: { type: "measurement", raw: value, label: parsed.label, value: parsed.value, unit: parsed.unit },
  };
}

/** singleChoice for urban_plan; carries text so fillEngine prints it. */
function urbanPlanLeaf(raw: string, value: string): Leaf {
  const selected = value.includes("外") ? "outsideUrbanPlan" : "insideUrbanPlan";
  return { raw, value: { type: "singleChoice", raw: value, selected, text: value } };
}

/** A single-facility leaf (busStop / interchange / departmentStore / …). Blank -> isExist:false. */
function facilityLeaf(raw: string, field: SurveyField, type: string): Leaf {
  const tokens = facilityTokens(field);
  if (tokens.length === 0) {
    return { raw, value: { type, isExist: false } };
  }
  const first = tokens[0];
  const value: FacilityValue = { type, name: first.name, isExist: true };
  if (first.inSection !== undefined) value.inSection = first.inSection;
  if (first.distanceValue !== undefined) {
    value.distanceValue = first.distanceValue;
    value.distanceUnit = "M";
    // a facility with a measured distance is 本區段外 unless explicitly 本區段內.
    if (value.inSection === undefined) value.inSection = false;
  }
  return { raw, value };
}

/** An array of facility leaves for a fixed-length slot group (school[4] / market[3] / …). */
function facilityArray(field: SurveyField, type: string, slots: number): Leaf[] {
  const tokens = facilityTokens(field).slice(0, slots);
  const out: Leaf[] = [];
  for (let i = 0; i < slots; i++) {
    const t = tokens[i];
    if (!t) {
      out.push({ raw: "", value: { type, isExist: false } });
      continue;
    }
    const value: FacilityValue = { type, name: t.name, isExist: true };
    if (t.inSection !== undefined) value.inSection = t.inSection;
    if (t.distanceValue !== undefined) {
      value.distanceValue = t.distanceValue;
      value.distanceUnit = "M";
      if (value.inSection === undefined) value.inSection = false;
    }
    out.push({ raw: "", value });
  }
  return out;
}

/** checkbox group: split a comma/、-joined multi-select value, mark options checked, rest -> other. */
function checkGroup(raw: string, field: SurveyField, options: string[]): CheckGroup {
  const picked = isBlank(field.value)
    ? []
    : field.value.split(/[、,，;；]/).map((s) => s.trim()).filter(Boolean);
  const items: CheckItem[] = options.map((opt) => ({
    raw: opt,
    checked: picked.some((p) => p === opt || p.includes(opt) || opt.includes(p)),
  }));
  const leftover = picked.filter((p) => !options.some((opt) => p === opt || p.includes(opt) || opt.includes(p)));
  return { raw, items, other: { checked: leftover.length > 0, text: leftover.join("、") } };
}

// ---------------------------------------------------------------------------
// Crosswalk: frontend SurveyField.key -> where it lands in the content tree.
// Kind decides which builder runs. Array kinds carry their fixed slot count + per-index
// facility type. This is the field-level authority, built against coordinates.json.
// ---------------------------------------------------------------------------

type SingleKind =
  | { kind: "text"; cat: string; path: string }
  /** Like "text", but "無" is drawn verbatim instead of being treated as missing data. */
  | { kind: "textAlways"; cat: string; path: string }
  | { kind: "number"; cat: string; path: string }
  | { kind: "measurement"; cat: string; path: string }
  | { kind: "urbanPlan"; cat: string; path: string }
  | { kind: "facility"; cat: string; path: string; type: string }
  | { kind: "checkGroup"; cat: string; path: string; options: string[] };

/**
 * Array-target kinds: several frontend keys share one content-tree array (or one frontend
 * key fans out into a fixed-length array). We collect by (cat, path) and place each key at
 * its index. Each array key declares the shared type.
 */
interface ArraySlot {
  kind: "arraySlot";
  cat: string;
  path: string;
  index: number;
  slots: number;
  type: string;
}
/** A frontend key whose own value fans out into a whole fixed-length facility array. */
interface ArrayFanout {
  kind: "arrayFanout";
  cat: string;
  path: string;
  slots: number;
  type: string;
}

type Mapping = SingleKind | ArraySlot | ArrayFanout;

// 前端 group（中文）→ content tree 頂層分類鍵。用於分類，實際落點以 mapping.cat 為準。
export const GROUP_TO_CATEGORY: Record<string, string> = {
  土地使用管制: "landUseRegulation",
  交通運輸: "trafficAndTransport",
  自然條件: "naturalConditions",
  土地改良: "landImprovement",
  公共建設: "publicInfrastructure",
  特殊設施: "specialFacilities",
  環境污染: "environmentalPollution",
  工商活動: "commercialActivity",
  其他影響因素: "otherFactors",
  房屋建築現況: "buildingCondition",
  土地利用現況: "landUseStatus",
};

const SITE_IMPROVEMENT_OPTIONS = ["整平或填挖基地", "開挖水溝", "水土保持", "鋪築道路", "埋設管道", "修築駁嵌"];
const FARMLAND_IMPROVEMENT_OPTIONS = ["耕地整理", "水土保持", "土壤改良", "修築農路", "灌溉", "排水", "防風", "防砂", "堤防"];
const LAND_USE_STATUS_OPTIONS = ["商業用", "住宅用", "工業用", "住商混合", "住工混合", "農作用", "漁牧用", "空地", "公共設施"];

/**
 * The full crosswalk. Every one of the 60 frontend keys appears exactly once.
 * Authority: fill-district-survey/input/coordinates.json + each samplePrompt DATA_EXAMPLE.
 */
export const SURVEY_CROSSWALK: Record<string, Mapping> = {
  // ── 土地使用管制 → landUseRegulation ──
  urban_plan: { kind: "urbanPlan", cat: "landUseRegulation", path: "insideOutsideUrbanPlan" },
  zone_type: { kind: "text", cat: "landUseRegulation", path: "zoningDesignation" },
  coverage_ratio: { kind: "number", cat: "landUseRegulation", path: "buildingCoverageRatio" },
  plot_ratio: { kind: "number", cat: "landUseRegulation", path: "floorAreaRatio" },
  no_build_ban: { kind: "textAlways", cat: "landUseRegulation", path: "buildingProhibition" },
  build_restriction: { kind: "textAlways", cat: "landUseRegulation", path: "buildingRestriction" },

  // ── 交通運輸 → trafficAndTransport ──
  main_road: { kind: "measurement", cat: "trafficAndTransport", path: "mainRoad" },
  road_avg_width: { kind: "number", cat: "trafficAndTransport", path: "averageRoadWidthInSection" },
  road_development: { kind: "text", cat: "trafficAndTransport", path: "roadConstructionLevel" },
  // majorStation[0..3]: 高鐵/火車/客運/捷運
  hsr_station: { kind: "arraySlot", cat: "trafficAndTransport", path: "majorStation", index: 0, slots: 4, type: "majorStationFacility" },
  train_station: { kind: "arraySlot", cat: "trafficAndTransport", path: "majorStation", index: 1, slots: 4, type: "majorStationFacility" },
  bus_terminal: { kind: "arraySlot", cat: "trafficAndTransport", path: "majorStation", index: 2, slots: 4, type: "majorStationFacility" },
  mrt_station: { kind: "arraySlot", cat: "trafficAndTransport", path: "majorStation", index: 3, slots: 4, type: "majorStationFacility" },
  bus_stop: { kind: "facility", cat: "trafficAndTransport", path: "busStop", type: "busStopFacility" },
  interchange: { kind: "facility", cat: "trafficAndTransport", path: "interchange", type: "interchangeFacility" },
  approach_settlement: { kind: "text", cat: "trafficAndTransport", path: "proximityToSettlement" },
  approach_distribution_center: { kind: "text", cat: "trafficAndTransport", path: "proximityToDistributionCenter" },
  approach_market: { kind: "text", cat: "trafficAndTransport", path: "proximityToMarket" },

  // ── 自然條件 → naturalConditions ──
  drainage: { kind: "text", cat: "naturalConditions", path: "drainageQuality" },
  terrain: { kind: "text", cat: "naturalConditions", path: "terrain" },
  sunlight: { kind: "text", cat: "naturalConditions", path: "sunlight" },
  view: { kind: "text", cat: "naturalConditions", path: "view" },
  slope: { kind: "text", cat: "naturalConditions", path: "slope" },
  wind: { kind: "text", cat: "naturalConditions", path: "windCondition" },
  soil: { kind: "text", cat: "naturalConditions", path: "soilQuality" },

  // ── 土地改良 → landImprovement（checkbox group）──
  site_improvement: { kind: "checkGroup", cat: "landImprovement", path: "buildingSiteImprovement", options: SITE_IMPROVEMENT_OPTIONS },
  farmland_improvement: { kind: "checkGroup", cat: "landImprovement", path: "farmlandImprovement", options: FARMLAND_IMPROVEMENT_OPTIONS },

  // ── 公共建設 → publicInfrastructure ──
  school: { kind: "arrayFanout", cat: "publicInfrastructure", path: "school", slots: 4, type: "schoolFacility" },
  market: { kind: "arrayFanout", cat: "publicInfrastructure", path: "market", slots: 3, type: "marketFacility" },
  park: { kind: "arrayFanout", cat: "publicInfrastructure", path: "parkPlazaPedestrianZone", slots: 3, type: "parkFacility" },
  tourism_facility: { kind: "facility", cat: "publicInfrastructure", path: "touristRecreationFacility", type: "touristRecreationFacility" },
  parking: { kind: "facility", cat: "publicInfrastructure", path: "parkingArea", type: "parkingAreaFacility" },
  service_facility: { kind: "facility", cat: "publicInfrastructure", path: "proximityToServiceFacility", type: "serviceFacilityProximity" },
  power_resource: { kind: "text", cat: "publicInfrastructure", path: "electricPowerResources" },
  industrial_water: { kind: "text", cat: "publicInfrastructure", path: "industrialWaterSupply" },
  sewage_facility: { kind: "facility", cat: "publicInfrastructure", path: "wastewaterTreatmentFacility", type: "wastewaterTreatmentFacility" },

  // ── 特殊設施 → specialFacilities（陣列）──
  // utilityGasFacility[0..1]: 變電所/高壓鐵塔、瓦斯槽/儲油槽
  substation: { kind: "arraySlot", cat: "specialFacilities", path: "utilityGasFacility", index: 0, slots: 2, type: "utilityGasFacility" },
  gas_tank: { kind: "arraySlot", cat: "specialFacilities", path: "utilityGasFacility", index: 1, slots: 2, type: "utilityGasFacility" },
  // funeralFacility[0..3]: 墓地/殯儀館/火葬場/納骨塔
  cemetery: { kind: "arraySlot", cat: "specialFacilities", path: "funeralFacility", index: 0, slots: 4, type: "funeralFacility" },
  funeral_home: { kind: "arraySlot", cat: "specialFacilities", path: "funeralFacility", index: 1, slots: 4, type: "funeralFacility" },
  crematorium: { kind: "arraySlot", cat: "specialFacilities", path: "funeralFacility", index: 2, slots: 4, type: "funeralFacility" },
  columbarium: { kind: "arraySlot", cat: "specialFacilities", path: "funeralFacility", index: 3, slots: 4, type: "funeralFacility" },
  // wasteFacility[0..2]: 污水處理場/垃圾場掩埋場/焚化爐
  sewage_plant: { kind: "arraySlot", cat: "specialFacilities", path: "wasteFacility", index: 0, slots: 3, type: "wasteFacility" },
  landfill: { kind: "arraySlot", cat: "specialFacilities", path: "wasteFacility", index: 1, slots: 3, type: "wasteFacility" },
  incinerator: { kind: "arraySlot", cat: "specialFacilities", path: "wasteFacility", index: 2, slots: 3, type: "wasteFacility" },

  // ── 環境污染 → environmentalPollution[0..4] ──
  water_pollution: { kind: "arraySlot", cat: "environmentalPollution", path: "environmentalPollution", index: 0, slots: 5, type: "environmentalPollution" },
  noise_pollution: { kind: "arraySlot", cat: "environmentalPollution", path: "environmentalPollution", index: 1, slots: 5, type: "environmentalPollution" },
  air_pollution: { kind: "arraySlot", cat: "environmentalPollution", path: "environmentalPollution", index: 2, slots: 5, type: "environmentalPollution" },
  waste_pollution: { kind: "arraySlot", cat: "environmentalPollution", path: "environmentalPollution", index: 3, slots: 5, type: "environmentalPollution" },
  other_pollution: { kind: "arraySlot", cat: "environmentalPollution", path: "environmentalPollution", index: 4, slots: 5, type: "environmentalPollution" },

  // ── 工商活動 → commercialActivity ──
  department_store: { kind: "facility", cat: "commercialActivity", path: "departmentStore", type: "departmentStore" },
  financial_institution: { kind: "facility", cat: "commercialActivity", path: "financialInstitution", type: "financialInstitution" },
  entertainment: { kind: "facility", cat: "commercialActivity", path: "entertainmentFacility", type: "entertainmentFacility" },
  exhibition_hotel: { kind: "facility", cat: "commercialActivity", path: "exhibitionCenterOrHotel", type: "exhibitionCenterOrHotel" },
  customer_flow: { kind: "text", cat: "commercialActivity", path: "customerTraffic" },
  shop_adjacency: { kind: "text", cat: "commercialActivity", path: "storeContiguity" },

  // ── 其他影響因素 → otherFactors（3 類無 draft，反向 mapper 補上）──
  other_factors: { kind: "text", cat: "otherFactors", path: "otherFactors" },

  // ── 房屋建築現況 → buildingCondition ──
  building_density: { kind: "number", cat: "buildingCondition", path: "buildingDensity" },
  building_type: { kind: "text", cat: "buildingCondition", path: "buildingType" },

  // ── 土地利用現況 → landUseStatus（checkbox group：單選也走 checkGroup，勾中的那格）──
  land_use_status: { kind: "checkGroup", cat: "landUseStatus", path: "landUseStatus", options: LAND_USE_STATUS_OPTIONS },
};

/** 所有 crosswalk 覆蓋的前端 key（供測試做 exhaustiveness）。 */
export const SURVEY_CROSSWALK_KEYS = Object.keys(SURVEY_CROSSWALK);

// ---------------------------------------------------------------------------
// The mapper
// ---------------------------------------------------------------------------

function ensureCat(tree: SurveyContentTree, cat: string): Record<string, unknown> {
  if (!tree[cat]) tree[cat] = {};
  return tree[cat] as Record<string, unknown>;
}

/**
 * Convert an appraiser-finalized 表1 `SurveyField[]` into the content tree fill-district-survey
 * draws. Unknown keys are skipped (not fatal) — a warning is logged so a new/renamed field
 * surfaces instead of silently vanishing. `meta`'s `yearPeriod`/`sectionId`/`range` land in
 * `header` (見 coordinates.json 的表頭三格：年期、區段編號、區段範圍，最右邊那格最寬，放
 * `range` 這種長文字如「沿...之第一種住宅區」)。`benchmark` is accepted for signature symmetry
 * with other mappers; it is not drawn by 表1 today.
 */
export function surveyToContentTree(
  survey: SurveyField[],
  meta?: CaseMeta,
  _benchmark?: ComparisonCondition,
): SurveyContentTree {
  const tree: SurveyContentTree = {};

  if (meta) {
    const header: Record<string, unknown> = {};
    if (!isBlank(meta.yearPeriod)) header.yearPeriod = textLeaf("年期", meta.yearPeriod);
    if (!isBlank(meta.sectionId)) header.sectionId = textLeaf("區段編號", meta.sectionId);
    if (!isBlank(meta.range)) header.range = textLeaf("區段範圍", meta.range!);
    if (Object.keys(header).length > 0) tree.header = header;
  }

  // Collect array slots so index-placement across multiple keys lands in one array.
  const arrays = new Map<string, { slots: number; leaves: (Leaf | undefined)[] }>();

  const arrayKey = (cat: string, path: string) => `${cat}.${path}`;

  for (const field of survey) {
    const m = SURVEY_CROSSWALK[field.key];
    if (!m) {
      console.warn(`surveyToContentTree: unknown survey key "${field.key}", skipping`);
      continue;
    }

    switch (m.kind) {
      case "text": {
        if (isBlank(field.value)) break;
        ensureCat(tree, m.cat)[m.path] = textLeaf(field.label, field.value);
        break;
      }
      case "textAlways": {
        if (isEmptyString(field.value)) break;
        ensureCat(tree, m.cat)[m.path] = textLeaf(field.label, field.value);
        break;
      }
      case "number": {
        if (isBlank(field.value)) break;
        ensureCat(tree, m.cat)[m.path] = numberLeaf(field.label, field.value);
        break;
      }
      case "measurement": {
        if (isBlank(field.value)) break;
        ensureCat(tree, m.cat)[m.path] = measurementLeaf(field.label, field.value);
        break;
      }
      case "urbanPlan": {
        if (isBlank(field.value)) break;
        ensureCat(tree, m.cat)[m.path] = urbanPlanLeaf(field.label, field.value);
        break;
      }
      case "facility": {
        ensureCat(tree, m.cat)[m.path] = facilityLeaf(field.label, field, m.type);
        break;
      }
      case "checkGroup": {
        ensureCat(tree, m.cat)[m.path] = checkGroup(field.label, field, m.options);
        break;
      }
      case "arrayFanout": {
        // One frontend field's multiple tokens fan out into a whole fixed-length array.
        ensureCat(tree, m.cat)[m.path] = { items: facilityArray(field, m.type, m.slots) };
        break;
      }
      case "arraySlot": {
        // Several frontend keys each occupy one index of a shared array.
        const k = arrayKey(m.cat, m.path);
        let bucket = arrays.get(k);
        if (!bucket) {
          bucket = { slots: m.slots, leaves: new Array(m.slots).fill(undefined) };
          arrays.set(k, bucket);
        }
        bucket.leaves[m.index] = facilityLeaf(field.label, field, m.type);
        break;
      }
    }
  }

  // Materialize collected arraySlot buckets. Empty indices become isExist:false leaves so
  // the array length matches coordinates.json (fillEngine walks by index).
  for (const [k, bucket] of arrays) {
    const [cat, path] = k.split(".");
    const items = bucket.leaves.map((leaf) => {
      if (leaf) return leaf;
      // Recover the shared type from any populated leaf, else fall back to "text".
      const sample = bucket.leaves.find((l): l is Leaf => !!l);
      const type = sample && "type" in (sample.value as object) ? (sample.value as LeafValue).type : "text";
      return { raw: "", value: { type, isExist: false } as FacilityValue };
    });
    ensureCat(tree, cat)[path] = { items };
  }

  return tree;
}
