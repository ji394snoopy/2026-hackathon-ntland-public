import type { CategoryName } from "./categories.js";

// ---------------------------------------------------------------------------
// facts contract — a trimmed view of the nearby-facilities API's
// NearbyFacilitiesResponse (see API_INTEGRATION.md §2). We copy only the fields
// the districtSurvey draft prompts actually consume; the real response carries
// more (doorplate, lon/lat, etc.) that we ignore here. Everything is optional /
// defensively typed because facts arrive from an external caller (orchestrator /
// the A facilities lambda) and this handler must degrade gracefully.
// ---------------------------------------------------------------------------

/** One facility as returned in the flat `facilities` list / a category's `items`. */
interface FactFacilityItem {
  /** Chinese category label, e.g. "捷運站" / "文教設施" / "金融機構". */
  kind?: string;
  /** Stable classification key (OSM/NLSC only), e.g. "education" / "bank". Station data has none. */
  category?: string;
  name?: string | null;
  /** Straight-line distance to the query center (or polygon centroid), in meters. */
  metersToCenter?: number;
}

/** One of the six `byCategory` rollups. */
interface FactCategorySummary {
  count?: number;
  nearest?: { kind?: string; name?: string | null; metersToCenter?: number } | null;
  items?: FactFacilityItem[];
}

/**
 * The subset of NearbyFacilitiesResponse this handler understands. `byCategory`
 * is keyed by the six Chinese rollup names from API_INTEGRATION.md
 * (交通 / 公共設施 / 公共建設 / 特殊設施 / 工商活動 / 其他). `facilities` is the
 * flat, distance-sorted list. Both optional so partial payloads still work.
 */
interface NearbyFacilitiesFacts {
  byCategory?: Record<string, FactCategorySummary | undefined>;
  facilities?: FactFacilityItem[];
}

/** The six `byCategory` rollup keys, per API_INTEGRATION.md's 六大類 table. */
const ROLLUP = {
  traffic: "交通",
  publicFacilities: "公共設施",
  publicInfrastructure: "公共建設",
  specialFacilities: "特殊設施",
  commercialActivity: "工商活動",
  other: "其他",
} as const;

/**
 * A facility narrowed down to the fields a prompt needs, with a guaranteed
 * `kind` string (falls back to category / name / "設施" when absent). This is
 * what each category prompt builder receives — already filtered and cleaned.
 */
interface RelevantFacility {
  kind: string;
  name: string | null;
  metersToCenter: number | null;
}

/** The per-category facts slice handed to a category's prompt builder. */
interface CategoryFacts {
  /** Which districtSurvey category this slice was picked for. */
  category: CategoryName;
  /** Relevant facilities for this category, distance-sorted (nearest first). */
  facilities: RelevantFacility[];
}

function cleanFacility(item: FactFacilityItem | undefined): RelevantFacility | null {
  if (!item) return null;
  const kind = (item.kind ?? item.category ?? item.name ?? "").trim() || "設施";
  const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : null;
  const meters =
    typeof item.metersToCenter === "number" && Number.isFinite(item.metersToCenter)
      ? item.metersToCenter
      : null;
  return { kind, name, metersToCenter: meters };
}

function collectRollups(
  facts: NearbyFacilitiesFacts,
  rollupKeys: readonly string[],
): RelevantFacility[] {
  const byCategory = facts.byCategory ?? {};
  const out: RelevantFacility[] = [];
  for (const key of rollupKeys) {
    const summary = byCategory[key];
    for (const raw of summary?.items ?? []) {
      const cleaned = cleanFacility(raw);
      if (cleaned) out.push(cleaned);
    }
  }
  return dedupeAndSort(out);
}

function collectByCategoryKeys(
  facts: NearbyFacilitiesFacts,
  wantedCategoryKeys: readonly string[],
): RelevantFacility[] {
  // Some environmentalPollution-relevant facilities (waste/substation) live in
  // the 特殊設施 rollup but are best pulled by their stable `category` key.
  const wanted = new Set(wantedCategoryKeys);
  const out: RelevantFacility[] = [];
  for (const raw of facts.facilities ?? []) {
    if (raw.category && wanted.has(raw.category)) {
      const cleaned = cleanFacility(raw);
      if (cleaned) out.push(cleaned);
    }
  }
  return dedupeAndSort(out);
}

function dedupeAndSort(items: RelevantFacility[]): RelevantFacility[] {
  const seen = new Set<string>();
  const unique: RelevantFacility[] = [];
  for (const item of items) {
    const id = `${item.kind}|${item.name ?? ""}|${item.metersToCenter ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(item);
  }
  unique.sort((a, b) => {
    const am = a.metersToCenter ?? Number.POSITIVE_INFINITY;
    const bm = b.metersToCenter ?? Number.POSITIVE_INFINITY;
    return am - bm;
  });
  return unique;
}

/**
 * Pick the facilities relevant to one districtSurvey category out of the full
 * six-rollup facts, so each category's prompt only sees its own slice (avoids
 * noise + keeps a single-category call small — plan §2.2 / §5).
 *
 * Categories with essentially no facilities correspondence
 * (landImprovement / landUseRegulation / naturalConditions) return an empty
 * slice; their prompt builders then fall back to invent tone.
 */
function pickFactsForCategory(
  category: CategoryName,
  facts: NearbyFacilitiesFacts,
): CategoryFacts {
  let facilities: RelevantFacility[];
  switch (category) {
    case "trafficAndTransport":
      facilities = collectRollups(facts, [ROLLUP.traffic]);
      break;
    case "publicInfrastructure":
      // Spans two rollups: 公共設施 (school/market/park/medical) + 公共建設
      // (tourism/parking/wastewater) — per the 六大類 ↔ 欄位 mapping table.
      facilities = collectRollups(facts, [ROLLUP.publicFacilities, ROLLUP.publicInfrastructure]);
      break;
    case "specialFacilities":
      facilities = collectRollups(facts, [ROLLUP.specialFacilities]);
      break;
    case "commercialActivity":
      facilities = collectRollups(facts, [ROLLUP.commercialActivity]);
      break;
    case "environmentalPollution": {
      // No dedicated rollup; pollution-adjacent facilities live under 特殊設施
      // (waste/substation/power tower). Pull them by stable category key and
      // fall back to sparse/invent when nothing matches.
      const rollup = collectRollups(facts, [ROLLUP.specialFacilities]);
      const byKey = collectByCategoryKeys(facts, [
        "waste",
        "wastewater",
        "substation",
        "power_tower",
      ]);
      facilities = dedupeAndSort([...rollup, ...byKey]);
      break;
    }
    case "landImprovement":
    case "landUseRegulation":
    case "naturalConditions":
      // Essentially no facilities correspondence — leave empty; the prompt
      // builder falls back to invent behaviour.
      facilities = [];
      break;
    default: {
      // Exhaustiveness guard: if a new CategoryName is added, this fails to compile.
      const _exhaustive: never = category;
      facilities = _exhaustive;
    }
  }
  return { category, facilities };
}

/**
 * Serialize a category's facilities into a compact, prompt-friendly bullet list
 * (nearest first). Returns an empty string when there are none, letting callers
 * decide whether to fall back to invent tone.
 */
function formatFactsForPrompt(facts: CategoryFacts): string {
  if (facts.facilities.length === 0) return "";
  return facts.facilities
    .map((f) => {
      const namePart = f.name ? `名稱：${f.name}` : "名稱：（無）";
      const distPart =
        f.metersToCenter !== null ? `距比準地約 ${Math.round(f.metersToCenter)} M` : "距離未知";
      return `- ${f.kind}｜${namePart}｜${distPart}`;
    })
    .join("\n");
}

export { pickFactsForCategory, formatFactsForPrompt };
export type {
  NearbyFacilitiesFacts,
  FactFacilityItem,
  FactCategorySummary,
  CategoryFacts,
  RelevantFacility,
};
