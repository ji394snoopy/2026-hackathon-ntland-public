# regionalFactorGrading

Grades one land parcel's regional factors (區域因素) for a Taiwanese (Traditional
Chinese) 地價區段調查估價 appraisal, by combining `districtSurvey`'s fact data
(`sample-data.json`, the district survey/地價區段勘查表 for a parcel) with
`factorStandard`'s grading-definition table (`references/factor-standard.json`,
main category → sub-item → grade → criteria + point value) in a single Bedrock call.
Unlike `factorStandard` or `districtSurvey`, there's no PDF input here at all — both
inputs are already-extracted JSON, sent to Claude as text.

Base parcel only — no comparables. `sample-data.json` describes a single parcel's
section, and only `factorStandard`'s `regionalFactors` tree is used — not
`individualFactors`, even though `sample-data.json`'s `benchmark` object now also
carries lot-specific data (area/width/depth/shape). Grading `individualFactors` from
that data is a separate, not-yet-built follow-up, same as filling
`input/regional-anlysis-commerical.pdf` from this module's output
(see `temp/plans/regional-factor-grading-pipeline.md`).

## Why Bedrock, not a hand-written matcher

`districtSurvey`'s field names/shape (e.g. `trafficAndTransport.busStop.densityLevel`)
don't line up with `factorStandard`'s item keys and enum criteria wording (e.g.
`proximityToBusStop`'s criteria text `"區段內有"`/`"未滿200m"`/...). Rather than
hand-authoring a field-name crosswalk plus fuzzy Chinese-text matching rules, both JSON
documents are handed to Claude directly and it does the matching — the kind of
semantic-matching task an LLM handles well and a deterministic version would be
fragile/high-maintenance for.

## Two-phase grading: Claude extracts evidence, code resolves the grade

Claude is **not** asked to pick a grade directly. Early runs against real survey data
showed two recurring mistakes when it was: boundary-value arithmetic errors (e.g. an
18m road width graded 稍劣 instead of 普通, which straddles a 15–20m boundary) and
picking the wrong fact when more than one survey field could feed the same grading item
(e.g. a 700m-away substation used instead of a closer 440m gas tank for the same
"utility facility proximity" item).

Both are solved by splitting the work: Claude's job is reduced to extracting the raw
**evidence** per item — a number+unit, a closed-vocabulary classification, or a
presence/absence flag (`criteriaMatch.ts`'s `Evidence` union) — never the grade itself.
`criteriaMatch.ts` then matches that evidence against `factor-standard.json`'s exact
`min`/`max`/`enum`/`boolean` criteria in code, which can't make a boundary-arithmetic
mistake. When more than one survey fact maps to the same item (multiple named hazards
feeding one "proximity to utility facilities" item, or several pollution sub-types
feeding "proximity to pollution source"), Claude reports one evidence entry per fact and
`criteriaMatch.ts` deterministically keeps whichever is **physically closest to the
parcel** — an enum match on an "in the section" state counts as distance zero, and a
`無`/absent fact counts as infinitely far. This one rule reproduces the worst grade for
hazard-type items (closeness is punished) and the best grade for amenity-type items
(closeness is rewarded) as an emergent property of each item's own criteria, without
`criteriaMatch.ts` ever needing to know which polarity a given item has — see
`temp/plans/regional-factor-grading-deterministic-resolution.md` for the full design
rationale.

## Files

- `main.ts` — standalone CLI entrypoint. Takes the district-survey sample-data path from
  argv (defaults to `./src/regionalFactorGrading/input/sample-data.json`), calls
  `buildPipeline()`, invokes Claude (`../shared/claude.ts`'s `invokeTextOnly`, no PDF),
  resolves the result via `resolveGrades.ts`, and writes both outputs to `output/` —
  `graded.json` merges `resolveGrades()`'s result with `pipeline.ts`'s passed-through
  `meta`/`benchmark`.
- `pipeline.ts` — reads `references/factor-standard.json`'s `regionalFactors` tree and the
  given sample-data.json, builds this pipeline's tool schema (`tool.ts`) and prompt text
  (`prompt.ts`) from them, and returns `{ tool, promptText, regionalFactors, meta,
  benchmark }` — `meta`/`benchmark` (strictly typed `Meta`/`Benchmark` interfaces
  mirroring sample-data.json's shape) are read here and passed straight through
  unchanged; nothing in this pipeline computes or inspects their contents.
- `tool.ts` — builds the `grade_regional_factors` tool's JSON schema (`strict: true`,
  `additionalProperties: false`). Unlike `factorStandard/tool.ts` (which extracts the
  *entire* grading table), this tool's output is an array of `{categoryKey, itemKey,
  evidence}` entries — `categoryKey`/`itemKey` enum-restricted to the actual keys present
  in `references/factor-standard.json`, and `evidence` a flat object
  (`{type, raw, value?, unit?, enumValue?, present?}`, `type` picking which fields apply,
  mirroring `factorStandard/tool.ts`'s own `criteriaDef` shape) so Claude reports a raw
  fact, never a grade.
- `criteriaMatch.ts` — pure, no I/O, no console output. Matches one `Evidence` against a
  `FactorStandardItem`'s grades (`resolveEvidenceToGrade`: range bucket / enum / boolean
  lookup, with absence-on-a-range-item resolving through the open-ended bucket), and picks
  the closest-distance grade across multiple evidence entries for the same item
  (`pickClosestGrade`).
- `prompt.ts` — builds the prompt text: task description, the "extract evidence, not a
  grade" instruction, the multi-fact/closest-wins instruction, the "omit an item rather
  than guess" instruction (absence of matching data isn't evidence of 劣 — see
  `references/regionalFactors-fillable.md` for the precedent), and both source JSON
  documents embedded verbatim.
- `resolveGrades.ts` — orchestration + trust-boundary lookups, no matching logic of its
  own. Groups Claude's `{categoryKey, itemKey, evidence}` extractions by item, looks each
  up against `references/factor-standard.json`'s `regionalFactors` tree (warn+skip on an
  unknown category/item key — never trusting Claude to restate an already-known
  `raw`/`value`), delegates the actual grade resolution to `criteriaMatch.ts`, and sums
  `totalScore`. Also attaches each `selectedGrade`'s `rate` — the matched grade's
  1-based position within that item's own `grades` array (already ordered 優→劣 in
  `factor-standard.json`), found by `indexOf` on the reference `criteriaMatch.ts`
  returned. An item where no evidence resolved to any grade is likewise warned about
  and skipped — same recoverable-per-item convention as the rest of this repo.

## Usage

```bash
tsx src/regionalFactorGrading/main.ts [sample-data-path]

# shortcut for the default sample file:
npm run grade:regional
```

This hits the real Bedrock API and consumes real API credits. Each run writes to
`src/regionalFactorGrading/output/` (gitignored, disposable per-run debug output):

- `output/result.json` — the full raw Claude API response
- `output/graded.json` — `{ meta, benchmark, regionalFactors: { raw, categories: [{
  key, raw, items: [{ key, raw, selectedGrade: { key, raw, value, rate } }] }] }, totalScore }`
  — `meta`/`benchmark` are passed through verbatim from the input sample-data.json (see
  `pipeline.ts`'s `Meta`/`Benchmark` types for their shape); `regionalFactors`/
  `totalScore` are the resolved grading result. `selectedGrade.rate` is the matched
  grade's 1-based rank (優 → 1, counting up to 劣) within that item's own `grades` list
  in `factor-standard.json` — not a normalized/global score, just its position in that
  item's best→worst ordering.
