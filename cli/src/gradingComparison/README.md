# gradingComparison

Standalone CLI that compares a fixed "main"/base `regionalFactorGrading` `graded.json`
result against one or more comparable `graded.json` results, and reports one row-major
`FillReport`: one row per regional-factor item (base grade + a per-comparable
grade/delta cell), rolled up per category and case-level — the same layout as
`input/regional-anlysis-commerical.pdf`'s 表5-2 影響地價區域因素分析明細表 (比準地
column plus one column per 比較標的), so a future PDF-fill step can walk it directly
without re-deriving the base or pivoting columns itself. Not a Claude/Bedrock pipeline:
no API calls, no PDF/AI input at all, just diffing already-produced JSON files.

## Files

- `compareGraded.ts` — pure, no I/O.
  - `buildFillReport(a: GradedResultWithMeta, bEntries: {label: string, graded:
    GradedResultWithMeta}[]): FillReport` flattens the base (`a`) and every comparable's
    `regionalFactors.categories[].items[]` into `categoryKey::itemKey`-keyed maps, then
    unifies them into one item order — the base's own category/item order first, then
    any category/item found only in a comparable (never in the base) appended
    afterward, in the order first encountered walking `bEntries`. Each item becomes one
    `ItemRow` — `{categoryKey, categoryRaw, itemKey, itemRaw, base, comparables}` —
    where `base` is the item's `ResolvedGrade` on the base parcel (`null` if the base
    never graded it) and `comparables` is one `{label, grade, delta}` cell per
    `bEntries` entry (`grade`/`delta` `null` if that comparable never graded the item;
    `delta` is `base.value - grade.value`, `null` unless both sides have a grade).
    Items roll up per category into `CategoryRow[]` —
    `{categoryKey, categoryRaw, items, totalBase, comparableTotals}` — where
    `totalBase` sums the category's item values on the base side and
    `comparableTotals` is one `{label, total, delta}` per comparable (an item missing
    on one side contributes `0` to that side's total, same convention as
    `resolveGrades.ts`'s own `totalScore`; `delta` is `totalBase - total`). An always-
    present, always-empty `otherFactors`/其他影響因素 category (`items: []`,
    `totalBase: 0`, a zero `{label, total: 0, delta: 0}` per comparable) is appended
    last, matching the PDF's 8th category — it has no item rows in the source PDF and
    no pipeline produces data for it. The case-level `totalScoreBase`/
    `comparableTotalScores` (`{label, total, delta}[]`) reflect each `GradedResult`'s
    own `totalScore` directly (not re-derived from summed items). `sectionIdBase`/
    `comparableSectionIds` (`{label, sectionId}[]`) surface each side's own
    `meta.sectionId` (地價區段編號) verbatim — one value per side, not diffed/rolled up
    like the grading data, since it's an identifier rather than a graded value.
  - `deriveLabel(filePath: string): string` strips the `graded-` prefix and `.json`
    suffix from a path's basename (e.g. `input/graded-1.json` → `"1"`). Comparable
    *identity* (the `label`) is argv-derived only — not sourced from each
    `graded.json`'s `meta`, since `regionalFactorGrading` only grades a single base
    parcel today and the checked-in sample `graded-*.json` files all carry identical
    placeholder `meta`. `sectionId` is read from `meta` regardless (see above) — it's
    surfaced as-is per side, not used to derive the label.
  - Reuses `regionalFactorGrading/resolveGrades.ts`'s `GradedResult`/`ResolvedGrade`
    types, extended locally as `GradedResultWithMeta = GradedResult & {meta:
    {sectionId: string}}` — the minimal slice of `graded.json`'s `meta` this module
    actually reads, rather than importing `regionalFactorGrading/pipeline.ts`'s full
    `Meta` interface.
- `main.ts` — standalone CLI entrypoint. Takes `pathA` (the main/base result) followed
  by one or more `pathB` paths from argv, reads and parses all of them, derives each
  B path's label via `deriveLabel()`, calls `buildFillReport()`, and writes
  `output/comparison.json` (also printed to stdout). Errors with a usage message if
  `pathA` or at least one `pathB` isn't given.

## Usage

```bash
tsx src/gradingComparison/main.ts <gradedPathA> <gradedPathB...>

# shortcut for the checked-in sample files (graded-main.json vs graded-1/2/3.json):
npm run compare:grading
```

`regionalFactorGrading`'s `output/graded.json` is overwritten on every run, so to
compare multiple results, copy each run's `graded.json` aside first (e.g. into
`input/graded-main.json` for the base/main result and `input/graded-1.json`,
`input/graded-2.json`, ... for each result to compare against it) before running this
CLI.

No AWS credentials needed, nothing billed — this only reads local JSON files. Writes to
`src/gradingComparison/output/` (gitignored, disposable per-run debug output):

- `output/comparison.json` — `{ categories: [{ categoryKey, categoryRaw, items: [{
  categoryKey, categoryRaw, itemKey, itemRaw, base, comparables: [{ label, grade,
  delta }, ...] }], totalBase, comparableTotals: [{ label, total, delta }, ...] }, ...,
  { categoryKey: "otherFactors", categoryRaw: "其他影響因素", items: [], totalBase: 0,
  comparableTotals: [{ label, total: 0, delta: 0 }, ...] } ], sectionIdBase,
  comparableSectionIds: [{ label, sectionId }, ...], totalScoreBase,
  comparableTotalScores: [{ label, total, delta }, ...] }` — one `comparables`/
  `comparableTotals`/`comparableSectionIds`/`comparableTotalScores` entry per `pathB`
  given on argv, in that order; the `otherFactors` category is always last.
