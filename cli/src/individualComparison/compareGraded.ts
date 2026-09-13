import { basename } from "node:path";
import type { GradedResult, ResolvedItem } from "../individualFactorGrading/resolveGrades.js";

const OTHER_FACTORS_CATEGORY_KEY = "otherFactors";
const OTHER_FACTORS_CATEGORY_RAW = "其他影響因素";

interface ComparableItemCell {
  label: string;
  item: ResolvedItem | null;
  delta: number | null;
}

interface ItemRow {
  categoryKey: string;
  categoryRaw: string;
  itemKey: string;
  itemRaw: string;
  base: ResolvedItem | null;
  comparables: ComparableItemCell[];
}

interface ComparableTotal {
  label: string;
  total: number;
  delta: number;
}

interface CategoryRow {
  categoryKey: string;
  categoryRaw: string;
  items: ItemRow[];
  totalBase: number;
  comparableTotals: ComparableTotal[];
}

interface ComparableIdentity {
  label: string;
  sectionId: string;
  location: string;
}

interface FillReport {
  categories: CategoryRow[];
  sectionIdBase: string;
  locationBase: string;
  comparableIdentities: ComparableIdentity[];
  totalScoreBase: number;
  comparableTotalScores: ComparableTotal[];
}

interface GradedResultMeta {
  sectionId: string;
}

interface GradedResultBenchmark {
  location: string;
}

type GradedResultWithMeta = GradedResult & {
  meta: GradedResultMeta;
  benchmark: GradedResultBenchmark;
};

interface LabeledGradedResult {
  label: string;
  graded: GradedResultWithMeta;
}

interface FlatItem {
  categoryKey: string;
  categoryRaw: string;
  itemKey: string;
  itemRaw: string;
  item: ResolvedItem;
}

interface UnifiedItemKey {
  key: string;
  categoryKey: string;
  categoryRaw: string;
  itemKey: string;
  itemRaw: string;
}

function flattenGradedResult(graded: GradedResult): Map<string, FlatItem> {
  const flat = new Map<string, FlatItem>();
  for (const category of graded.individualFactors.categories) {
    for (const item of category.items) {
      flat.set(`${category.key}::${item.key}`, {
        categoryKey: category.key,
        categoryRaw: category.raw,
        itemKey: item.key,
        itemRaw: item.raw,
        item,
      });
    }
  }
  return flat;
}

function unifyItemOrder(
  flatBase: Map<string, FlatItem>,
  flatComparables: Map<string, FlatItem>[],
): UnifiedItemKey[] {
  const seen = new Set<string>();
  const order: UnifiedItemKey[] = [];

  function addFrom(flat: Map<string, FlatItem>) {
    for (const [key, flatItem] of flat) {
      if (seen.has(key)) continue;
      seen.add(key);
      order.push({
        key,
        categoryKey: flatItem.categoryKey,
        categoryRaw: flatItem.categoryRaw,
        itemKey: flatItem.itemKey,
        itemRaw: flatItem.itemRaw,
      });
    }
  }

  addFrom(flatBase);
  for (const flat of flatComparables) addFrom(flat);

  return order;
}

function buildItemRow(
  entry: UnifiedItemKey,
  flatBase: Map<string, FlatItem>,
  flatComparables: { label: string; flat: Map<string, FlatItem> }[],
): ItemRow {
  const base = flatBase.get(entry.key)?.item ?? null;
  const comparables: ComparableItemCell[] = flatComparables.map(({ label, flat }) => {
    const comparable = flat.get(entry.key) ?? null;
    return {
      label,
      item: comparable?.item ?? null,
      delta:
        base && comparable
          ? base.selectedGrade.value - comparable.item.selectedGrade.value
          : null,
    };
  });

  return {
    categoryKey: entry.categoryKey,
    categoryRaw: entry.categoryRaw,
    itemKey: entry.itemKey,
    itemRaw: entry.itemRaw,
    base,
    comparables,
  };
}

function groupItemsByCategory(
  items: ItemRow[],
): Map<string, { categoryRaw: string; items: ItemRow[] }> {
  const byCategory = new Map<string, { categoryRaw: string; items: ItemRow[] }>();
  for (const item of items) {
    const existing = byCategory.get(item.categoryKey);
    if (existing) {
      existing.items.push(item);
    } else {
      byCategory.set(item.categoryKey, { categoryRaw: item.categoryRaw, items: [item] });
    }
  }
  return byCategory;
}

function buildCategoryTotals(
  items: ItemRow[],
  labels: string[],
): { totalBase: number; comparableTotals: ComparableTotal[] } {
  const totalBase = items.reduce((sum, item) => sum + (item.base?.selectedGrade.value ?? 0), 0);
  const comparableTotals = labels.map((label, index) => {
    const total = items.reduce(
      (sum, item) => sum + (item.comparables[index]!.item?.selectedGrade.value ?? 0),
      0,
    );
    return { label, total, delta: totalBase - total };
  });
  return { totalBase, comparableTotals };
}

function buildOtherFactorsCategory(labels: string[]): CategoryRow {
  return {
    categoryKey: OTHER_FACTORS_CATEGORY_KEY,
    categoryRaw: OTHER_FACTORS_CATEGORY_RAW,
    items: [],
    totalBase: 0,
    comparableTotals: labels.map((label) => ({ label, total: 0, delta: 0 })),
  };
}

function buildFillReport(a: GradedResultWithMeta, bEntries: LabeledGradedResult[]): FillReport {
  const flatBase = flattenGradedResult(a);
  const flatComparables = bEntries.map(({ label, graded }) => ({
    label,
    flat: flattenGradedResult(graded),
  }));
  const labels = bEntries.map(({ label }) => label);

  const order = unifyItemOrder(
    flatBase,
    flatComparables.map(({ flat }) => flat),
  );
  const items = order.map((entry) => buildItemRow(entry, flatBase, flatComparables));

  const categories: CategoryRow[] = [];
  for (const [categoryKey, { categoryRaw, items: categoryItems }] of groupItemsByCategory(
    items,
  )) {
    categories.push({
      categoryKey,
      categoryRaw,
      items: categoryItems,
      ...buildCategoryTotals(categoryItems, labels),
    });
  }
  categories.push(buildOtherFactorsCategory(labels));

  return {
    categories,
    sectionIdBase: a.meta.sectionId,
    locationBase: a.benchmark.location,
    comparableIdentities: bEntries.map(({ label, graded }) => ({
      label,
      sectionId: graded.meta.sectionId,
      location: graded.benchmark.location,
    })),
    totalScoreBase: a.totalScore,
    comparableTotalScores: bEntries.map(({ label, graded }) => ({
      label,
      total: graded.totalScore,
      delta: a.totalScore - graded.totalScore,
    })),
  };
}

function deriveLabel(filePath: string): string {
  return basename(filePath).replace(/^graded-/, "").replace(/\.json$/, "");
}

export { buildFillReport, deriveLabel };
export type {
  ComparableItemCell,
  ItemRow,
  ComparableTotal,
  CategoryRow,
  ComparableIdentity,
  FillReport,
  GradedResultMeta,
  GradedResultBenchmark,
  GradedResultWithMeta,
  LabeledGradedResult,
};
