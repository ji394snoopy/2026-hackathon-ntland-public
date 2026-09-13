import { pickClosestGrade } from "./criteriaMatch.js";
import type {
  Criteria,
  RangeCriteria,
  EnumCriteria,
  BooleanCriteria,
  FactorStandardGrade,
  FactorStandardItem,
  Evidence,
  EvidenceRange,
  EvidenceEnum,
  EvidenceBoolean,
  EvidenceExtraction,
} from "./criteriaMatch.js";

interface FactorStandardCategory {
  key: string;
  raw: string;
  items: FactorStandardItem[];
}

interface RegionalFactorsTree {
  raw: string;
  categories: FactorStandardCategory[];
}

interface ResolvedGrade {
  key: string;
  raw: string;
  value: number;
  rate: number;
}

interface ResolvedItem {
  key: string;
  raw: string;
  selectedGrade: ResolvedGrade;
}

interface ResolvedCategory {
  key: string;
  raw: string;
  items: ResolvedItem[];
}

interface GradedResult {
  regionalFactors: {
    raw: string;
    categories: ResolvedCategory[];
  };
  totalScore: number;
}

interface ItemGroup {
  category: FactorStandardCategory;
  item: FactorStandardItem;
  evidences: Evidence[];
}

function lookupCategoryAndItem(
  regionalFactors: RegionalFactorsTree,
  categoryKey: string,
  itemKey: string,
): { category: FactorStandardCategory; item: FactorStandardItem } | null {
  const category = regionalFactors.categories.find((c) => c.key === categoryKey);
  if (!category) {
    console.warn(`resolveGrades: unknown categoryKey "${categoryKey}", skipping`);
    return null;
  }

  const item = category.items.find((i) => i.key === itemKey);
  if (!item) {
    console.warn(
      `resolveGrades: unknown itemKey "${itemKey}" in category "${category.key}", skipping`,
    );
    return null;
  }

  return { category, item };
}

function groupEvidenceByItem(
  regionalFactors: RegionalFactorsTree,
  extractions: EvidenceExtraction[],
): Map<string, ItemGroup> {
  const groups = new Map<string, ItemGroup>();
  for (const extraction of extractions) {
    const resolved = lookupCategoryAndItem(
      regionalFactors,
      extraction.categoryKey,
      extraction.itemKey,
    );
    if (!resolved) continue;

    const groupKey = `${resolved.category.key}::${resolved.item.key}`;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.evidences.push(extraction.evidence);
    } else {
      groups.set(groupKey, {
        category: resolved.category,
        item: resolved.item,
        evidences: [extraction.evidence],
      });
    }
  }
  return groups;
}

function groupResolvedItemsByCategory(
  regionalFactors: RegionalFactorsTree,
  extractions: EvidenceExtraction[],
): Map<string, ResolvedItem[]> {
  const itemsByCategory = new Map<string, ResolvedItem[]>();
  for (const { category, item, evidences } of groupEvidenceByItem(
    regionalFactors,
    extractions,
  ).values()) {
    const grade = pickClosestGrade(item, evidences);
    if (!grade) {
      console.warn(
        `resolveGrades: no evidence for item "${item.key}" matched any of its grades, skipping`,
      );
      continue;
    }

    const resolvedItem: ResolvedItem = {
      key: item.key,
      raw: item.raw,
      selectedGrade: {
        key: grade.key,
        raw: grade.raw,
        value: grade.value,
        rate: item.grades.indexOf(grade) + 1,
      },
    };

    const existing = itemsByCategory.get(category.key);
    if (existing) {
      existing.push(resolvedItem);
    } else {
      itemsByCategory.set(category.key, [resolvedItem]);
    }
  }
  return itemsByCategory;
}

function resolveGrades(
  regionalFactors: RegionalFactorsTree,
  extractions: EvidenceExtraction[],
): GradedResult {
  const itemsByCategory = groupResolvedItemsByCategory(regionalFactors, extractions);

  const categories: ResolvedCategory[] = [];
  let totalScore = 0;
  for (const category of regionalFactors.categories) {
    const items = itemsByCategory.get(category.key);
    if (!items) continue;

    categories.push({ key: category.key, raw: category.raw, items });
    for (const item of items) {
      totalScore += item.selectedGrade.value;
    }
  }

  return {
    regionalFactors: { raw: regionalFactors.raw, categories },
    totalScore,
  };
}

export { resolveGrades };
export type {
  RegionalFactorsTree,
  FactorStandardCategory,
  FactorStandardItem,
  FactorStandardGrade,
  Criteria,
  RangeCriteria,
  EnumCriteria,
  BooleanCriteria,
  Evidence,
  EvidenceRange,
  EvidenceEnum,
  EvidenceBoolean,
  EvidenceExtraction,
  GradedResult,
  ResolvedCategory,
  ResolvedItem,
  ResolvedGrade,
};
