# districtSurvey

Fills in a Taiwanese (Traditional Chinese) 表1 地價區段勘查表 (district survey table) —
a single-page form with checkboxes, single-choice marks, and free-text blanks across
seven main-category blocks — by asking Claude for both the form's content and the
on-page pixel positions to draw it at, then stamping the result onto the source PDF
with `pdf-lib`.

Unlike the top-level pipelines (`factorStandard`, `regionalAnalysis`,
`individualAnalysis`), this is not one Claude call producing one JSON tree. It's a
per-category, three-phase workflow, and it **has no single combined-extraction
entrypoint the way `factorStandard/main.ts` does** — see "Known gaps" below.

## The eight categories

Each of these folders is a self-contained category block of the form, with the same
internal file shape:

- `landImprovement` — 土地改良 (multi-select checkbox groups)
- `specialFacilities` — 特殊設施
- `commercialActivity` — 商業活動
- `landUseRegulation` — 土地使用管制
- `trafficAndTransport` — 交通運輸 (mixes plain text/number/measurement leaves with
  repeated 名稱+distance "facility" items, e.g. 大型車站, 站牌)
- `publicInfrastructure` — 公共建設 (adds a fixed-label "existence check" shape for
  sub-items like 學校/市場/公園廣場徒步區, on top of the facility and leaf shapes)
- `environmentalPollution` — 環境污染
- `naturalConditions` — 自然條件 (7 plain leaf items sharing one narrow, undivided
  label+answer cell per row — no checkboxes or facility patterns. 3 of its 7 items
  — 保（排）水之良否/風勢/土質 — already have real public-data CLIs elsewhere in this
  repo, `src/drainageQuality/`/`src/windCondition/`/`src/soilQuality/`, but this
  category's own `sample/` step is pure Claude-synthetic content, same as every other
  category — those CLIs aren't wired into the fill flow)

Each category's tool schema (in `sample/sampleTool.ts`) is shaped around whatever that
category actually prints — plain leaf values, multi-select checkbox groups, or
名稱:X + 本區段內/外(距 N M) facility patterns — not a single shared shape.

## The three phases, per category

1. **Content** (`sample/`) — `sample/sampleTool.ts` defines that category's content
   schema; `sample/samplePrompt.ts` builds the prompt text. `sample/generateSample.ts`
   calls `invokeTextOnly()` (text-only, no PDF) with a synthetic-generation prompt and
   writes `output/result.json` + `output/extracted.json`. This is the only content path
   currently wired up — see "Known gaps".

2. **Coordinates** (`coordinateTool.ts` / `coordinatePrompt.ts` /
   `generateCoordinate.ts`) — a separate Bedrock call against the *real* PDF
   (`input/district-survey.pdf`). The prompt hands Claude a set of reference draw
   coordinates (hand-derived once from `pdftotext -bbox-layout`, converted from
   poppler's top-left origin to the PDF's bottom-left origin) and asks it to look at
   the actual page and confirm or correct each one, plus report whether it changed
   anything (`matchesReference`). Writes `output/coordinates-result.json` +
   `output/coordinates-extracted.json`.

3. **Fill** (`fillPdf.ts`) — pure local step, no API call. Reads that category's
   `output/result.json` (content) and `output/coordinates-extracted.json` (positions),
   zips them together positionally, and draws checkmarks/text onto
   `input/district-survey.pdf` with `pdf-lib` (+ `@pdf-lib/fontkit` for the embedded
   `assets/ARPLUKaiTW-Book.ttf` font, since the content is Chinese). Exports a
   `fill<Category>Content(page, font)` function for reuse and is also runnable
   standalone to produce that category's own filled PDF.

`main.ts` (this folder's root) calls all seven categories' `fill<Category>Content()`
functions against one shared page of `input/district-survey.pdf`, producing one PDF
with every category filled in.

## Usage

```bash
# per category (category = tt | pi | sf | ep | ca | lr | li | nc):
src/districtSurvey/run.sh generate <category>            # synthetic content -> <category>/output/{result,extracted}.json
src/districtSurvey/run.sh generateCoordinate <category>   # real-PDF coordinate calibration -> <category>/output/coordinates-*.json
src/districtSurvey/run.sh fill <category>                 # local fill using the two outputs above -> <category>/output/district-survey-filled.pdf

# e.g. landImprovement:
src/districtSurvey/run.sh generate li
src/districtSurvey/run.sh generateCoordinate li
src/districtSurvey/run.sh fill li

# all eight categories onto one page:
npm run fill:all
```

`run.sh generate`/`generateCoordinate` hit the real Bedrock API and consume real
credits; `run.sh fill`/`fill:all` are local-only and require `generate`'s and
`generateCoordinate`'s output to already exist in that category's `output/` dir.

Each category's `output/` (plus this folder's own `output/`) is gitignored, disposable
per-run debug output — same convention as the top-level `output/`.

## Known gaps

- **No real-PDF content extraction is wired up.** `sample/samplePrompt.ts` exports both
  `buildPrompt` (phrased for extracting from a real document) and
  `buildGenerationPrompt` (phrased for inventing a synthetic one), but only
  `buildGenerationPrompt` is ever called (`generate:X`, via `invokeTextOnly`, no PDF
  attached). `buildPrompt` is currently dead code — there's no `invoke()` call anywhere
  in this folder that pairs it with the real PDF the way `coordinatePrompt.ts` does for
  positions.
