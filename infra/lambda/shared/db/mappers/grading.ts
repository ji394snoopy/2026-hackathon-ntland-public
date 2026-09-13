// Grading mapper — the single place that translates cli's grading CLI output
// (`graded.json`) into the frontend-facing / case-store shapes. This is the core of
// stage 1 of grading-pipelines-cloud-plan §2.2: cli's `graded.json` is a nested,
// key-first, single-parcel structure; the frontend `RegionalFactorRow[]` is a flat array
// with a `compare[]` column. The two vocabularies do NOT share keys — cli uses its own
// English keys (`insideOutsideUrbanPlan`, `mainRoadWidth`, …) and the frontend uses a
// separate set (`urban_plan_r`, `road_r`, …, from frontend/src/lib/regionalFactorGroups.ts).
// So this file carries an explicit hand-built crosswalk (cli item key -> frontend
// {key,label,group}) built against the official 表5 28-item layout.
//
// meta / benchmark are near-identity (see mapGradedMeta / mapGradedBenchmark): cli's
// graded.json.meta lines up with CaseMeta and graded.json.benchmark lines up field-for-
// field with ComparisonCondition (28 cols). They're copied through with light shaping.
//
// The cli CLI logic is untouched: these mappers consume its output shape only.

import type {
    CaseMeta,
    ComparisonCondition,
    RegionalFactorCompare,
    RegionalFactorRow
} from "../types";

// ---------------------------------------------------------------------------
// cli graded.json shape (input) — mirrors
// cli/src/{regionalFactorGrading,individualFactorGrading}/resolveGrades.ts output plus
// the { meta, benchmark, ...graded } envelope written by their main.ts. Declared here (not
// imported from cli) so the shared DB layer takes no cross-package type dependency;
// the shapes are asserted against the real exampleOutput fixtures in grading.test.ts.
// ---------------------------------------------------------------------------

export interface GradedMeta {
  yearPeriod: string;
  sectionId: string;
  district: string;
  landUseType: string;
  benchmarkParcel: string;
  surveyDate: string;
  range: string;
  location: { lat: number; lng: number };
}

/** cli graded.json.benchmark — field-for-field the same 28 cols as ComparisonCondition. */
export type GradedBenchmark = ComparisonCondition;

export interface GradedSelectedGrade {
  key: string; // superior / slightlySuperior / average / slightlyInferior / inferior
  raw: string; // 優 / 稍優 / 普通 / 稍劣 / 劣
  value: number; // 修正點數 (correction points, ≤ 0)
  rate: number; // 1-based rank within the item's grades (優 = 1)
}

/** A facility/proximity display value (表4 raw-condition column); or a plain string. */
export type GradedItemValue = string | { name: string; distance: string; unit: string };

export interface GradedRegionalItem {
  key: string;
  raw: string;
  selectedGrade: GradedSelectedGrade;
}

// ---------------------------------------------------------------------------
// cli comparison.json shape (input for the regional mapper) — mirrors
// cli/src/gradingComparison/main.ts output. This is what the mapper actually consumes
// (per plan §1.5 decision 1): it carries base + one comparables[] entry per comparison
// target, so it can fill RegionalFactorRow.compare[]. (graded.json is single-parcel and
// cannot.) Declared here so the shared layer takes no cli type dependency; asserted
// against the real comparison.json fixture in grading.test.ts.
// ---------------------------------------------------------------------------

export interface ComparisonGrade {
  key: string;
  raw: string; // 優 / 稍優 / 普通 / 稍劣 / 劣
  value: number; // 修正點數
  rate: number; // 等級序 (優=1)
}

export interface ComparisonComparable {
  label: string; // 比較標的識別 (argv-derived: "1" / "2" / "3")
  grade: ComparisonGrade | null; // null 若該標的未評此項
  delta: number | null; // base.value - grade.value; null 若任一側缺
}

export interface ComparisonItem {
  categoryKey: string;
  categoryRaw: string;
  itemKey: string;
  itemRaw: string;
  base: ComparisonGrade | null; // 比準地此項等級; null 若比準地未評
  comparables: ComparisonComparable[];
}

export interface ComparisonCategory {
  categoryKey: string;
  categoryRaw: string;
  items: ComparisonItem[];
}

export interface ComparisonResult {
  categories: ComparisonCategory[];
  sectionIdBase: string;
  comparableSectionIds: { label: string; sectionId: string }[];
  totalScoreBase: number;
  comparableTotalScores: { label: string; total: number; delta: number }[];
}

export interface GradedIndividualItem extends GradedRegionalItem {
  // individualFactorGrading additionally carries the parcel's own display value per item.
  value?: GradedItemValue | null;
}

export interface GradedCategory<Item> {
  key: string;
  raw: string;
  items: Item[];
}

export interface RegionalGradedResult {
  meta: GradedMeta;
  benchmark: GradedBenchmark;
  regionalFactors: {
    raw: string;
    categories: GradedCategory<GradedRegionalItem>[];
  };
  totalScore: number;
}

export interface IndividualGradedResult {
  meta: GradedMeta;
  benchmark: GradedBenchmark;
  individualFactors: {
    raw: string;
    categories: GradedCategory<GradedIndividualItem>[];
  };
  totalScore: number;
}

// ---------------------------------------------------------------------------
// meta / benchmark — near identity
// ---------------------------------------------------------------------------

/** graded.json.meta -> CaseMeta (identity; range/location kept as optional-compatible). */
export function mapGradedMeta(meta: GradedMeta): CaseMeta {
  return {
    yearPeriod: meta.yearPeriod,
    sectionId: meta.sectionId,
    district: meta.district,
    landUseType: meta.landUseType,
    benchmarkParcel: meta.benchmarkParcel,
    surveyDate: meta.surveyDate,
    range: meta.range,
    location: meta.location,
  };
}

/** graded.json.benchmark -> ComparisonCondition (identity — same 28 cols). */
export function mapGradedBenchmark(benchmark: GradedBenchmark): ComparisonCondition {
  return { ...benchmark };
}

// ---------------------------------------------------------------------------
// Regional crosswalk: cli item key -> frontend { key, label, group }
// Built from frontend/src/lib/regionalFactorGroups.ts (the authoritative 表5-2 layout).
// group titles align 1:1 with cli's category raw labels; item labels come from the
// frontend definition so a stored RegionalFactorRow matches what the UI already renders.
// ---------------------------------------------------------------------------

interface FrontendFactor {
  key: string;
  label: string;
  group: string;
}

const REGIONAL_CROSSWALK: Record<string, FrontendFactor> = {
  // 1. 土地使用管制
  insideOutsideUrbanPlan: { key: "urban_plan_r", label: "都市計畫（內、外）", group: "土地使用管制" },
  zoningDesignation: { key: "zone_type_r", label: "使用分區（使用地類別）", group: "土地使用管制" },
  buildingCoverageRatio: { key: "coverage_ratio_r", label: "建蔽率", group: "土地使用管制" },
  floorAreaRatio: { key: "plot_ratio_r", label: "容積率", group: "土地使用管制" },
  buildingProhibition: { key: "no_build_ban_r", label: "有無禁止建築", group: "土地使用管制" },
  buildingRestriction: {
    key: "build_restriction_r",
    label: "有無限制建築（整體開發、面積限制、高度限制……等）",
    group: "土地使用管制",
  },
  // 2. 交通運輸
  mainRoadWidth: { key: "road_r", label: "主要道路寬度", group: "交通運輸" },
  averageRoadWidthInSection: { key: "road_avg_width_r", label: "區段內道路平均寬度", group: "交通運輸" },
  proximityToMajorStation: { key: "station_access_r", label: "接近大型車站之程度", group: "交通運輸" },
  proximityToBusStop: { key: "bus_r", label: "站牌之接近程度或密集程度", group: "交通運輸" },
  proximityToInterchange: {
    key: "interchange_r",
    label: "交流道之有無及接近交流道之程度",
    group: "交通運輸",
  },
  roadPlanningAndConstructionLevel: {
    key: "road_plan_r",
    label: "區段內道路規劃及闢建程度",
    group: "交通運輸",
  },
  // 3. 自然條件
  drainageQuality: { key: "drain_r", label: "排水之良否", group: "自然條件" },
  terrain: { key: "terrain_r", label: "地勢", group: "自然條件" },
  // 4. 公共建設
  proximityToMarket: {
    key: "market_r",
    label: "接近市場之程度（傳統市場、超級市場、超大型購物中心）",
    group: "公共建設",
  },
  proximityToParkPlazaPedestrianZone: {
    key: "park_r",
    label: "接近公園（里鄰公園、一般公園）、廣場、徒步區之程度",
    group: "公共建設",
  },
  proximityToTouristRecreationFacility: {
    key: "recreation_access_r",
    label: "接近觀光遊憩設施之程度",
    group: "公共建設",
  },
  parkingConvenience: { key: "parking_r", label: "停車場地之便利程度", group: "公共建設" },
  // 5. 特殊設施
  proximityToUtilityGasFacility: {
    key: "power_r",
    label: "電業設施及公用氣體燃料設施之有無及接近程度",
    group: "特殊設施",
  },
  proximityToFuneralFacility: {
    key: "cemetery_r",
    label: "殯葬設施之有無及接近程度",
    group: "特殊設施",
  },
  proximityToWasteFacility: {
    key: "waste_facility_r",
    label: "廢棄物處理設施之有無及接近程度",
    group: "特殊設施",
  },
  // 6. 環境污染
  proximityToPollutionSource: {
    key: "air_r",
    label: "水污染、噪音污染、廢氣污染、廢棄物污染等之有無及接近程度",
    group: "環境污染",
  },
  // 7. 工商活動
  proximityToDepartmentStore: {
    key: "dept_store_r",
    label: "百貨公司之有無、數量、接近程度",
    group: "工商活動",
  },
  proximityToFinancialInstitution: {
    key: "financial_r",
    label: "金融機構之有無、數量、接近程度",
    group: "工商活動",
  },
  proximityToEntertainmentFacility: {
    key: "entertainment_r",
    label: "娛樂設施之有無、數量、接近程度",
    group: "工商活動",
  },
  proximityToExhibitionCenterOrHotel: {
    key: "exhibition_hotel_r",
    label: "大型展示中心或觀光飯店之有無、數量、接近程度",
    group: "工商活動",
  },
  customerTrafficVolume: { key: "customer_flow_r", label: "顧客通行量之多寡", group: "工商活動" },
  shopContiguityRatio: { key: "shop_frontage_r", label: "店舖之毗連狀態", group: "工商活動" },
};

/** All cli regional item keys the crosswalk covers (for exhaustiveness assertions). */
export const REGIONAL_CROSSWALK_KEYS = Object.keys(REGIONAL_CROSSWALK);

// ---------------------------------------------------------------------------
// Regional mapper: graded.json -> RegionalFactorRow[]
// ---------------------------------------------------------------------------

/**
 * comparison.json (gradingComparison) -> flat RegionalFactorRow[].
 *
 * Consumes gradingComparison's output (base + comparables per item; plan §1.5 decision 1)
 * so it can fill compare[]. Flattens categories[].items[] into one row per item, translates
 * cli's item key to the frontend {key,label,group} via REGIONAL_CROSSWALK, and:
 *   - subject.grade  <- item.base.raw (優/普通/劣); subject.points/rank <- base.value/rate.
 *   - compare[]      <- one entry per item.comparables[]:
 *       grade <- c.grade.raw; points/rank <- c.grade.value/rate; delta <- c.delta;
 *       rate  = null  (修正率 % is computed by the frontend — plan §1.5 decision 2);
 *       sectionId <- comparableSectionIds[label]; sameSectionAsBenchmark = (that == sectionIdBase).
 *   - reference is left UNSET on both subject and compare (no evidence source today —
 *       plan §1.5 decision 3). Grade points are preserved on the new points/rank fields.
 *
 * Unknown cli keys (should not happen for the fixed 28-item 表5) pass through with the
 * cli key/raw and a warning rather than being dropped, so nothing silently disappears.
 */
export function mapRegionalComparisonToRows(
  comparison: ComparisonResult,
): RegionalFactorRow[] {
  // label -> sectionId, for resolving each comparable's 區段 and same-section flag.
  const sectionByLabel = new Map(
    comparison.comparableSectionIds.map((s) => [s.label, s.sectionId]),
  );

  const buildCompare = (c: ComparisonComparable): RegionalFactorCompare => {
    const sectionId = sectionByLabel.get(c.label) ?? "";
    return {
      sectionId,
      sameSectionAsBenchmark: sectionId === comparison.sectionIdBase,
      grade: c.grade?.raw ?? "",
      rate: null, // 修正率 % 由前端算 (decision 2)
      ...(c.grade ? { points: c.grade.value, rank: c.grade.rate } : {}),
      ...(c.delta != null ? { delta: c.delta } : {}),
      // reference intentionally unset (decision 3)
    };
  };

  const rows: RegionalFactorRow[] = [];
  for (const category of comparison.categories) {
    for (const item of category.items) {
      const mapped = REGIONAL_CROSSWALK[item.itemKey];
      const subject: RegionalFactorRow["subject"] = {
        grade: item.base?.raw ?? "",
        ...(item.base ? { points: item.base.value, rank: item.base.rate } : {}),
        // reference intentionally unset (decision 3)
      };
      const compare = item.comparables.map(buildCompare);
      if (mapped) {
        rows.push({ key: mapped.key, label: mapped.label, group: mapped.group, subject, compare });
      } else {
        rows.push({
          key: item.itemKey,
          label: item.itemRaw,
          group: item.categoryRaw,
          subject: {
            ...subject,
            warning: `未知的區域因素 key「${item.itemKey}」，未在前端對照表中；已原樣保留。`,
          },
          compare,
        });
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Individual mapper — Option B (per user decision): return a grading-shaped structure,
// NOT forced into FactorRow[] (which carries a rate, not a grade). API_INTEGRATION.md has
// no grade-carrying 表4 row type, so this is an infra-side shape; the 表4 frontend contract
// / the produce-comparison relationship is a stage-2 wiring decision.
// ---------------------------------------------------------------------------

/** One graded 表4 個別因素 row: cli key/label + selected grade + parcel display value. */
export interface IndividualGradedRow {
  key: string; // cli item key (kept as-is; no frontend crosswalk exists for 表4 grades)
  label: string; // cli item raw label (中文)
  group: string; // cli category raw label (宗地條件 / 道路條件 / …)
  grade: string; // 優 / 稍優 / 普通 / 稍劣 / 劣
  gradeKey: string; // superior / … (cli grade key)
  value: number; // 修正點數 (selectedGrade.value)
  rate: number; // 等級序 (selectedGrade.rate)
  displayValue?: GradedItemValue | null; // parcel's own value for this item (表4 raw column)
}

export interface IndividualGraded {
  meta: CaseMeta;
  benchmark: ComparisonCondition;
  rows: IndividualGradedRow[];
  totalScore: number;
}

/**
 * graded.json (individualFactorGrading) -> flat grading-shaped rows (Option B).
 *
 * Flattens categories[].items[] into one row per item, keeping cli's own keys/labels
 * (no frontend key crosswalk exists for 表4 grades) and carrying grade + correction value +
 * the parcel's per-item display value through. meta/benchmark are mapped near-identity.
 */
export function mapIndividualGraded(graded: IndividualGradedResult): IndividualGraded {
  const rows: IndividualGradedRow[] = [];
  for (const category of graded.individualFactors.categories) {
    for (const item of category.items) {
      const g = item.selectedGrade;
      rows.push({
        key: item.key,
        label: item.raw,
        group: category.raw,
        grade: g.raw,
        gradeKey: g.key,
        value: g.value,
        rate: g.rate,
        displayValue: item.value ?? null,
      });
    }
  }
  return {
    meta: mapGradedMeta(graded.meta),
    benchmark: mapGradedBenchmark(graded.benchmark),
    rows,
    totalScore: graded.totalScore,
  };
}

// ---------------------------------------------------------------------------
// Reverse regional mapper: RegionalFactorRow[] -> fill-regional-analysis content tree
// ---------------------------------------------------------------------------
//
// The inverse of mapRegionalComparisonToRows, for the 表5 PDF path (斷點3 路 B). fill-
// regional-analysis draws by matching a comparison-shaped content tree against its
// coordinates by the printed Chinese label (categoryRaw/itemRaw) — NOT by cli/frontend
// key (see fill-regional-analysis/fillEngine.ts). So this mapper turns the stored / edited
// frontend `RegionalFactorRow[]` (表5 定稿, from case-store or produce-regional-factors)
// back into `{ categories:[{categoryRaw, items:[{itemRaw, base, comparables}], comparableTotals}],
// sectionIdBase, comparableSectionIds, comparableTotalScores }`.
//
// What each field maps to (RegionalFactorRow -> content):
//   - itemRaw / categoryRaw  <- the frontend row's label / group (already the printed 中文;
//       these are what fillEngine matches on, after its bracket-normalization).
//   - base            <- { rate: subject.rank, raw: subject.grade }.
//   - comparables[i]  <- { label, grade:{ rate: rank, raw: grade }, delta } from compare[i].
//       label is the 1-based comparable index as a string ("1".."3"), matching how
//       fill-regional-analysis / gradingComparison label comparables.
//   - comparableSectionIds <- distinct compare[i].sectionId per index.
//   - comparableTotals (per category) / comparableTotalScores (grand) <- Σ delta per label.
//
// Grades with no rank/grade are omitted (base/grade left undefined) so fillEngine simply
// draws nothing for that cell rather than a bogus 0. rate (修正率 %) is not drawn per item
// by fillEngine (it draws delta), so compare[].rate being null is fine.

interface RegionalGradeCell {
  rate: number;
  raw: string;
}
interface RegionalComparableCell {
  label: string;
  grade?: RegionalGradeCell;
  delta?: number;
}
interface RegionalContentItem {
  itemRaw: string;
  base?: RegionalGradeCell;
  comparables: RegionalComparableCell[];
}
interface RegionalContentCategory {
  categoryRaw: string;
  items: RegionalContentItem[];
  comparableTotals: { label: string; delta: number }[];
}

/** The content tree fill-regional-analysis draws (its `content`, sans `purpose`). */
export interface RegionalAnalysisContent {
  sectionIdBase: string;
  comparableSectionIds: { label: string; sectionId: string }[];
  comparableTotalScores: { label: string; delta: number }[];
  categories: RegionalContentCategory[];
}

function toGradeCell(grade: string, rank: number | undefined): RegionalGradeCell | undefined {
  if (!grade || rank == null) return undefined;
  return { rate: rank, raw: grade };
}

/**
 * RegionalFactorRow[] (表5 定稿) -> fill-regional-analysis content tree.
 *
 * `sectionIdBase` is the 比準地 區段 (from meta/caller). Comparables are keyed positionally
 * ("1".."2".."3") off each row's compare[] index — every row is assumed to carry the same
 * comparables in the same order (which is how produce-regional-factors builds them).
 */
export function regionalRowsToAnalysisContent(
  rows: RegionalFactorRow[],
  sectionIdBase: string,
): RegionalAnalysisContent {
  // Group rows into categories, preserving first-seen category order.
  const categoryOrder: string[] = [];
  const byCategory = new Map<string, RegionalContentItem[]>();

  // comparable label -> sectionId (first non-empty wins) + running Σ delta (grand total).
  const sectionByLabel = new Map<string, string>();
  const grandDelta = new Map<string, number>();

  for (const row of rows) {
    const group = row.group || "其他影響因素";
    if (!byCategory.has(group)) {
      byCategory.set(group, []);
      categoryOrder.push(group);
    }

    const comparables: RegionalComparableCell[] = (row.compare ?? []).map((c, i) => {
      const label = String(i + 1);
      if (c.sectionId && !sectionByLabel.has(label)) sectionByLabel.set(label, c.sectionId);
      if (c.delta != null) grandDelta.set(label, (grandDelta.get(label) ?? 0) + c.delta);
      const cell: RegionalComparableCell = { label };
      const grade = toGradeCell(c.grade, c.rank);
      if (grade) cell.grade = grade;
      if (c.delta != null) cell.delta = c.delta;
      return cell;
    });

    byCategory.get(group)!.push({
      itemRaw: row.label,
      base: toGradeCell(row.subject?.grade ?? "", row.subject?.rank),
      comparables,
    });
  }

  // Per-category comparable subtotals (Σ delta within the category, per label).
  const categories: RegionalContentCategory[] = categoryOrder.map((categoryRaw) => {
    const items = byCategory.get(categoryRaw)!;
    const subtotal = new Map<string, number>();
    for (const item of items) {
      for (const c of item.comparables) {
        if (c.delta != null) subtotal.set(c.label, (subtotal.get(c.label) ?? 0) + c.delta);
      }
    }
    const comparableTotals = [...subtotal.entries()].map(([label, delta]) => ({ label, delta }));
    return { categoryRaw, items, comparableTotals };
  });

  const comparableSectionIds = [...sectionByLabel.entries()].map(([label, sectionId]) => ({
    label,
    sectionId,
  }));
  const comparableTotalScores = [...grandDelta.entries()].map(([label, delta]) => ({ label, delta }));

  return { sectionIdBase, comparableSectionIds, comparableTotalScores, categories };
}

// ---------------------------------------------------------------------------
// 表4 mapper: ComparisonForm -> fill-individual-analysis content tree
// ---------------------------------------------------------------------------
//
// 表4（比較法調查估價表 個別因素 PDF）的填表 lambda 吃的 content tree 靠 categoryKey::itemKey
// （英文 key）比對 coordinates（見 fill-individual-analysis/fillEngine.ts）。前端表4 定稿是
// ComparisonForm（benchmark: ComparisonCondition + cases: ComparisonFormCase[]）。這支把它轉回
// content tree，讓 export-report 匯出時表4 填得出值。
//
// 每項的資料來源（19 項，對應表見下方 INDIVIDUAL_ITEM_MAP）：
//   - base.value          <- benchmark 的對應宗地條件欄（string，或 6 個設施/道路項的 {name,distance,unit:"M"}）
//   - comparables[i].item.value <- 第 i 個 case 的同名條件欄
//   - comparables[i].delta      <- 第 i 個 case 的 rates[rateKey]（= 修正率%）
// 頂層：sectionIdBase/locationBase <- benchmark；comparableIdentities <- cases（caseNo/sectionId/location）；
//       comparableTotalScores[].delta <- Σ 該 case.rates（individualTotal）。
// 另附一個空的 otherFactors 類，觸發 fillEngine 的 "-" 佔位列（對齊 CLI comparison.json）。
//
// 對應表是 mergeComparison.ts 的 CLI_TO_RATE_KEY / conditionColumns 的等價逆整理。

/** condKey: ComparisonCondition / ComparisonFormCase 上的條件欄位名（string 型）。 */
interface IndividualItemSpec {
  categoryKey: string;
  itemKey: string;
  /** rates 上的數字欄位名（= delta 來源）。 */
  rateKey: string;
  /** 純字串型：直接取這個條件欄位。 */
  condKey?: string;
  /** {name,distance,unit} 型：name/distance 各取一個條件欄位（unit 固定 "M"）。 */
  nameKey?: string;
  distanceKey?: string;
}

/** 19 項（依官方表4 欄序），分 5 類。設施/道路 6 項為 {name,distance,unit}，其餘為字串。 */
const INDIVIDUAL_ITEM_MAP: IndividualItemSpec[] = [
  // 宗地條件 lotCondition
  { categoryKey: "lotCondition", itemKey: "area", rateKey: "area", condKey: "area" },
  { categoryKey: "lotCondition", itemKey: "width", rateKey: "width", condKey: "width" },
  { categoryKey: "lotCondition", itemKey: "depth", rateKey: "depth", condKey: "depth" },
  { categoryKey: "lotCondition", itemKey: "shape", rateKey: "shape", condKey: "shape" },
  { categoryKey: "lotCondition", itemKey: "roadFrontageCondition", rateKey: "frontage", condKey: "frontage" },
  { categoryKey: "lotCondition", itemKey: "terrain", rateKey: "terrain", condKey: "terrain" },
  // 道路條件 roadCondition
  { categoryKey: "roadCondition", itemKey: "roadType", rateKey: "roadType", condKey: "roadType" },
  { categoryKey: "roadCondition", itemKey: "frontageRoadWidth", rateKey: "roadWidth", nameKey: "roadName", distanceKey: "roadWidth" },
  // 接近條件 proximityCondition（全 {name,distance,unit}）
  { categoryKey: "proximityCondition", itemKey: "proximityToSchool", rateKey: "school", nameKey: "schoolName", distanceKey: "schoolDistance" },
  { categoryKey: "proximityCondition", itemKey: "proximityToMarket", rateKey: "market", nameKey: "marketName", distanceKey: "marketDistance" },
  { categoryKey: "proximityCondition", itemKey: "proximityToParkPlaza", rateKey: "park", nameKey: "parkName", distanceKey: "parkDistance" },
  { categoryKey: "proximityCondition", itemKey: "proximityToStation", rateKey: "station", nameKey: "stationName", distanceKey: "stationDistance" },
  { categoryKey: "proximityCondition", itemKey: "proximityToCommercialDistrict", rateKey: "district", nameKey: "districtName", distanceKey: "districtDistance" },
  // 周邊環境條件 surroundingEnvironment
  { categoryKey: "surroundingEnvironment", itemKey: "presenceOfNoxiousFacility", rateKey: "disamenity", nameKey: "disamenityName", distanceKey: "disamenityDistance" },
  { categoryKey: "surroundingEnvironment", itemKey: "parkingConvenience", rateKey: "parking", condKey: "parking" },
  // 行政條件 administrativeCondition
  { categoryKey: "administrativeCondition", itemKey: "zoningDesignation", rateKey: "zoning", condKey: "zoning" },
  { categoryKey: "administrativeCondition", itemKey: "buildingCoverageRatio", rateKey: "coverageRatio", condKey: "coverageRatio" },
  { categoryKey: "administrativeCondition", itemKey: "floorAreaRatio", rateKey: "plotRatio", condKey: "plotRatio" },
  { categoryKey: "administrativeCondition", itemKey: "buildingProhibitionOrRestriction", rateKey: "buildRestriction", condKey: "buildRestriction" },
];

/** 5 類的出現順序（分組用）。 */
const INDIVIDUAL_CATEGORY_ORDER = [
  "lotCondition",
  "roadCondition",
  "proximityCondition",
  "surroundingEnvironment",
  "administrativeCondition",
];

type ConditionLike = Record<string, unknown>;
type CaseLike = ConditionLike & { caseNo?: string; sectionId?: string; location?: string; rates?: Record<string, number> };

/** 一項的值：純字串 或 {name,distance,unit}。取不到回空字串（fillEngine 會略過 undefined，但空字串仍畫空）。 */
function individualItemValue(spec: IndividualItemSpec, src: ConditionLike): string | { name: string; distance: string; unit: string } {
  if (spec.nameKey && spec.distanceKey) {
    return {
      name: String(src[spec.nameKey] ?? ""),
      distance: String(src[spec.distanceKey] ?? ""),
      unit: "M",
    };
  }
  return String(src[spec.condKey!] ?? "");
}

/** Σ 一個 case 的 19 個 rate（= 該標的 individualTotal，填 comparableTotalScores.delta）。 */
function sumRates(rates: Record<string, number> | undefined): number {
  if (!rates) return 0;
  let s = 0;
  for (const spec of INDIVIDUAL_ITEM_MAP) {
    const v = rates[spec.rateKey];
    if (typeof v === "number" && Number.isFinite(v)) s += v;
  }
  return Math.round(s * 100) / 100;
}

/** 每個比較標的的價格鏈欄位(表4 下半部：土地正常單價/交易日期/調整百分率/調整至估價基準日
 * 單價/區域因素調整百分率/調整百分率絕對值加總/價格形成因素之相近程度/試算價格/比較標的
 * 權重)。全部選填——上游(mergeComparison)缺哪個就不畫哪個,不補假資料。 */
export interface PriceSummaryCase {
  label: string;
  normalPrice?: number;
  tradeDate?: string;
  dateAdjRate?: number;
  adjustedPrice?: number;
  regionalAdjRate?: number;
  absRateSum?: number;
  priceSimilarity?: string;
  weight?: string;
  trialPrice?: number;
}

/** 表4 頁首/頁尾的價格鏈區塊(案號/估價基準日/比準地比較價格 + 各比較標的價格鏈)。 */
export interface PriceSummary {
  appraisalBaseDate?: string;
  caseCode?: string;
  benchmarkComparedPrice?: number;
  cases: PriceSummaryCase[];
}

/** fill-individual-analysis 吃的 content tree（其 body，直接 POST）。 */
export interface IndividualAnalysisContent {
  sectionIdBase: string;
  locationBase: string;
  comparableIdentities: { label: string; sectionId: string; location: string }[];
  comparableTotalScores: { label: string; delta: number }[];
  categories: {
    categoryKey: string;
    items: {
      categoryKey: string;
      itemKey: string;
      base: { value: string | { name: string; distance: string; unit: string } };
      comparables: { label: string; item: { value: string | { name: string; distance: string; unit: string } }; delta: number }[];
    }[];
  }[];
  priceSummary: PriceSummary;
}

/**
 * ComparisonForm (表4 定稿) -> fill-individual-analysis content tree。
 *
 * benchmark 填比準地側（base.value）；cases[] 每筆填一個比較標的欄（comparables[].item.value）
 * 與其修正率（delta = case.rates[rateKey]）。label 用 case.caseNo（"1".."3"），對齊 coordinates。
 */
export function comparisonFormToContentTree(form: {
  benchmark: ConditionLike;
  cases: CaseLike[];
  appraisalBaseDate?: string;
  caseCode?: string;
  benchmarkComparedPrice?: number;
}): IndividualAnalysisContent {
  const benchmark = form.benchmark ?? {};
  const cases = Array.isArray(form.cases) ? form.cases : [];
  const labelOf = (c: CaseLike, i: number) => (typeof c.caseNo === "string" && c.caseNo ? c.caseNo : String(i + 1));
  const numOrUndefined = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const strOrUndefined = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

  const categories = INDIVIDUAL_CATEGORY_ORDER.map((categoryKey) => {
    const specs = INDIVIDUAL_ITEM_MAP.filter((s) => s.categoryKey === categoryKey);
    const items = specs.map((spec) => ({
      categoryKey: spec.categoryKey,
      itemKey: spec.itemKey,
      base: { value: individualItemValue(spec, benchmark) },
      comparables: cases.map((c, i) => ({
        label: labelOf(c, i),
        item: { value: individualItemValue(spec, c) },
        delta: typeof c.rates?.[spec.rateKey] === "number" ? c.rates![spec.rateKey] : 0,
      })),
    }));
    return { categoryKey, items };
  });

  // 空的 otherFactors 類 → 觸發 fillEngine 的 "-" 佔位列。
  categories.push({ categoryKey: "otherFactors", items: [] });

  return {
    sectionIdBase: String(benchmark.sectionId ?? ""),
    locationBase: String(benchmark.location ?? ""),
    comparableIdentities: cases.map((c, i) => ({
      label: labelOf(c, i),
      sectionId: String(c.sectionId ?? ""),
      location: String(c.location ?? ""),
    })),
    comparableTotalScores: cases.map((c, i) => ({ label: labelOf(c, i), delta: sumRates(c.rates) })),
    categories,
    priceSummary: {
      appraisalBaseDate: strOrUndefined(form.appraisalBaseDate),
      caseCode: strOrUndefined(form.caseCode),
      benchmarkComparedPrice: numOrUndefined(form.benchmarkComparedPrice),
      cases: cases.map((c, i) => ({
        label: labelOf(c, i),
        normalPrice: numOrUndefined(c.normalPrice),
        tradeDate: strOrUndefined(c.tradeDate),
        dateAdjRate: numOrUndefined(c.dateAdjRate),
        adjustedPrice: numOrUndefined(c.adjustedPrice),
        regionalAdjRate: numOrUndefined(c.regionalAdjRate),
        absRateSum: numOrUndefined(c.absRateSum),
        priceSimilarity: strOrUndefined(c.priceSimilarity),
        weight: strOrUndefined(c.weight),
        trialPrice: numOrUndefined(c.trialPrice),
      })),
    },
  };
}
