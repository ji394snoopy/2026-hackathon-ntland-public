# individualComparison

Standalone CLI that compares a fixed "main"/base `individualFactorGrading` `graded.json`
result against one or more comparable `graded.json` results, and reports one row-major
`FillReport`: one row per individual-factor item (base condition/grade + a per-comparable
condition/grade/delta cell), rolled up per category and case-level — the same layout as
`references/example-page-3.pdf`'s 表4 比較法調查估價表 (比準地 column plus one column
per 比較標的), so a future PDF-fill step can walk it directly without re-deriving the
base or pivoting columns itself. Sibling to `gradingComparison` (same architecture, same
input file convention), but built for `individualFactorGrading`'s output shape rather
than `regionalFactorGrading`'s. Not a Claude/Bedrock pipeline: no API calls, no PDF/AI
input at all, just diffing already-produced JSON files.

## Why not the same shape as gradingComparison

`regionalFactorGrading`'s `ResolvedGrade` (`{key, raw, value, rate}`) carries only the
優/劣 grade label — 表5-2 only ever prints that label. `individualFactorGrading`'s
`ResolvedItem` (`{key, raw, value, selectedGrade}`) additionally carries this parcel's
own raw display value (e.g. `"23"`, or `{name, distance, unit}`) — 表4's 條件 columns
print that raw fact (e.g. "中山路 18 M"), not a grade label. Each side's cell here is
therefore the full `ResolvedItem`, not just its `selectedGrade`, and `delta` is computed
from `selectedGrade.value` on each side rather than from the cell's own top-level
`value`. `sectionIdBase`/`comparableIdentities` also carry `benchmark.location` alongside
`meta.sectionId` per side (table4's per-side "0基本資料" row prints 土地坐落, not just
地價區段) — a second minimal-slice field gradingComparison didn't need.

## Files

- `compareGraded.ts` — pure, no I/O.
  - `buildFillReport(a: GradedResultWithMeta, bEntries: {label: string, graded:
    GradedResultWithMeta}[]): FillReport` flattens the base (`a`) and every comparable's
    `individualFactors.categories[].items[]` into `categoryKey::itemKey`-keyed maps, then
    unifies them into one item order — the base's own category/item order first, then
    any category/item found only in a comparable (never in the base) appended
    afterward, in the order first encountered walking `bEntries`. Each item becomes one
    `ItemRow` — `{categoryKey, categoryRaw, itemKey, itemRaw, base, comparables}` —
    where `base` is the item's `ResolvedItem` on the base parcel (`null` if the base
    never graded it) and `comparables` is one `{label, item, delta}` cell per `bEntries`
    entry (`item`/`delta` `null` if that comparable never graded the item; `delta` is
    `base.selectedGrade.value - comparable.item.selectedGrade.value`, `null` unless both
    sides have an item). Items roll up per category into `CategoryRow[]` —
    `{categoryKey, categoryRaw, items, totalBase, comparableTotals}` — where
    `totalBase` sums the category's item `selectedGrade.value` on the base side and
    `comparableTotals` is one `{label, total, delta}` per comparable (an item missing
    on one side contributes `0` to that side's total, same convention as
    `resolveGrades.ts`'s own `totalScore`; `delta` is `totalBase - total`). An always-
    present, always-empty `otherFactors`/其他影響因素 category (`items: []`,
    `totalBase: 0`, a zero `{label, total: 0, delta: 0}` per comparable) is appended
    last, matching the PDF's "6其他" category — it has no item rows in the source PDF
    and no pipeline produces data for it. The case-level `totalScoreBase`/
    `comparableTotalScores` (`{label, total, delta}[]`) reflect each `GradedResult`'s
    own `totalScore` directly (not re-derived from summed items). `sectionIdBase`/
    `locationBase`/`comparableIdentities` (`{label, sectionId, location}[]`) surface
    each side's own `meta.sectionId` (地價區段) and `benchmark.location` (土地坐落)
    verbatim — one value per side, not diffed/rolled up like the grading data, since
    they're identifiers rather than graded values.
  - `deriveLabel(filePath: string): string` strips the `graded-` prefix and `.json`
    suffix from a path's basename (e.g. `input/graded-1.json` → `"1"`). Comparable
    *identity* (the `label`) is argv-derived only — not sourced from each
    `graded.json`'s `meta`, since `individualFactorGrading` only grades a single base
    parcel today and the checked-in sample `graded-*.json` files all carry identical
    placeholder `meta`/`benchmark`.
  - Reuses `individualFactorGrading/resolveGrades.ts`'s `GradedResult`/`ResolvedItem`
    types, extended locally as `GradedResultWithMeta = GradedResult & {meta:
    {sectionId: string}, benchmark: {location: string}}` — the minimal slice of
    `graded.json`'s `meta`/`benchmark` this module actually reads, rather than
    importing `individualFactorGrading/pipeline.ts`'s full `Meta` interface or
    `benchmarkValue.ts`'s full `Benchmark` interface.
- `main.ts` — standalone CLI entrypoint. Takes `pathA` (the main/base result) followed
  by one or more `pathB` paths from argv, reads and parses all of them, derives each
  B path's label via `deriveLabel()`, calls `buildFillReport()`, and writes
  `output/comparison.json` (also printed to stdout). Errors with a usage message if
  `pathA` or at least one `pathB` isn't given.

## Usage

```bash
tsx src/individualComparison/main.ts <gradedPathA> <gradedPathB...>

# shortcuts for the checked-in sample files (graded-main.json vs graded-1/2[/3].json):
npm run compare:individual:2
npm run compare:individual:3
```

`individualFactorGrading`'s `output/graded.json` is overwritten on every run, so to
compare multiple results, copy each run's `graded.json` aside first (e.g. into
`input/graded-main.json` for the base/main result and `input/graded-1.json`,
`input/graded-2.json`, ... for each result to compare against it) before running this
CLI.

No AWS credentials needed, nothing billed — this only reads local JSON files. Writes to
`src/individualComparison/output/` (gitignored, disposable per-run debug output):

- `output/comparison.json` — `{ categories: [{ categoryKey, categoryRaw, items: [{
  categoryKey, categoryRaw, itemKey, itemRaw, base: ResolvedItem|null, comparables: [{
  label, item: ResolvedItem|null, delta }] }], totalBase, comparableTotals: [{ label,
  total, delta }] }, ..., { categoryKey: "otherFactors", categoryRaw: "其他影響因素",
  items: [], totalBase: 0, comparableTotals: [{ label, total: 0, delta: 0 }] } ],
  sectionIdBase, locationBase, comparableIdentities: [{ label, sectionId, location }],
  totalScoreBase, comparableTotalScores: [{ label, total, delta }] }` — one
  `comparables`/`comparableTotals`/`comparableIdentities`/`comparableTotalScores` entry
  per `pathB` given on argv, in that order; the `otherFactors` category is always last.
  `ResolvedItem` is `{key, raw, value, selectedGrade: {key, raw, value, rate}}` (see
  `individualFactorGrading/resolveGrades.ts`).
