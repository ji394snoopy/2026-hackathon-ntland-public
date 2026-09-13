interface Benchmark {
  location: string;
  area: string;
  width: string;
  depth: string;
  shape: string;
  frontage: string;
  terrain: string;
  roadType: string;
  roadName: string;
  roadWidth: string;
  schoolName: string;
  schoolDistance: string;
  marketName: string;
  marketDistance: string;
  parkName: string;
  parkDistance: string;
  stationName: string;
  stationDistance: string;
  districtName: string;
  districtDistance: string;
  disamenityName: string;
  disamenityDistance: string;
  parking: string;
  zoning: string;
  coverageRatio: string;
  plotRatio: string;
  buildRestriction: string;
  sectionId: string;
}

interface NameDistanceValue {
  name: string;
  distance: string;
  unit: string;
}

type BenchmarkValue = string | NameDistanceValue;

function nameDistanceValue(name: string, distance: string): NameDistanceValue | null {
  if (name.trim() === "") return null;
  return { name, distance, unit: "M" };
}

// individualFactors item key -> how to read this parcel's own display value for that
// item off its benchmark data. Formatting only (mirrors references/example-page-3.pdf's
// 表4 raw-condition columns, which print name/distance/unit in separate cells for
// facility-type items rather than one merged string) — never used for grading, which
// reads evidence from Claude's own extraction instead (see prompt.ts/criteriaMatch.ts).
const ITEM_VALUE_BUILDERS: Record<string, (b: Benchmark) => BenchmarkValue | null> = {
  area: (b) => b.area,
  width: (b) => b.width,
  depth: (b) => b.depth,
  shape: (b) => b.shape,
  roadFrontageCondition: (b) => b.frontage,
  terrain: (b) => b.terrain,
  roadType: (b) => b.roadType,
  frontageRoadWidth: (b) => nameDistanceValue(b.roadName, b.roadWidth),
  proximityToSchool: (b) => nameDistanceValue(b.schoolName, b.schoolDistance),
  proximityToMarket: (b) => nameDistanceValue(b.marketName, b.marketDistance),
  proximityToParkPlaza: (b) => nameDistanceValue(b.parkName, b.parkDistance),
  proximityToStation: (b) => nameDistanceValue(b.stationName, b.stationDistance),
  proximityToCommercialDistrict: (b) => nameDistanceValue(b.districtName, b.districtDistance),
  presenceOfNoxiousFacility: (b) => nameDistanceValue(b.disamenityName, b.disamenityDistance),
  parkingConvenience: (b) => b.parking,
  zoningDesignation: (b) => b.zoning,
  buildingCoverageRatio: (b) => b.coverageRatio,
  floorAreaRatio: (b) => b.plotRatio,
  buildingProhibitionOrRestriction: (b) => b.buildRestriction,
};

function deriveBenchmarkValue(
  itemKey: string,
  benchmark: Benchmark,
): BenchmarkValue | null {
  const builder = ITEM_VALUE_BUILDERS[itemKey];
  if (!builder) return null;

  const value = builder(benchmark);
  if (value === null) return null;
  return typeof value === "string" && value.trim() === "" ? null : value;
}

export { deriveBenchmarkValue };
export type { Benchmark, BenchmarkValue, NameDistanceValue };
