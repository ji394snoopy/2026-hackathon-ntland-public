# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

A small TypeScript CLI that extracts structured JSON from Taiwanese Traditional-Chinese
land-valuation appraisal PDFs by sending the PDF straight to Claude Sonnet 5 via AWS
Bedrock (`ap-northeast-1`, model `anthropic.claude-sonnet-5`) with a forced tool call,
rather than parsing the table layout in code. See `README.md` for the full pipeline
description and output shape.

This project previously called Claude via the direct Anthropic API
(`temp/plans/claude-only-cleanup.md` removed an earlier AWS Bedrock Data Automation
path in favor of it) after an initial Bedrock spike
(`temp/plans/claude-bedrock-vision-extraction-spike.md`) hit a per-account Bedrock
model-access gate. It was later swapped back to Bedrock (`temp/plans/swap-to-bedrock.md`)
once that access was available. `src/shared/claude.ts` now calls Claude through
`@anthropic-ai/bedrock-sdk`'s `AnthropicBedrock` client — AWS credentials come from the
default AWS SDK credential provider chain, not an API key.

The repo also contains eight standalone CLIs unrelated to the above — no Claude/Bedrock
calls at all, no AWS credentials needed, nothing billed (except `environmentalPollution`,
which needs a free MOENV API key — still not billed):

- `src/mapTiles/` — public NLSC (國土測繪中心) WMTS tile-server HTTP requests. See its
  own `src/mapTiles/README.md`.
- `src/drainageQuality/` — public WRA (經濟部水利署) drainage-infrastructure SHP-layer
  lookups, 新北市-only. See its own `src/drainageQuality/README.md`.
- `src/windCondition/` — public, keyless Open-Meteo historical-weather API lookups
  (past-year average wind speed/direction), nationwide/global. See its own
  `src/windCondition/README.md`.
- `src/soilQuality/` — public MOA/TARI (農業部農業試驗所) soil-map SHP lookups,
  新北市-only. See its own `src/soilQuality/README.md`.
- `src/osmFacilities/` — public, keyless OpenStreetMap Overpass API lookups for
  arbitrary `key=value` tags near a point, nationwide/global. See its own
  `src/osmFacilities/README.md`.
- `src/environmentalPollution/` — five sub-CLIs (廢氣/水/噪音/其他/廢棄物污染) against
  環境部 (data.moenv.gov.tw)'s open-data API, nationwide. Needs a free `MOENV_API_KEY`
  (see `.env.example`). See its own `src/environmentalPollution/README.md`.
- `src/gradingComparison/` — compares one base-parcel `regionalFactorGrading`
  `output/graded.json` against one or more comparable-parcel `graded.json` results,
  row-major (one row per regional-factor item, base grade + a per-comparable
  grade/percentage cell) matching `input/regional-anlysis-commercial.pdf`'s 表5-2
  layout, no API calls at all, just diffing local JSON files. See its own
  `src/gradingComparison/README.md`.
- `src/fillRegionalAnlysis/` — fills the correct 表5-1~5-5 影響地價區域因素分析明細表
  PDF template (chosen by land-use purpose: agricultural/commercial/industrial/other/
  residential) from `gradingComparison`'s `comparison.json` shape, no API calls at
  all — coordinates are derived deterministically from each PDF's own `pdfjs-dist`
  text layer (every label/header is real positioned text on these templates), not a
  Claude vision call. This is the "future PDF-fill step" `gradingComparison`'s own
  README describes `comparison.json`'s shape as existing for. See its own
  `src/fillRegionalAnlysis/README.md`, including known gaps (only `commercial` has
  matching content today; the other 4 purposes' PDFs have a genuinely different
  category/item set, not just a subset).

The rest of this file (Architecture/Conventions below) is about the Bedrock pipelines
and mostly doesn't apply to any of the eight.

## Commands

```bash
npm run typecheck   # tsc --noEmit — run after any src/ change
npm test            # node:test — run after any src/ change
npm run extract:fs  # factorStandard, run standalone via src/factorStandard/main.ts —
                     # runs the real Bedrock API
npm run grade:regional [-- <sample-data-path>]  # regionalFactorGrading, run standalone
                     # via src/regionalFactorGrading/main.ts — runs the real Bedrock API
npm run grade:individual [-- <sample-data-path>]  # individualFactorGrading, run standalone
                     # via src/individualFactorGrading/main.ts — runs the real Bedrock API
npm run fetch:topo -- <lon> <lat>  # mapTiles/detailTopo (1/1000, 新北市-only)
npm run fetch:base -- <lon> <lat>  # mapTiles/baseTopo (1/5000, nationwide layer)
npm run fetch:drainage -- <lon> <lat>  # drainageQuality, WRA drainage lookup (新北市-only)
npm run fetch:wind -- <lon> <lat>  # windCondition, Open-Meteo past-year wind lookup (nationwide/global)
npm run fetch:soil -- <lon> <lat>  # soilQuality, TARI soil-map lookup (新北市-only)
npm run fetch:osm -- <lon> <lat> <tag1=value1,tag2=value2,...> [radiusMeters]
                     # osmFacilities, OSM Overpass tag lookup (nationwide/global)
npm run fetch:air -- <lon> <lat>                # environmentalPollution/airPollution
npm run fetch:water -- <lon> <lat>              # environmentalPollution/waterPollution
npm run fetch:noise -- <lon> <lat>              # environmentalPollution/noisePollution
npm run fetch:soil-contamination -- <lon> <lat> # environmentalPollution/soilGroundwaterContamination
npm run fetch:waste-dumping -- <lon> <lat>      # environmentalPollution/wasteDumping
npm run compare:grading -- <gradedPathA> <gradedPathB...>
                     # gradingComparison, compares a base regionalFactorGrading
                     # graded.json against one or more comparable graded.json files
npm run generate:regional-coords [-- <purpose>]
                     # fillRegionalAnlysis, derives coordinates-<purpose>.json from a
                     # PDF's own text layer (all 5 purposes if none given)
npm run fill:regional -- <purpose>
                     # fillRegionalAnlysis, fills that purpose's PDF from
                     # input/comparison.json, writes output/regional-analysis-<purpose>-filled.pdf
```

`npm run extract:fs` (and any other Bedrock pipeline's own `main.ts`) makes a real,
billed call to Bedrock. Don't run it to "verify" a change unless the user asks —
`typecheck` + `npm test` is the default verification loop for code changes.
`fetch:topo`/`fetch:base`/`fetch:wind`/`fetch:soil`/`fetch:osm`/`fetch:air`/`fetch:water`/
`fetch:noise`/`fetch:soil-contamination`/`fetch:waste-dumping` are different: unbilled
public HTTP requests (NLSC tile servers / Open-Meteo / MOA open data / OSM Overpass /
環境部 open data), no AWS credentials involved, so running one to sanity-check a
`src/mapTiles/`, `src/windCondition/`, `src/soilQuality/`, `src/osmFacilities/`, or
`src/environmentalPollution/` change is fine (`environmentalPollution` additionally
needs `MOENV_API_KEY` set in `.env`). `compare:grading`, `generate:regional-coords`,
and `fill:regional` are local-only (no network, no credentials at all) — always safe
to run.

## Architecture

This is a multi-pipeline CLI: each source-document type (`factorStandard`,
`regionalAnalysis`, ...) has its own self-contained folder under `src/` and its own
standalone `main.ts` entrypoint (e.g. `src/factorStandard/main.ts`) — there is no shared
`index.ts` dispatcher; each pipeline is run directly (`tsx src/<pipeline>/main.ts <pdf>`)
or via its own `package.json` script.

- `src/shared/claude.ts` — thin Anthropic SDK wrapper. Builds `MessageStreamParams` (PDF
  as a `document` content block + prompt text, `tool_choice` forced to the extraction
  tool) and streams to a final message.
- `src/shared/runPipeline.ts` — `runSingleCallPipeline(pipeline, label, pdfPath)`: reads
  the PDF, calls Claude via `src/shared/claude.ts`, and writes `output/result.json`
  (raw response) + `output/extracted.json` (extracted tool input). Called by each
  pipeline's own `main.ts`.
- `src/shared/tool.ts` — pipeline-agnostic helpers used by every pipeline:
  `ToolDefinition`/`CategoryMapping` types, `extractResult()` (pulls the matching
  `tool_use` block's `input` out of a response, throws if missing/mismatched), and
  `readPdfAsBase64()`.
- `src/constants.ts` — `CLAUDE_MODEL_ID`, `CLAUDE_MAX_TOKENS`, `DEBUG_OUTPUT_PATHS`.
- `src/<pipeline>/pipeline.ts` — loads exactly the `references/zh_en_*_mapping.json`
  files that pipeline needs, and returns `{ tool, promptText }` built from them. This
  is the only place that reads vocabulary files off disk for that pipeline.
- `src/<pipeline>/tool.ts` — builds that pipeline's tool JSON schema from vocabulary
  files rather than hardcoding key names. `strict: true` with
  `additionalProperties: false` throughout, using `$defs`/`$ref` to avoid duplicating
  nested definitions. Arrays-of-`{key, ...}` entries (not objects keyed by name) are
  used everywhere a vocabulary-driven list repeats — an object with one named property
  per known key blows up the strict-mode constrained-decoding grammar once repeated
  across every category (hit both the "10000 subschemas" and "compiled grammar too
  large" API errors before landing on this shape). `category.key`/`item.key`/
  `grade.key`-style fields are `enum`-restricted to their fixed vocabulary file (cheap
  for the grammar, unlike named properties) — a label that isn't in the vocabulary
  cannot be represented, a deliberate tradeoff accepted in favor of a fully closed
  schema.
- `src/<pipeline>/prompt.ts` — builds that pipeline's prompt text: table structure
  description, reading rules specific to that table shape, a worked example, and the
  Chinese→English vocabulary appended for reference.
- `src/factorStandard/` — the grading-*definition* table (factorGroup → category →
  item → grade → criteria; `extract_land_valuation_table`).
- `src/regionalAnalysis/` — the regional-factors *analysis* table for one appraisal
  case (base parcel vs. comparables; `extract_regional_analysis_table`). See its
  `pipeline.ts`/`tool.ts`/`prompt.ts` for the base-vs-comparable percentage split and
  the 優劣等級 rank↔`key`/`raw` correspondence.
- `src/individualAnalysis/` — the individual-factors *comparison/appraisal* table for
  one case (base parcel vs. comparables, plus each comparable's own pricing/adjustment
  fields; `extract_individual_analysis_table`). No grade vocabulary is used here — items
  carry a raw condition value and a computed 差異率 directly, never a 優劣等級 rank. See
  its `tool.ts` for the `{type, raw, label?, value?, unit?}` condition-value shape,
  mirroring `factorStandard`'s `criteria` object — `type` (`text`/`number`/`measurement`)
  picks which fields apply, since cells vary between bare numbers, bare text, and
  place-name+number+unit combos.
- `src/regionalFactorGrading/` — a different kind of Bedrock pipeline: grades one
  parcel's regional factors (區域因素) by combining `districtSurvey`'s fact data
  (`sample-data.json`) with `factorStandard`'s grading-definition table
  (`references/factor-standard.json`) in a single text-only call (`invokeTextOnly`, no
  PDF) — matching district-survey facts against grading criteria is a job for Claude's
  own judgment (field names/wording don't line up between the two shapes), not a
  hand-written crosswalk. Base parcel only, `regionalFactors` only (no comparables, no
  `individualFactors` — see its own `src/regionalFactorGrading/README.md`). Its tool
  output is deliberately minimal — `{categoryKey, itemKey, selectedGradeKey}` triples —
  with `raw`/`value`/total score resolved locally against `factor-standard.json` rather
  than trusted from the model. Distinct from `src/regionalAnalysis/` above (that one
  extracts an already-filled-in case from a PDF; this one grades a parcel from raw
  facts). Intended to eventually feed a fill step for
  `input/regional-anlysis-commerical.pdf`, not yet built.
- `src/individualFactorGrading/` — sibling to `src/regionalFactorGrading/` above: same
  two-phase Bedrock architecture (Claude extracts raw evidence per item, code resolves
  the grade deterministically against `factor-standard.json`), but grades one parcel's
  individual factors (個別因素 — lot condition, road condition, proximity condition,
  surrounding environment, administrative condition) from `sample-data.json`'s
  `benchmark` object instead of `regionalFactors` from `survey`. `benchmark`'s fields
  map to `individualFactors` items more directly than `districtSurvey`'s `survey` shape
  mapped to `regionalFactors`, but Bedrock is still used (not a hand-written crosswalk)
  for the handful of fields needing semantic matching — e.g. a zoning value like
  `"第二種商業區"` resolving to the `commercialZone` bucket, since no more specific
  criteria value exists. Its `graded.json` output shape (`{ meta, benchmark,
  individualFactors: {...}, totalScore }`, `benchmark` passed through unchanged) is
  intended to feed a future PDF-fill step for
  `src/fillindividualAnlysis/input/individual-asnlysis.pdf` (表4 比較法調查估價表,
  confirmed against `references/example-page-3.pdf`'s filled example — its 6
  categories/19 items line up 1:1 with `individualFactors`' 5 graded categories plus an
  always-empty "6其他"), not yet built — see its own
  `src/individualFactorGrading/README.md`.
- `src/mapTiles/` — not a Bedrock pipeline (see note above). Follows the same
  self-contained-folder-per-product shape (`detailTopo/`, `baseTopo/`, each with its own
  `main.ts`), but the products are NLSC map layers, not PDF document types. See
  `src/mapTiles/README.md` for its architecture.
- `src/drainageQuality/` — not a Bedrock pipeline (see note above). A single
  self-contained folder (own `main.ts`, no PDF input) that reports nearby WRA
  drainage-infrastructure facts (nearest pumping station/floodgate/managed-drainage-area/
  river-dike + distance) for a 新北市-only lon/lat point — a factual proxy for the
  `drainageQuality` item under 自然條件 in 表1 地價區段勘查表, not a 優劣等級 grade. See
  `src/drainageQuality/README.md` for its architecture.
- `src/windCondition/` — not a Bedrock pipeline (see note above). A single
  self-contained folder (own `main.ts`, no PDF input) that reports the past year's
  average daily-max wind speed and dominant wind direction (8-point compass + Chinese
  label) for any lon/lat point, via Open-Meteo's keyless Historical Weather (Archive)
  API — a factual proxy for the 「風勢」item under 自然條件 in 表1 地價區段勘查表, not a
  優劣等級 grade. Nationwide/global, no county restriction. See
  `src/windCondition/README.md` for its architecture.
- `src/soilQuality/` — not a Bedrock pipeline (see note above). A single self-contained
  folder (own `main.ts`, no PDF input) that reports the TARI (農業部農業試驗所) soil-map
  classification (soil series, soil type, surface texture, etc.) of the polygon
  containing a 新北市-only lon/lat point — a factual proxy for the 自然條件「土質」item
  in 表1 地價區段勘查表 (以該地價區段地質適宜作何種使用之內容來衡量, agricultural land
  valuation only), not a 優劣等級 grade. Coverage is decided by point-in-polygon
  containment against the full national dataset, not the dataset's own 地區 field (which
  reflects legacy pre-2010 county boundaries, not current ones). See
  `src/soilQuality/README.md` for its architecture.
- `src/osmFacilities/` — not a Bedrock pipeline (see note above). A single
  self-contained folder (own `main.ts`, no PDF input) that queries the public
  OpenStreetMap Overpass API for features matching one or more arbitrary `key=value`
  tags within a radius of a lon/lat point, sorted by distance — a general-purpose
  "try this tag" tool for scouting OSM coverage of a given category (e.g. 百貨公司,
  娛樂設施, 觀光飯店 under 工商活動/公共建設/特殊設施 in 表1 地價區段勘查表) rather
  than a dedicated per-category lookup. Nationwide/global, no county restriction. See
  `src/osmFacilities/README.md` for its architecture.
- `src/environmentalPollution/` — not a Bedrock pipeline (see note above). Five
  standalone sub-CLIs (`airPollution/`, `waterPollution/`, `noisePollution/`,
  `soilGroundwaterContamination/`, `wasteDumping/`, each own `main.ts`, no PDF input),
  a factual proxy for `environmentalPollution.proximityToPollutionSource` in
  `references/factor-standard.json`'s `regionalFactors`, not a 優劣等級 grade. Needs a
  free `MOENV_API_KEY` (register at data.moenv.gov.tw/api-term, add to `.env` — picked
  up automatically via `process.loadEnvFile()`). Nationwide, no county restriction.
  Unlike every other multi-sub-CLI folder in this repo (`mapTiles/`'s `detailTopo/`/
  `baseTopo/`, `districtSurvey/`'s eight categories), this one's sub-CLIs share two
  root-level files — `moenvClient.ts` (the API client) and `nearestPoint.ts` (haversine
  nearest-finder) — justified the same way `src/shared/` is justified for the Bedrock
  pipelines: both are genuine dataset-agnostic infrastructure, not case-specific logic.
  See `src/environmentalPollution/README.md` for full per-sub-CLI architecture,
  including two bugs found only by live-testing against the real API (not visible from
  its docs): `limit` is silently capped at 1000 rows/request regardless of what's
  requested, and `WQX_P_01`'s `siteid`/`itemname` query params are silently ignored
  server-side.

## Conventions

Two skills document this repo's conventions in detail — read them before writing or
reviewing `.ts` files:

- `style-guide` skill — module/export shape, naming, function decomposition, comment
  style, error handling. Note: some of its file examples (`parseBlocks.ts`,
  `writeOutput.ts`, `schema.ts`) predate the AWS cleanup and no longer exist in `src/` —
  treat it as a style reference, not a current file map.
- `service-guide` skill — cross-cutting service conventions; mostly not applicable here
  since this is a CLI, not a service with routes/endpoints.

Key project-specific points worth restating:

- The Chinese→English vocabulary is split into four files: `zh_en_grade_mapping.json`
  (the 5 grade names), `zh_en_category_mapping.json` (main categories, split into
  `regional`/`individual` since the two factor-group tables have different fixed
  category sets), `zh_en_item_mapping.json` (sub-items — shared across categories and
  factor groups, since the same item can legitimately appear under different
  categories on real documents), and `zh_en_enum_value_mapping.json` (criteria enum
  values, prompt-only — never used to build schema keys). Each pipeline's `tool.ts`
  builds the tool schema's `enum` values (category/item/grade keys) directly from the
  grade/category/item files it's given; that pipeline's `pipeline.ts` also merges
  whichever of the four files it needs into one flat object for the prompt's
  vocabulary appendix (not every pipeline needs all four — `regionalAnalysis` has no
  criteria/enum-value cells, so it skips `zh_en_enum_value_mapping.json`). A document
  using a sub-item label outside
  `zh_en_item_mapping.json` cannot be extracted for that item — there's no raw-Chinese
  fallback anymore, since `item.key` is enum-restricted the same as `category.key` and
  `grade.key`.
- `output/` is gitignored and treated as disposable per-run debug output, not a build
  artifact to preserve.
- `temp/plans/*` is gitignored — historical planning docs stay local only. Check them
  for the "why" behind past architectural decisions (e.g. why Bedrock was dropped)
  before re-litigating.

## Commit messages

Use the `commit` skill/command (`.claude/commands/commit.md`) when asked to commit —
it defines this repo's exact subject/body format (lowercase, no scope, `Changes:` list).
