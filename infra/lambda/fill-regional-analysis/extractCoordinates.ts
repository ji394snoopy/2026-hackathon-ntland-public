// Derives a full coordinates.json for one 表5-1~5-5 影響地價區域因素分析明細表 PDF
// purely from its own pdfjs-dist text layer — no Bedrock/vision call. Every category/
// item label and every column header is real, positioned text on these templates, so
// row y (from labels) and column x (from headers) can be computed deterministically.
// See README.md's "How coordinates are derived" for the anchors/heuristics this
// implements, validated against a real position dump of all 5 PDFs during planning.

// Fallback only, used when a column has too few gaps to derive its own threshold (e.g.
// small test fixtures). Real PDFs derive this per-document instead — the wrap gap
// isn't the same across all 5 templates (10.56pt on commercial, 11.64pt on
// agricultural/industrial/other, 10.68pt on residential), so a single fixed constant
// can't be safely shared between them.
const FALLBACK_CONTINUATION_GAP_THRESHOLD = 11.0;
const CLUSTER_JUMP_THRESHOLD = 0.5; // pt; well above jitter within a cluster (~0.03pt), well below the smallest observed cluster-to-cluster jump (~0.58pt)
const COMPARABLE_LABELS = ["1", "2", "3"] as const;

// Every offset below is calibrated against references/example-page-2.pdf, a real
// filled reference example, not guessed from the blank template's headers alone — the
// 優劣等級 header only marks a column's rough left edge, not where the two real
// sub-values inside it (a numeric "rate" 1-5, then the grade text) actually sit, and a
// blank template has no printed 修正百分比 value to calibrate against at all.
//
// The reference is a *different rendering* of this form (different absolute margins/
// row spacing than the blank template this module actually fills), so its absolute
// x/y aren't directly reusable — what transfers is the *offset* of each real value
// from that same column's own header position, measured within the reference itself:
//   base:        rateX = headerX - 2.76,  gradeCenterX = headerX + 25.08
//   comparables: rateX = headerX - 3.24,  gradeCenterX = headerX + 27.24
//                percentX = percentHeaderX + 6.24
// gradeCenterX is a true center (grade text is drawn *centered* there, not left-
// aligned — confirmed by comparing a 1-char grade like 優 against a 2-char grade like
// 普通 in the same column: both reference runs' left edges differ by exactly half a
// character width, the signature of centering, not left-alignment).
// percentX is left-aligned (matches how rate/grade are also left-aligned at a fixed
// position in the reference, not right-aligned to a shared column edge).
const BASE_RATE_OFFSET = -2.76;
const BASE_GRADE_CENTER_OFFSET = 25.08;
const COMPARABLE_RATE_OFFSET = -3.24;
const COMPARABLE_GRADE_CENTER_OFFSET = 27.24;
const COMPARABLE_PERCENT_OFFSET = 6.24;
// The reference only filled in 比準地 + 比較標的1 (comp 2/3 were left blank), so this
// one has no direct per-comparable-column confirmation — base's category-subtotal and
// grand-total percent value sits in the merged region around comparable 1's *grade*
// header (not under base's own 優劣等級 header), offset +24.12 from it.
const BASE_SUBTOTAL_PERCENT_OFFSET_FROM_COMPARABLE1_GRADE_HEADER = 24.12;
// A comparable's own 百分比小計/grand-total cell (comparableTotals/comparableTotalScores)
// is a real *merged* cell on these templates, spanning that whole comparable's 優劣等級
// + 修正百分比 columns — not the narrow 修正百分比 sub-column item rows use. Confirmed
// against `input/coordinates-commercial.json` (hand-tuned against a real filled PDF):
// its comparableTotals/comparableTotalScores percentX (282/385/485) match
// comparableInstanceIds' x exactly, not comparablePercentXFor's item-row x
// (324.91/423.67/522.46) — so both draw in that same merged region, keyed off the same
// per-comparable anchor: the 實例編號 label's own x (see comparableInstanceIds below).

const ITEM_LABEL_ANCHOR = "都市計畫（內、外）"; // always the first item, every purpose
const CATEGORY_LABEL_ANCHOR = "管制"; // second line of "土地使用管制", always category (1)
const GRADE_HEADER = "優劣等級";
const PERCENT_HEADER = "修正百分"; // first line of the 2-line "修正百分/比" header
const SUBTOTAL_MARKER = "百分比小計";
const SECTION_ID_LABEL = "地價區段號";
const BASE_COLUMN_LABEL = "比準地";
const INSTANCE_ID_LABEL = "實例編號";
const GRAND_TOTAL_FORMULA = /^=\(1\)/;
const CATEGORY_NUMBER_MARKER = /^\(\d+\)$/;

interface RawTextItem {
  str: string;
  x: number;
  y: number;
}

interface Coord {
  x: number;
  y: number;
}

interface PercentCoord {
  percentX: number;
  percentY: number;
}

// A grade cell has two independently-positioned sub-values: a numeric "rate" (1-5,
// left-aligned) and the grade text itself (centered on gradeCenterX).
interface GradeCellCoord {
  rateX: number;
  rateY: number;
  gradeCenterX: number;
  gradeCenterY: number;
}

interface ComparableCellCoord extends GradeCellCoord, PercentCoord {
  label: string;
}

interface ItemCoord {
  itemRaw: string;
  base: GradeCellCoord;
  comparables: ComparableCellCoord[];
}

interface ComparableTotalCoord extends PercentCoord {
  label: string;
}

interface CategoryCoord {
  categoryRaw: string;
  items: ItemCoord[];
  totalBase: PercentCoord;
  comparableTotals: ComparableTotalCoord[];
}

interface InstanceIdCoord extends Coord {
  label: string;
}

interface RootCoord {
  sectionIdBase?: Coord;
  comparableInstanceIds?: InstanceIdCoord[];
  comparableSequenceNumbers?: InstanceIdCoord[];
  categories: CategoryCoord[];
  totalScoreBase: PercentCoord;
  comparableTotalScores: ComparableTotalCoord[];
}

function findFirst(items: RawTextItem[], str: string): RawTextItem | undefined {
  return items.find((it) => it.str === str);
}

interface Row {
  text: string;
  y: number;
}

// A column's wrap-gap is consistent within one PDF but varies across the 5 templates
// (font/line-height differences), so it's derived per-column from that column's own
// gap distribution rather than assumed. Wrapped-line gaps cluster tightly (jitter
// ~0.03pt); the first jump bigger than CLUSTER_JUMP_THRESHOLD, scanning the sorted
// gap list from the smallest, marks where that cluster ends. Falls back to a fixed
// constant when there's too little data (e.g. small test fixtures) to find a jump.
function deriveContinuationThreshold(sortedAscendingGaps: number[]): number {
  for (let i = 1; i < sortedAscendingGaps.length; i++) {
    if (sortedAscendingGaps[i]! - sortedAscendingGaps[i - 1]! > CLUSTER_JUMP_THRESHOLD) {
      return (sortedAscendingGaps[i - 1]! + sortedAscendingGaps[i]!) / 2;
    }
  }
  return FALLBACK_CONTINUATION_GAP_THRESHOLD;
}

function filterColumn(
  items: RawTextItem[],
  columnX: number,
  columnEpsilon: number,
  exclude: (str: string) => boolean,
): RawTextItem[] {
  return items
    .filter((it) => Math.abs(it.x - columnX) < columnEpsilon && it.str.trim() !== "" && !exclude(it.str))
    .sort((a, b) => b.y - a.y);
}

// Walks one column's text items top-to-bottom, merging a line into the previous row
// when its gap from the last-seen line is under `threshold` (a wrapped second line of
// the same label), otherwise starting a new row.
function groupRows(columnItems: RawTextItem[], threshold: number): Row[] {
  const rows: Row[] = [];
  let lastY: number | undefined;
  for (const it of columnItems) {
    if (lastY !== undefined && lastY - it.y < threshold) {
      rows[rows.length - 1]!.text += it.str;
    } else {
      rows.push({ text: it.str, y: it.y });
    }
    lastY = it.y;
  }
  return rows;
}

function extractCoordinates(items: RawTextItem[]): RootCoord {
  const itemLabelAnchor = findFirst(items, ITEM_LABEL_ANCHOR);
  const categoryLabelAnchor = findFirst(items, CATEGORY_LABEL_ANCHOR);
  if (!itemLabelAnchor || !categoryLabelAnchor) {
    throw new Error(
      `extractCoordinates: could not locate anchor labels "${ITEM_LABEL_ANCHOR}" / "${CATEGORY_LABEL_ANCHOR}"`,
    );
  }
  const itemLabelX = itemLabelAnchor.x;
  const categoryLabelX = categoryLabelAnchor.x;

  const gradeXs = items
    .filter((it) => it.str === GRADE_HEADER)
    .map((it) => it.x)
    .sort((a, b) => a - b);
  if (gradeXs.length !== 4) {
    throw new Error(`extractCoordinates: expected 4 "${GRADE_HEADER}" headers, found ${gradeXs.length}`);
  }
  const columnLeftEdges = gradeXs; // [base, comparable1, comparable2, comparable3]

  const percentHeaderXs = items
    .filter((it) => it.str === PERCENT_HEADER)
    .map((it) => it.x)
    .sort((a, b) => a - b);
  if (percentHeaderXs.length !== 3) {
    throw new Error(`extractCoordinates: expected 3 "${PERCENT_HEADER}" headers, found ${percentHeaderXs.length}`);
  }

  // colIndex: 0 = base, 1-3 = comparable label "1"-"3".
  function gradeCellFor(colIndex: number, y: number): GradeCellCoord {
    const headerX = columnLeftEdges[colIndex]!;
    const rateOffset = colIndex === 0 ? BASE_RATE_OFFSET : COMPARABLE_RATE_OFFSET;
    const gradeCenterOffset = colIndex === 0 ? BASE_GRADE_CENTER_OFFSET : COMPARABLE_GRADE_CENTER_OFFSET;
    return {
      rateX: headerX + rateOffset,
      rateY: y,
      gradeCenterX: headerX + gradeCenterOffset,
      gradeCenterY: y,
    };
  }

  function comparablePercentXFor(comparableIndex: number): number {
    // comparableIndex: 0-based (0 = comparable "1"). All 3 percent headers are real,
    // directly measured text on every PDF — no pitch extrapolation needed here (unlike
    // the offsets themselves, which only comparable 1 has reference confirmation for).
    return percentHeaderXs[comparableIndex]! + COMPARABLE_PERCENT_OFFSET;
  }

  const baseSubtotalPercentX = columnLeftEdges[1]! + BASE_SUBTOTAL_PERCENT_OFFSET_FROM_COMPARABLE1_GRADE_HEADER;

  // 實例編號 labels double as the anchor for a comparable's whole merged-cell column
  // (see comparableInstanceIds below) — needed here too, since comparableTotals/
  // comparableTotalScores below draw in that same merged region, not the narrow
  // per-item percent column.
  const instanceIdLabels = items.filter((it) => it.str === INSTANCE_ID_LABEL).sort((a, b) => a.x - b.x);

  function mergedRegionPercentXFor(comparableIndex: number): number {
    // Falls back to the narrow item-column x only when a PDF's 實例編號 labels aren't
    // all present (e.g. a minimal test fixture) — every real PDF has all 3.
    return instanceIdLabels[comparableIndex]?.x ?? comparablePercentXFor(comparableIndex);
  }

  const subtotalYsDesc = items
    .filter((it) => it.str === SUBTOTAL_MARKER)
    .map((it) => it.y)
    .sort((a, b) => b - a); // descending y = top to bottom, one per category
  if (subtotalYsDesc.length === 0) {
    throw new Error(`extractCoordinates: found no "${SUBTOTAL_MARKER}" subtotal rows`);
  }

  const totalFormulaItem = items.find((it) => GRAND_TOTAL_FORMULA.test(it.str));
  if (!totalFormulaItem) {
    throw new Error("extractCoordinates: could not locate the grand-total formula row");
  }

  const lastSubtotalY = subtotalYsDesc[subtotalYsDesc.length - 1]!;
  // Bounded both below (past the last subtotal is the grand-total row) and above (the
  // page title, 案號/主要項目/修正細項 table headers, etc. sit above the first item and
  // can otherwise land inside the category column's wider epsilon by coincidence).
  const withinCategoryRegion = items.filter(
    (it) => it.y > lastSubtotalY - 0.5 && it.y <= itemLabelAnchor.y + 0.5,
  );

  const itemColumn = filterColumn(
    withinCategoryRegion,
    itemLabelX,
    1,
    (str) => str === SUBTOTAL_MARKER || GRAND_TOTAL_FORMULA.test(str),
  );
  // Category-label lines don't share an identical x across wraps (e.g. "土地使用" at
  // 46.56 vs "管制" at 49.92 — a real few-point quirk in these PDFs), so this column
  // needs a wider epsilon than the item column, still far short of itemLabelX's
  // distance away (~30-40pt) so it can't accidentally capture item-column text.
  const categoryColumn = filterColumn(withinCategoryRegion, categoryLabelX, 8, (str) =>
    CATEGORY_NUMBER_MARKER.test(str),
  );

  // Derived once from the item column (many rows, a reliable sample) and reused for
  // the category column too, which rarely has enough of its own gaps to self-derive —
  // both columns share the same font/line-height within one PDF.
  const itemGaps: number[] = [];
  for (let i = 1; i < itemColumn.length; i++) {
    itemGaps.push(itemColumn[i - 1]!.y - itemColumn[i]!.y);
  }
  const continuationThreshold = deriveContinuationThreshold([...itemGaps].sort((a, b) => a - b));

  const itemRows = groupRows(itemColumn, continuationThreshold);
  const categoryLabelRows = groupRows(categoryColumn, continuationThreshold);

  const categories: CategoryCoord[] = subtotalYsDesc.map((subtotalY, i) => {
    const upperBound = i === 0 ? Infinity : subtotalYsDesc[i - 1]!;
    const itemsInRange = itemRows.filter((row) => row.y < upperBound && row.y > subtotalY);

    return {
      categoryRaw: categoryLabelRows[i]?.text ?? "",
      items: itemsInRange.map((row) => ({
        itemRaw: row.text,
        base: gradeCellFor(0, row.y),
        comparables: COMPARABLE_LABELS.map((label, idx) => ({
          label,
          ...gradeCellFor(idx + 1, row.y),
          percentX: comparablePercentXFor(idx),
          percentY: row.y,
        })),
      })),
      totalBase: { percentX: baseSubtotalPercentX, percentY: subtotalY },
      comparableTotals: COMPARABLE_LABELS.map((label, idx) => ({
        label,
        percentX: mergedRegionPercentXFor(idx),
        percentY: subtotalY,
      })),
    };
  });

  const sectionIdLabel = findFirst(items, SECTION_ID_LABEL);
  const baseColumnLabel = findFirst(items, BASE_COLUMN_LABEL);
  const sectionIdBase =
    sectionIdLabel && baseColumnLabel ? { x: baseColumnLabel.x, y: sectionIdLabel.y } : undefined;

  // Draws content.comparableSectionIds[].sectionId — a real merged cell on these
  // templates spanning that whole comparable's column, so it sits on the exact same
  // row as sectionIdBase (confirmed against input/coordinates-commercial.json, hand-
  // tuned against a real filled PDF: comparableInstanceIds.y there equals
  // sectionIdBase.y exactly), not merely "below the 實例編號 label" as a raw
  // measurement from that label alone would give.
  const comparableInstanceIds =
    instanceIdLabels.length === 3 && sectionIdLabel
      ? instanceIdLabels.map((it, idx) => ({
          label: COMPARABLE_LABELS[idx]!,
          x: it.x,
          y: sectionIdLabel.y,
        }))
      : undefined;

  // 實例編號's own sequential-number value (1, 2, 3, ... however many comparables are
  // actually present) — a distinct position from comparableInstanceIds above (which now
  // shares sectionIdBase's row), so the two values can never collide. Drawn on the same
  // row as the 實例編號 label itself, but offset right into the blank space *after* that
  // label's own text — the same x every comparable's 修正百分比 item-row value uses
  // (confirmed against commercial's hand-tuned file: its comparableSequenceNumbers x
  // is 325/425/525, matching comparablePercentXFor's 324.91/423.67/522.46, not the raw
  // 實例編號 label x of 282.17/380.95/479.74).
  const comparableSequenceNumbers =
    instanceIdLabels.length === 3
      ? instanceIdLabels.map((it, idx) => ({
          label: COMPARABLE_LABELS[idx]!,
          x: comparablePercentXFor(idx),
          y: it.y,
        }))
      : undefined;

  return {
    sectionIdBase,
    comparableInstanceIds,
    comparableSequenceNumbers,
    categories,
    totalScoreBase: { percentX: baseSubtotalPercentX, percentY: totalFormulaItem.y },
    comparableTotalScores: COMPARABLE_LABELS.map((label, idx) => ({
      label,
      percentX: mergedRegionPercentXFor(idx),
      percentY: totalFormulaItem.y,
    })),
  };
}

export { extractCoordinates };
export type {
  RawTextItem,
  RootCoord,
  CategoryCoord,
  ItemCoord,
  ComparableCellCoord,
  GradeCellCoord,
  PercentCoord,
  Coord,
};
