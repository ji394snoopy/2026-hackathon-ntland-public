// Derives a full coordinates.json for src/fillindividualAnlysis/input/individual-asnlysis.pdf
// (表4 比較法調查估價表) purely from its own pdfjs-dist text layer — no Bedrock/vision call.
// Every item's row number (7-25), every "條件"/"差異率" column header, and every static
// label ("地價區段"/"基本資料"/"其他"/"合計") is real, positioned text on this template.
// See temp/plans/fill-individual-analysis.md's Context/Decision Log for how each offset
// below was derived (diffing this PDF's text layer against references/example-page-3.pdf,
// a real filled reference, confirmed against 3-7 independent samples per offset) and which
// two (locationBase/comparableIdentities location, and the 合計 row) are approximations
// pending the visual PNG-comparison pass.

const ITEM_LABEL_MIN = 7;
const ITEM_LABEL_MAX = 25;
const COMPARABLE_LABELS = ["1", "2", "3"] as const;

// Confirmed 1:1 against references/factor-standard.json's individualFactors tree (dumped
// directly this session) and against the PDF's own numbered rows 7-25 — see Decision Log.
const ITEM_KEY_ORDER = [
  { categoryKey: "lotCondition", itemKey: "area" },
  { categoryKey: "lotCondition", itemKey: "width" },
  { categoryKey: "lotCondition", itemKey: "depth" },
  { categoryKey: "lotCondition", itemKey: "shape" },
  { categoryKey: "lotCondition", itemKey: "roadFrontageCondition" },
  { categoryKey: "lotCondition", itemKey: "terrain" },
  { categoryKey: "roadCondition", itemKey: "roadType" },
  { categoryKey: "roadCondition", itemKey: "frontageRoadWidth" },
  { categoryKey: "proximityCondition", itemKey: "proximityToSchool" },
  { categoryKey: "proximityCondition", itemKey: "proximityToMarket" },
  { categoryKey: "proximityCondition", itemKey: "proximityToParkPlaza" },
  { categoryKey: "proximityCondition", itemKey: "proximityToStation" },
  { categoryKey: "proximityCondition", itemKey: "proximityToCommercialDistrict" },
  { categoryKey: "surroundingEnvironment", itemKey: "presenceOfNoxiousFacility" },
  { categoryKey: "surroundingEnvironment", itemKey: "parkingConvenience" },
  { categoryKey: "administrativeCondition", itemKey: "zoningDesignation" },
  { categoryKey: "administrativeCondition", itemKey: "buildingCoverageRatio" },
  { categoryKey: "administrativeCondition", itemKey: "floorAreaRatio" },
  { categoryKey: "administrativeCondition", itemKey: "buildingProhibitionOrRestriction" },
] as const;

const GRADE_HEADER = "條件";
// "條件" also appears as the 2nd line of the 2-line category labels (宗地/條件,
// 道路/條件, 接近/條件, 行政/條件) at x≈81-82 — far left of the real column headers
// (x≈245+), which is what this threshold excludes.
const GRADE_HEADER_MIN_X = 150;
const PERCENT_HEADER = "差異率";
const SECTION_ID_LABEL = "地價區段";
const LOCATION_LABEL = "基本資料";
const OTHER_FACTORS_LABEL = "其他";
const GRAND_TOTAL_LABEL = "合計";

// Condition-type values (plain condition text, "-" placeholders, location) are drawn
// centered on a column anchor — pushCentered-style, using the caller's own font at fill
// time. Only the offset transfers from the reference, not its own character-width math
// (see Decision Log).
const SIMPLE_CONDITION_CENTER_OFFSET = 7.2;
// The name/distance sub-values of a {name,distance,unit} cell are centered on these
// calibrated offsets (same technique as SIMPLE_CONDITION_CENTER_OFFSET, calibrated
// against references/example-page-3.pdf's own short names, 3-6 chars); unit is always
// "M" so it's a fixed left-aligned offset instead. Real content can include names far
// longer than the reference's calibration samples (up to 11 chars in real
// comparison.json data vs. 6 there), which would overlap the distance digits if drawn at
// full size — fillEngine.ts guards against that with a shrink-to-fit around these same
// anchors (see its own maxFitScale comment), rather than moving the anchors themselves.
const NAME_CENTER_OFFSET = 13.2;
const DISTANCE_CENTER_OFFSET = 30.4;
const UNIT_OFFSET = 55.26;
// Left-aligned, from that comparable's own "差異率" header.
const PERCENT_OFFSET = 5.04;
// Left-aligned, from the base/comparable's own "條件" header.
const SECTION_ID_OFFSET = -4.92;
// 0基本資料/合計 draw in a *merged* per-comparable cell — spanning what item rows split
// into separate 條件+差異率 sub-columns — not the item rows' narrow 條件-only column.
// Measured directly from the reference PDF's own rendered border pixels (not text, since
// pdfjs's text layer has no vector/line info): base's merged cell is a physically
// narrower [188.28,316.26]pt block (center = headerX+6.94, close enough to the item-row
// simple-condition offset, +7.2, to reuse it), while every comparable's merged cell is a
// wider, uniform ~154.4pt block whose center is headerX+20.93 — confirmed via 3
// independent border measurements (comparable 1/2/3 all landed at 20.91-20.96) and
// completely different from the item-row simple-condition offset. Both 0基本資料 and 合計
// share these same physical column boundaries (confirmed by measuring both rows'
// borders separately), so one constant covers both.
const MERGED_REGION_BASE_CENTER_OFFSET = SIMPLE_CONDITION_CENTER_OFFSET;
const MERGED_REGION_COMPARABLE_CENTER_OFFSET = 20.93;

const SECTION_ID_Y_NUDGE = 0.6;
const LOCATION_Y_NUDGE = 0.48;
const OTHER_FACTORS_Y_NUDGE = 0.84;
const GRAND_TOTAL_Y_NUDGE = 0.48;

interface RawTextItem {
  str: string;
  x: number;
  y: number;
}

interface Coord {
  x: number;
  y: number;
}

interface NameDistanceUnitCoord {
  name: Coord;
  distance: Coord;
  unit: Coord;
}

interface ItemCellCoord {
  condition: Coord;
  // Calibrated anchors for a {name,distance,unit} value (see NAME_CENTER_OFFSET comment
  // above) — name/distance centered, unit left-aligned.
  nameDistanceUnit: NameDistanceUnitCoord;
  // Right boundary this cell's name/distance/unit must not cross — the next column's own
  // left edge (comparable 1's "條件" header for base, that comparable's own "差異率"
  // header for a comparable) — used by fillEngine.ts to shrink long names (e.g. an
  // 11-char facility name) to fit instead of overlapping the next column.
  maxX: number;
}

interface ComparableItemCoord extends ItemCellCoord {
  label: string;
  percent: Coord;
}

interface ItemCoord {
  categoryKey: string;
  itemKey: string;
  base: ItemCellCoord;
  comparables: ComparableItemCoord[];
}

interface ComparableIdentityCoord {
  label: string;
  sectionId: Coord;
  location: Coord;
}

interface OtherFactorsComparableCoord {
  label: string;
  condition: Coord;
  percent: Coord;
}

interface OtherFactorsCoord {
  base: Coord;
  comparables: OtherFactorsComparableCoord[];
}

interface GrandTotalComparableCoord {
  label: string;
  coord: Coord;
}

interface RootCoord {
  sectionIdBase?: Coord;
  locationBase?: Coord;
  comparableIdentities?: ComparableIdentityCoord[];
  items: ItemCoord[];
  otherFactors: OtherFactorsCoord;
  comparableTotalScores: GrandTotalComparableCoord[];
}

function findFirst(items: RawTextItem[], str: string): RawTextItem | undefined {
  return items.find((it) => it.str === str);
}

function cellFor(headerX: number, y: number, maxX: number): ItemCellCoord {
  return {
    condition: { x: headerX + SIMPLE_CONDITION_CENTER_OFFSET, y },
    nameDistanceUnit: {
      name: { x: headerX + NAME_CENTER_OFFSET, y },
      distance: { x: headerX + DISTANCE_CENTER_OFFSET, y },
      unit: { x: headerX + UNIT_OFFSET, y },
    },
    maxX,
  };
}

function extractCoordinates(items: RawTextItem[]): RootCoord {
  const conditionHeaderXs = items
    .filter((it) => it.str === GRADE_HEADER && it.x >= GRADE_HEADER_MIN_X)
    .map((it) => it.x)
    .sort((a, b) => a - b);
  if (conditionHeaderXs.length !== 4) {
    throw new Error(
      `extractCoordinates: expected 4 Condition header ("${GRADE_HEADER}") occurrences, found ${conditionHeaderXs.length}`,
    );
  }
  const [baseHeaderX, ...comparableHeaderXs] = conditionHeaderXs as [number, number, number, number];

  const percentHeaderXs = items
    .filter((it) => it.str === PERCENT_HEADER)
    .map((it) => it.x)
    .sort((a, b) => a - b);
  if (percentHeaderXs.length !== 3) {
    throw new Error(`extractCoordinates: expected 3 "${PERCENT_HEADER}" headers, found ${percentHeaderXs.length}`);
  }

  const itemNumberX = items.find((it) => it.str === String(ITEM_LABEL_MIN))?.x;
  if (itemNumberX === undefined) {
    throw new Error(`extractCoordinates: could not locate item row "${ITEM_LABEL_MIN}"`);
  }
  const rowYsDesc = items
    .filter((it) => {
      if (Math.abs(it.x - itemNumberX) > 0.5 || !/^\d+$/.test(it.str)) return false;
      const n = Number(it.str);
      return n >= ITEM_LABEL_MIN && n <= ITEM_LABEL_MAX;
    })
    .sort((a, b) => b.y - a.y)
    .map((it) => it.y);
  if (rowYsDesc.length !== ITEM_KEY_ORDER.length) {
    throw new Error(
      `extractCoordinates: expected ${ITEM_KEY_ORDER.length} numbered item rows, found ${rowYsDesc.length}`,
    );
  }

  const itemCoords: ItemCoord[] = ITEM_KEY_ORDER.map((key, i) => {
    const y = rowYsDesc[i]!;
    return {
      categoryKey: key.categoryKey,
      itemKey: key.itemKey,
      base: cellFor(baseHeaderX, y, comparableHeaderXs[0]!),
      comparables: comparableHeaderXs.map((headerX, idx) => ({
        label: COMPARABLE_LABELS[idx]!,
        ...cellFor(headerX, y, percentHeaderXs[idx]!),
        percent: { x: percentHeaderXs[idx]! + PERCENT_OFFSET, y },
      })),
    };
  });

  const sectionIdLabel = findFirst(items, SECTION_ID_LABEL);
  const sectionIdBase = sectionIdLabel
    ? { x: baseHeaderX + SECTION_ID_OFFSET, y: sectionIdLabel.y + SECTION_ID_Y_NUDGE }
    : undefined;

  const locationLabel = findFirst(items, LOCATION_LABEL);
  const locationBase = locationLabel
    ? { x: baseHeaderX + MERGED_REGION_BASE_CENTER_OFFSET, y: locationLabel.y + LOCATION_Y_NUDGE }
    : undefined;

  const comparableIdentities =
    sectionIdLabel && locationLabel
      ? comparableHeaderXs.map((headerX, idx) => ({
          label: COMPARABLE_LABELS[idx]!,
          sectionId: { x: headerX + SECTION_ID_OFFSET, y: sectionIdLabel.y + SECTION_ID_Y_NUDGE },
          location: { x: headerX + MERGED_REGION_COMPARABLE_CENTER_OFFSET, y: locationLabel.y + LOCATION_Y_NUDGE },
        }))
      : undefined;

  const otherFactorsLabel = findFirst(items, OTHER_FACTORS_LABEL);
  const otherFactorsY = (otherFactorsLabel?.y ?? 0) + OTHER_FACTORS_Y_NUDGE;
  const otherFactors: OtherFactorsCoord = {
    base: { x: baseHeaderX + SIMPLE_CONDITION_CENTER_OFFSET, y: otherFactorsY },
    comparables: comparableHeaderXs.map((headerX, idx) => ({
      label: COMPARABLE_LABELS[idx]!,
      condition: { x: headerX + SIMPLE_CONDITION_CENTER_OFFSET, y: otherFactorsY },
      percent: { x: percentHeaderXs[idx]! + PERCENT_OFFSET, y: otherFactorsY },
    })),
  };

  const grandTotalLabel = findFirst(items, GRAND_TOTAL_LABEL);
  const grandTotalY = (grandTotalLabel?.y ?? 0) + GRAND_TOTAL_Y_NUDGE;
  const comparableTotalScores: GrandTotalComparableCoord[] = comparableHeaderXs.map((headerX, idx) => ({
    label: COMPARABLE_LABELS[idx]!,
    coord: { x: headerX + MERGED_REGION_COMPARABLE_CENTER_OFFSET, y: grandTotalY },
  }));

  return {
    sectionIdBase,
    locationBase,
    comparableIdentities,
    items: itemCoords,
    otherFactors,
    comparableTotalScores,
  };
}

export { extractCoordinates, ITEM_KEY_ORDER };
export type {
  RawTextItem,
  RootCoord,
  ItemCoord,
  ItemCellCoord,
  ComparableItemCoord,
  NameDistanceUnitCoord,
  Coord,
  OtherFactorsCoord,
  ComparableIdentityCoord,
  GrandTotalComparableCoord,
};
