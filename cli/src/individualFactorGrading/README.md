# individualFactorGrading

Grades one land parcel's individual factors (個別因素) for a Taiwanese (Traditional
Chinese) 地價區段調查估價 appraisal, by combining `sample-data.json`'s `benchmark`
object (the parcel's own lot/road-frontage/proximity facts) with `factorStandard`'s
grading-definition table (`references/factor-standard.json`'s `individualFactors` tree,
main category → sub-item → grade → criteria + point value) in a single Bedrock call.
Sibling to `regionalFactorGrading` — same two-phase architecture, same input file
shape — but grades `individualFactors` (lot condition, road condition, proximity
condition, surrounding environment, administrative condition) from `benchmark` instead
of `regionalFactors` from `survey`.

Base parcel only — no comparables, matching `regionalFactorGrading`. Comparing this
result against comparable parcels' own individualFactorGrading output (analogous to
`gradingComparison`) and filling `fillindividualAnlysis/input/individual-asnlysis.pdf`
(表4 比較法調查估價表) from that comparison are both separate, not-yet-built
follow-ups — see "Fitting the future 表4 fill step" below for how this pipeline's
output is already shaped for that.

## Why Bedrock, not a hand-written matcher

`benchmark`'s fields map to `individualFactors` items more directly than
`districtSurvey`'s `survey` shape mapped to `regionalFactors` (many fields are
near-verbatim matches: `shape: "方形"` and `terrain: "平坦"` equal a grade's
`criteria.raw` exactly), but a hand-written crosswalk would still need bespoke rules for
the fields that aren't: `zoning: "第二種商業區"` has no exact `criteria` match (the
vocabulary only defines zone-type buckets — `commercialZone`/`residentialZone`/...) and
must be recognized as a subtype of `commercialZone`; `buildRestriction: "無"` must
resolve to the `noBuildingRestriction` **enum** value (`buildingProhibitionOrRestriction`
is enum-typed here, unlike `regionalFactors`' boolean-typed `buildingProhibition`/
`buildingRestriction` — its own `criteria.raw` reads "無禁止或限制建築", not bare "無").
Same rationale as `regionalFactorGrading`: Claude does this semantic matching in one
call rather than a hand-authored field-name crosswalk plus fuzzy-text rules.

## Two-phase grading: Claude extracts evidence, code resolves the grade

Identical division of labor to `regionalFactorGrading`, for the same reason: Claude is
**not** asked to pick a grade directly (avoids boundary-arithmetic mistakes on numeric
ranges), only to extract the raw **evidence** per item — a number+unit, a
closed-vocabulary classification, or a presence/absence flag
(`criteriaMatch.ts`'s `Evidence` union). `criteriaMatch.ts` then matches that evidence
against `factor-standard.json`'s exact `min`/`max`/`enum`/`boolean` criteria in code.
`individualFactors`' grading table has no boolean-typed criteria items at all (every
item is `range` or `enum`), unlike `regionalFactors`, but `criteriaMatch.ts`'s boolean
handling is kept — the tool schema still allows Claude to report `type: "boolean"`
evidence for a fact this tree happens not to define that way, and the underlying logic
is shared, generic code (see "Files" below on why it's a fresh copy rather than an
import).

## Fitting the future 表4 fill step

`references/example-page-3.pdf` (表4 比較法調查估價表, a real filled reference) shows
6 categories / 19 item rows that line up 1:1 with `individualFactors`' 5 graded
categories (`lotCondition` → 面積/寬度/深度/形狀/臨路情形/地勢, `roadCondition` →
道路種類/面前道路寬度, `proximityCondition` → 5 proximity items, `surroundingEnvironment`
→ 嫌惡設施/停車方便性, `administrativeCondition` → 4 zoning/ratio/restriction items)
plus an always-empty "6其他" category. Each row in 表4 shows **both** a raw condition
value (e.g. "中山路 18 M", "第二種商業區", "可路邊停車") **and** a 差異率 percentage.
`benchmark` alone already covers every raw-value column (passed through into
`graded.json` unchanged, same as `regionalFactorGrading` already does), but a future
fill step would otherwise need its own itemKey→benchmark-field crosswalk to read the
right raw display value per row — `benchmarkValue.ts` does that lookup once, here, so
each resolved item already carries its own display-ready `value` string
(`resolveGrades.ts` attaches it via `deriveBenchmarkValue()`) alongside
`selectedGrade.value`/`rate` for the percentage/rank column. The empty "6其他" category
isn't part of this pipeline's own output, matching `regionalFactorGrading`'s own
division of labor — that placeholder is `gradingComparison`'s concern (appended in
`compareGraded.ts`, not in `resolveGrades.ts`), and a future `individualComparison`
tool would own it here the same way.

## Files

- `main.ts` — standalone CLI entrypoint. Takes the sample-data path from argv (defaults
  to `./src/individualFactorGrading/input/sample-data.json`), calls `buildPipeline()`,
  invokes Claude (`../shared/claude.ts`'s `invokeTextOnly`, no PDF), resolves the result
  via `resolveGrades.ts`, and writes both outputs to `output/` — `graded.json` merges
  `resolveGrades()`'s result with `pipeline.ts`'s passed-through `meta`/`benchmark`.
- `pipeline.ts` — reads `references/factor-standard.json`'s `individualFactors` tree and
  the given sample-data.json, builds this pipeline's tool schema (`tool.ts`) and prompt
  text (`prompt.ts`) from them, and returns `{ tool, promptText, individualFactors, meta,
  benchmark }` — `meta`/`benchmark` (own `Meta`/`Benchmark` interfaces, same shape as
  `regionalFactorGrading`'s, since both pipelines read the same sample-data.json format)
  are read here and passed straight through unchanged.
- `tool.ts` — builds the `grade_individual_factors` tool's JSON schema (`strict: true`,
  `additionalProperties: false`), an array of `{categoryKey, itemKey, evidence}` entries —
  `categoryKey`/`itemKey` enum-restricted to the actual keys present in
  `references/factor-standard.json`'s `individualFactors` tree, `evidence` a flat object
  (`{type, raw, value?, unit?, enumValue?, present?}`) so Claude reports a raw fact,
  never a grade.
- `criteriaMatch.ts` — pure, no I/O, no console output. Matches one `Evidence` against a
  `FactorStandardItem`'s grades (`resolveEvidenceToGrade`: range bucket / enum / boolean
  lookup) and picks the closest-distance grade across multiple evidence entries for the
  same item (`pickClosestGrade`). Byte-for-byte the same generic logic as
  `regionalFactorGrading/criteriaMatch.ts` — duplicated rather than shared/imported, to
  keep each pipeline folder self-contained per this repo's convention (see
  `temp/plans/individual-factor-grading-pipeline.md`'s Decision Log for the tradeoff
  this was weighed against).
- `benchmarkValue.ts` — pure, no I/O. `deriveBenchmarkValue(itemKey, benchmark):
  BenchmarkValue | null`: a fixed itemKey→benchmark-field(s) formatting table
  (`ITEM_VALUE_BUILDERS`) that reads this parcel's own display value for a given item
  straight off `benchmark`. `BenchmarkValue` is `string | NameDistanceValue` — bare
  single-value items pass through as a plain string (`area` → `benchmark.area`), while
  facility-type items (`frontageRoadWidth`, the 5 `proximityCondition` items,
  `presenceOfNoxiousFacility`) return a `{ name, distance, unit }` object with the name
  and distance kept as **separate fields**, not concatenated into one string — matching
  `references/example-page-3.pdf`'s 表4, which prints them in separate cells, and
  leaving any display formatting to a future fill step rather than baking it in here.
  Returns `null` for an unknown itemKey, an empty source field, or (for a name+distance
  item) an empty name. Formatting only, never used for grading — grading reads evidence
  from Claude's own extraction (`prompt.ts`/`criteriaMatch.ts`), not from this table, so
  a wrong/missing mapping here can only blank out a display value, never change a grade.
  Also exports the `Benchmark` interface, which `pipeline.ts` and `resolveGrades.ts`
  both import from here rather than each declaring their own copy.
- `prompt.ts` — builds the prompt text: task description, the "extract evidence, not a
  grade" instruction, the multi-fact/closest-wins instruction, the "omit an item rather
  than guess" instruction, and both source JSON documents (sample-data.json,
  `individualFactors` tree) embedded verbatim. Wording adapted to 個別因素/宗地 (this
  parcel) rather than 區域因素/地價區段 (the section).
- `resolveGrades.ts` — orchestration + trust-boundary lookups, no matching logic of its
  own. Groups Claude's `{categoryKey, itemKey, evidence}` extractions by item, looks each
  up against `references/factor-standard.json`'s `individualFactors` tree (warn+skip on
  an unknown category/item key), delegates the actual grade resolution to
  `criteriaMatch.ts`, and sums `totalScore`. Also attaches each `selectedGrade`'s `rate`
  — the matched grade's 1-based position within that item's own `grades` array — and
  each item's own `value` via `benchmarkValue.ts`'s `deriveBenchmarkValue()`, so
  `resolveGrades()` now takes `benchmark` as a third argument (`main.ts` passes
  `pipeline.ts`'s passed-through `benchmark` straight through).

## Usage

```bash
tsx src/individualFactorGrading/main.ts [sample-data-path]

# shortcut for the default sample file:
npm run grade:individual
```

This hits the real Bedrock API and consumes real API credits. Each run writes to
`src/individualFactorGrading/output/` (gitignored, disposable per-run debug output):

- `output/result.json` — the full raw Claude API response
- `output/graded.json` — `{ meta, benchmark, individualFactors: { raw, categories: [{
  key, raw, items: [{ key, raw, value, selectedGrade: { key, raw, value, rate } }] }] },
  totalScore }` — `meta`/`benchmark` are passed through verbatim from the input
  sample-data.json; `individualFactors`/`totalScore` are the resolved grading result.
  Each item's own `value` is this parcel's raw display value for that item, read
  straight off `benchmark` — distinct from `selectedGrade.value`, the grade's point
  score. It's `null` if `benchmarkValue.ts` has no mapping for that item or the source
  field is empty; otherwise either a plain string (single-value items, e.g.
  `"113.21"` for `area`) or a `{ name, distance, unit }` object for facility-type items
  (e.g. `{ name: "金山國小", distance: "150", unit: "M" }` for `proximityToSchool`) —
  name and distance are kept separate, not concatenated, since 表4 prints them in
  separate cells. `selectedGrade.rate` is the matched grade's 1-based rank (優 → 1,
  counting up to 劣) within that item's own `grades` list in `factor-standard.json`.

`exampleOutput/graded.json` is a worked example for the checked-in
`input/sample-data.json` — hand-derived by applying `criteriaMatch.ts`'s resolution
rules directly, not captured from a real Bedrock run (this task didn't call the billed
API). Its `value` fields were cross-checked programmatically against
`deriveBenchmarkValue()`'s real output (0 mismatches) — the grading itself is
illustrative, not a validated end-to-end run.
