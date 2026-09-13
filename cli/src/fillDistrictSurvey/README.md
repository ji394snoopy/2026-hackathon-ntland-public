# fillDistrictSurvey

A standalone module that fills the Taiwanese (Traditional Chinese) 表1 地價區段勘查表
(district survey table) PDF from a raw, flat district-survey fact list — the "fill" phase of
`src/districtSurvey/` (see its own README), extracted into an independent module with
**zero imports from `src/districtSurvey/`**. Unlike the rest of this module, the first step
below *does* call Claude via Bedrock (same `src/shared/claude.ts` client every other Bedrock
pipeline uses) — semantically mapping the raw facts onto the PDF's fixed field structure is a
job for the model's judgment, not a hand-written crosswalk (mirroring
`src/regionalFactorGrading/`'s reasoning for the same choice). Everything after that step is
still local-only `pdf-lib` drawing, same as before.

## Why this exists separately from districtSurvey

`src/districtSurvey/` has 8 category folders, each with its own hand-written
`fillPdf.ts` containing category-specific drawing code (checkbox groups, facility
rows, existence-check rows, overflow-safe name redraws, ...). This module replaces
all 8 of those files with **one generic engine** (`fillEngine.ts`) that fills the same
PDF by structurally matching a content JSON tree against a coordinates JSON tree —
dispatching purely on shape (arrays, `.items` groups, and flat "slot bag" leaf
objects), never on category identity or any per-category code path.

## Pipeline

1. **Semantic parsing (Bedrock, 6 sequential calls: 1 merged group + 5 solo categories)** —
   `pipeline.ts`/`tool.ts`/`prompt.ts` send the raw district-survey facts
   (`input/sample-data.json`'s `meta`/`survey`/`benchmark` shape — a flat list of
   `{key, label, group, value, source, ...}` facts, each either `source:"manual"` or
   `source:"ai"`/`"empty"`) to Claude via `invokeTextOnly`. `GROUPS` (`pipeline.ts`)
   lists categories merged into one call each
   (`extract_group_<categoryKey1>_<categoryKey2>...` — see `buildGroupContentTool` in
   `tool.ts`, nested under one top-level key per category so a single response can still
   be routed back to the right category); every other category is called solo exactly
   as before. Calls run sequentially, not in parallel, to avoid bursting Bedrock with
   simultaneous requests.

   A single tool covering all 8 categories in one call hit Bedrock's "compiled grammar
   is too large" error (strict-mode constrained decoding) — the same wall
   `src/districtSurvey/*/sample/sampleTool.ts` already split around for this exact PDF
   template — so merging is deliberately conservative rather than guessed at from
   schema size: an initial 3-groups-of-2-to-3 hypothesis (grouping by how many nested
   facility arrays a category has) was tested live against the real API and mostly
   failed — 2 of the 3 groups hit that same error. What actually distinguished the one
   group that *did* succeed (`landImprovement`/`specialFacilities`/
   `environmentalPollution`, `GROUPS`' current sole entry) is that all three have very
   few *distinct named* schema properties (2, 3, and 1 respectively — mostly repetitive
   "array of facility items" shapes); the categories in the two failed groups each have
   6-9 distinct named properties. This matches this repo's own documented cause
   elsewhere (root `CLAUDE.md`) for this same error: named properties, not
   arrays-of-`{key,...}` entries, are what blows up the grammar — merging categories
   compounds it. Only 3 of the 8 categories are this "cheap," so the other 5 stay solo
   rather than risk further live-tested merges failing. `main.ts` still catches the
   error (`isGrammarTooLargeError` in `tool.ts`) on `GROUPS`' one merged call and falls
   back to the original one-call-per-category path
   (`buildPipeline`/`buildCategoryContentTool`/`buildPrompt`, kept unchanged for exactly
   this reason) as defense-in-depth, rather than failing the whole run.

   All 6 calls share one byte-for-byte identical instruction block (`STATIC_INSTRUCTIONS` in
   `prompt.ts` — the empty-value/placeholder/fixed-order/quantity/checkbox rules plus the worked
   example, ~1,300 tokens), moved to the front of the prompt as its own content block with a
   Bedrock `cache_control: {type: "ephemeral"}` checkpoint (`src/shared/claude.ts`'s
   `PromptSections`/`invokeTextOnly`) — each per-category/group task description and its facts
   stay dynamic and go last, since a cache checkpoint only covers a contiguous prefix and Claude
   Sonnet needs ≥1,024 tokens in it to actually create one. Calls 2-6 in a run reuse call 1's
   cache write instead of reprocessing that block, and cached-read tokens don't count against the
   account's Bedrock TPM quota — see
   https://aws.amazon.com/tw/about-aws/whats-new/2025/09/cache-management-anthropics-claude-models-bedrock/.
   This only helps token-quota throttling, not request-count (RPM) throttling.

   `main.ts`'s own `MAX_TOKENS` (8,000) is also deliberately much lower than
   `constants.ts`'s `CLAUDE_MAX_TOKENS` (128,000, the model's ceiling, used by every other
   Bedrock pipeline in this repo) — Bedrock reserves `input tokens + max_tokens` against the
   account's TPM quota the instant a request is sent, only replenished down to actual usage
   once the response completes, and this pipeline's real `output_tokens` are consistently
   under 600 per call (see the committed `output/result-*.json` files' `usage`). Requesting
   128,000 on every one of the 6 sequential calls was reserving ~132,000 tokens/call for an
   actual output two orders of magnitude smaller — a bigger source of TPM throttling than the
   caching above.

   Each category's tool schema also only `$defs: usedDefs(...)` (`tool.ts`) rather than the
   full `ALL_DEFS` — most categories reference only 1-2 of the 8 shared definitions (e.g.
   `otherFactors`/`buildingCondition`/`naturalConditions`/`landUseRegulation` need only
   `textValue`), yet the whole ~1,200-token `$defs` block was previously sent on every one of
   the 6 calls regardless. `usedDefs` walks each category's (or group's) own schema for `$ref`s
   and includes only what's actually reachable, cutting most categories' tool-schema size by
   50-80%.

   Each category's schema slice is the *content-tree* shape below, hand-derived once
   from `input/coordinates.json` (this specific PDF template's fixed field structure —
   not vocabulary-driven, since there's only one template); each category's own facts
   are the raw facts whose own `group` field matches that category's Chinese group label
   (`CATEGORY_GROUP_LABELS` in `tool.ts` — the raw data's 8 group values line up 1:1
   with the 8 content-tree categories). The model matches each fact to a field **by
   meaning** (the fact's Chinese label, not its JSON key), the same philosophy
   `src/regionalFactorGrading/` uses for matching survey facts against grading criteria.
   Output is written to `output/result-group-<categoryKey1>+<categoryKey2>....json` for
   the merged group call, `output/result-<category>.json` for each solo category (also
   used if a group falls back after hitting the grammar-too-large error), and
   `output/content.json` (all results merged into one content tree).
2. **Fill (local, `pdf-lib`)** — unchanged: `fillEngine.ts`'s `planDraws`/`renderDraws`
   structurally match that content tree against `input/coordinates.json` and draw onto
   `input/district-survey.pdf`.

## Usage

```bash
npm run fill:standalone                    # uses input/sample-data.json, calls Bedrock
npm run fill:standalone -- path/to/raw-survey-data.json
```

`main(rawData?)` also works as a library call — `rawData` can be an in-memory object
matching `input/sample-data.json`'s raw shape, a path to a JSON file, or omitted (falls
back to `input/sample-data.json`). This makes a real, billed Bedrock call every time —
same caveat as `npm run extract:fs`/`grade:regional`/etc. in the root `CLAUDE.md`.

## Inputs (all owned copies, committed to git — nothing gitignored)

- `input/district-survey.pdf` — the blank form template.
- `input/coordinates.json` — a committed copy of districtSurvey's
  `output/coordinates-merged.json` (that file itself is gitignored per-run debug
  output there; this module needs a stable, always-available copy). One data
  augmentation was made on top of the raw copy: every `landImprovement` checkbox
  entry (`buildingSiteImprovement`/`farmlandImprovement`'s `items` and `other`) got a
  `"markStyle": "square"` field added, since that's the one place the printed form
  uses a square checkbox (■) instead of a circle (●) — see "The one non-derivable
  fact" below.
- `input/sample-data.json` — a raw district-survey fact list (`meta`/`survey`/
  `benchmark`), used both as the CLI's default input and as the worked example for
  that raw shape. This is **not** the content-tree shape `fillEngine.ts` consumes —
  that shape is now an intermediate value (`output/content.json`) produced by step 1
  above, not a committed file; `tool.ts`'s schema and `prompt.ts`'s worked example are
  the current reference for it instead.

## How the generic engine works

`fillEngine.ts` exports `planDraws(content, coords, measureText)` — a pure function
(no pdf-lib) that recursively walks `content` and `coords` together and returns a flat
list of draw instructions — and `renderDraws(page, font, instructions)`, a thin
executor that issues the actual `pdf-lib` calls. `main.ts` wires them together with a
real embedded font's `widthOfTextAtSize` as the measurer. Splitting it this way makes
the actual drawing *decisions* unit-testable (`test/fillDistrictSurvey/fillEngine.test.ts`)
without needing a real embedded font in tests.

### Recursion (shape, not category)

At any `(content, coords)` pair:
1. `coords` is an array → zip with `content` (if it's already an array) or
   `content.items`, recurse per index, warn+skip when a content item is missing.
2. `coords.items` is an array → same zipping using `coords.items`; if `coords.other`
   is also present, recurse into it too (landImprovement's checkbox-group + free-text
   "other" row shape).
3. `coords` is a flat object containing any recognized "slot" key (see below) → it's a
   leaf; apply every slot rule whose key is present.
4. Otherwise → plain nested object (a category container, or the document root);
   recurse into each key present in `coords`.

### Leaf "slot bag" rules

Every leaf coordinate object is a bag of independently-recognized draw slots, matched
by field-name convention (not by which category it came from):

| Coordinate keys | Draws | Content field read |
|---|---|---|
| `x`/`y` or `textX`/`textY` | left-aligned text | `.text`, or mechanically formatted from `.type`: `number` → `${value}${unit}`, `measurement` → `${label} ${value}${unit}` |
| `labelX`/`labelY` | left-aligned text | `.label` |
| `valueEndX`/`valueY` | right-aligned text | `.value` |
| `quantityX` (+ `nameY`) | left-aligned text | `.quantity` |
| `distanceEndX`/`distanceY` | right-aligned text | `.distanceValue` |
| `densityOptionX`/`densityOptionY` (arrays) | mark at the indexed position | `.densityLevel` indexes both arrays |
| `checkX`/`checkY` (no `nameGapEndX`) | mark | `.checked === true` or `.isExist === true` |
| `checkX`/`circleX` + `nameGapEndX` | whiteout + `${mark}${name}` drawn inline, unconditionally sized to `nameGapEndX` | `.isExist` (gate), `.name` |
| `nameX`/`nameY` (no `nameGapEndX`) | left-aligned name, or a whiteout+sequential redraw when it would overlap `inSectionX` (only possible when `nameY === distanceY`, i.e. packed onto one row) | `.isExist !== false` (gate — a row with no `isExist` field at all, like `busStop`, is always drawn) and `.name` |
| `inSectionX`/`outSectionX` | mark at whichever side `.inSection` selects | `.inSection` (`true`/`false`/absent) — Y prefers `inSectionY`/`outSectionY`, else falls back to `distanceY`, then `nameY`, then `checkY`/`circleY` |

Every leaf's content is unwrapped once (`content.value` if it's an object, else
`content` itself) before these rules run, so both the `{ value: {...} }`-wrapped shape
(facility rows, most fields) and the bare `{ checked }` shape (landImprovement's items
and `other`) work through the same rules.

### The one non-derivable fact

Every rule above is inferred purely from which keys are present and their numeric
relationships (e.g. "packed vs. two-line" is `nameY === distanceY`, not a per-category
flag). The **one** exception found while porting all 8 categories:
`landUseRegulation.insideOutsideUrbanPlan`'s printed text (都市計畫內/都市計畫外) used
to come from a hardcoded enum→label table with no equivalent in either JSON. Rather
than embed that vocabulary in the engine, this module requires the content to already
carry the final rendered string for that field (`{ value: { text: "都市計畫內" } }`) —
the plain-text slot's `.text` field always wins over any mechanical `.type` formatting,
so this is a strict subset of the existing content shape, not a breaking one.

### Two intentional, disclosed unifications vs. the original per-category code

Porting all 8 categories surfaced two small inconsistencies *between* the original
`fillPdf.ts` files (not between this engine and any one of them). Rather than encode
which category got which behavior (which would defeat the point of a generic engine),
this engine picks the more robust behavior uniformly:

- **Overflow-safe whiteout/redraw now applies to every packed name row**
  (`nameY === distanceY`), including `trafficAndTransport`'s `majorStation`/`busStop`/
  `interchange` rows, which previously had no overflow protection at all (a very long
  name there would have silently overlapped the printed 本區段內/外 labels).
  `specialFacilities`/`environmentalPollution`/`publicInfrastructure.wastewaterTreatmentFacility`
  already had this protection; it's now consistent everywhere a name is packed onto
  the same row as the in/out-of-section choice.
- **The overflow redraw always reserves a minimum-width distance slot** (right-aligning
  the distance digits within it), matching `specialFacilities`/`environmentalPollution`'s
  already-refined behavior rather than `publicInfrastructure.wastewaterTreatmentFacility`'s
  older, simpler (unpadded) version.

## Relationship to `src/districtSurvey/`

This module is entirely additive — `src/districtSurvey/main.ts`, its `fill:all`
script, and all 8 categories' own `fillPdf.ts`/`run.sh fill <category>` flows are
unchanged and continue to work exactly as before.
