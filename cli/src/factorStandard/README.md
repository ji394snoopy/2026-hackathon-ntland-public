# factorStandard

Extracts a Taiwanese (Traditional Chinese) 地價區段調查估價 grading-*definition* table —
main category (主要項目) → sub-item (細項) → grade (優/稍優/普通/稍劣/劣) → price-correction
value + qualifying criteria — from a source PDF in a single Claude call. Unlike
`districtSurvey`, this is one Bedrock request producing one JSON tree; there's no
multi-phase content/coordinate/fill workflow.

The source document has two top-level tables, both extracted together:

- 區域因素評價基準明細表 (regional factors) — 土地使用管制, 交通運輸, 自然條件, 公共建設,
  特殊設施, 環境汙染, 工商活動
- 個別因素評價基準明細表 (individual factors) — 宗地條件, 道路條件, 接近條件, 周邊環境條件,
  行政條件

## Files

- `main.ts` — standalone CLI entrypoint. Reads the PDF path from argv, calls
  `buildPipeline()`, invokes Claude (`../shared/claude.ts`), and writes both outputs to
  `output/`.
- `pipeline.ts` — loads the `references/zh_en_grade_mapping.json`,
  `zh_en_category_mapping.json`, `zh_en_item_mapping.json`, and
  `zh_en_enum_value_mapping.json` vocabulary files, builds this pipeline's tool schema
  (`tool.ts`) and prompt text (`prompt.ts`) from them, and returns `{ tool, promptText }`.
- `tool.ts` — builds the `extract_land_valuation_table` tool's JSON schema
  (`strict: true`, `additionalProperties: false` throughout). `categories`, `items`, and
  `grades` are each arrays of `{key, ...}` entries rather than objects keyed by name, to
  keep the constrained-decoding grammar small. `category.key`/`item.key`/`grade.key` are
  each `enum`-restricted to their fixed vocabulary file — a label not present in the
  vocabulary can't be extracted. `criteria` is a nested object tagged `enum`/`range`/
  `boolean`, chosen per grade, describing how to read that grade's qualifying text.
- `prompt.ts` — builds the prompt text: table structure description, the value-reading
  rule (only the leftmost/優 column of each grid gives a grade's standalone value), the
  criteria-vs-remarks split, the enum/range/boolean criteria-type rules, a worked
  two-item example, and the Chinese→English vocabulary appendix.

## Usage

```bash
tsx src/factorStandard/main.ts references/factor-standard.pdf

# shortcut for the sample reference PDF:
npm run extract:fs
```

This hits the real Bedrock API and consumes real API credits. Each run writes to
`src/factorStandard/output/` (gitignored, disposable per-run debug output):

- `output/result.json` — the full raw Claude API response
- `output/extracted.json` — just the extracted tool input (the structured table)

## Output shape

Top-level `regionalFactors` (區域因素) and `individualFactors` (個別因素), each a tree of
categories → items → grades. Every grade carries its raw Chinese label (`raw`), its
numeric price-correction value (`value`), and a `criteria` object whose `type` field
(`enum`/`range`/`boolean`) says how to read its qualifying text. See `tool.ts` for the
full schema and `prompt.ts`'s `EXTRACTION_EXAMPLE` for a worked example.
