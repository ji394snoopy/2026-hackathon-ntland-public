interface RangeCriteria {
  type: "range";
  raw: string;
  min: number | null;
  max: number | null;
  unit: string;
}

interface EnumCriteria {
  type: "enum";
  raw: string;
  value: string;
}

interface BooleanCriteria {
  type: "boolean";
  raw: string;
  present: boolean;
}

type Criteria = RangeCriteria | EnumCriteria | BooleanCriteria;

interface FactorStandardGrade {
  key: string;
  raw: string;
  value: number;
  criteria: Criteria;
}

interface FactorStandardItem {
  key: string;
  raw: string;
  grades: FactorStandardGrade[];
}

interface EvidenceRange {
  type: "range";
  raw: string;
  value: number;
  unit: string;
}

interface EvidenceEnum {
  type: "enum";
  raw: string;
  enumValue: string;
}

interface EvidenceBoolean {
  type: "boolean";
  raw: string;
  present: boolean;
}

type Evidence = EvidenceRange | EvidenceEnum | EvidenceBoolean;

interface EvidenceExtraction {
  categoryKey: string;
  itemKey: string;
  evidence: Evidence;
}

function matchRangeGrade(
  item: FactorStandardItem,
  value: number,
): FactorStandardGrade | null {
  return (
    item.grades.find(
      (grade) =>
        grade.criteria.type === "range" &&
        (grade.criteria.min === null || value >= grade.criteria.min) &&
        (grade.criteria.max === null || value < grade.criteria.max),
    ) ?? null
  );
}

function matchEnumGrade(
  item: FactorStandardItem,
  enumValue: string,
): FactorStandardGrade | null {
  return (
    item.grades.find(
      (grade) => grade.criteria.type === "enum" && grade.criteria.value === enumValue,
    ) ?? null
  );
}

function matchBooleanOrAbsence(
  item: FactorStandardItem,
  present: boolean,
): FactorStandardGrade | null {
  const booleanGrade = item.grades.find(
    (grade) => grade.criteria.type === "boolean" && grade.criteria.present === present,
  );
  if (booleanGrade) return booleanGrade;

  // No boolean-typed grade on this item means `present` describes whether a specific
  // named sub-facility exists (e.g. a crematorium) on an otherwise range-typed
  // (proximity) item. Absence of it contributes nothing toward the worse end of that
  // item's scale, so it's treated as infinitely far away and resolved through the same
  // range buckets as any other distance.
  if (!present) return matchRangeGrade(item, Infinity);

  return null;
}

function resolveEvidenceToGrade(
  item: FactorStandardItem,
  evidence: Evidence,
): FactorStandardGrade | null {
  switch (evidence.type) {
    case "range":
      return matchRangeGrade(item, evidence.value);
    case "enum":
      return matchEnumGrade(item, evidence.enumValue);
    case "boolean":
      return matchBooleanOrAbsence(item, evidence.present);
  }
}

function effectiveDistance(evidence: Evidence): number {
  switch (evidence.type) {
    case "range":
      return evidence.value;
    case "boolean":
      return evidence.present ? 0 : Infinity;
    case "enum":
      // Enum evidence never competes against another enum evidence in this table
      // (each item has at most one enum-typed grade), and when it competes against a
      // range fact it always represents the item's nearest/best-defined state (e.g.
      // "presentInSection") — 0 is correct in both cases.
      return 0;
  }
}

function pickClosestGrade(
  item: FactorStandardItem,
  evidences: Evidence[],
): FactorStandardGrade | null {
  let best: { grade: FactorStandardGrade; distance: number } | null = null;
  for (const evidence of evidences) {
    const grade = resolveEvidenceToGrade(item, evidence);
    if (!grade) continue;
    const distance = effectiveDistance(evidence);
    if (!best || distance < best.distance) {
      best = { grade, distance };
    }
  }
  return best?.grade ?? null;
}

export { resolveEvidenceToGrade, pickClosestGrade };
export type {
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
};
