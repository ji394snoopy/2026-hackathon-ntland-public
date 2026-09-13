---
name: style-guide
description: This repo's TypeScript conventions — module/export shape, naming, function decomposition, comment style, magic-number constants, warn-and-skip error handling, and test structure — distilled from the existing src/ and test/ code. Use when writing or reviewing any .ts file in this repo (new module, new function, refactor), or when asked how code here "should" look/be structured/be named. Not about architecture or pipeline design, which lives in README.md and temp/plans/.
---

# Style Guide

Conventions actually in use across `src/` and `test/`, so new code reads as if the same
person wrote it. When in doubt, grep for a similar case in an existing file before
inventing a new pattern.

## Modules & exports

- ESM throughout (`"type": "module"`, `moduleResolution: "NodeNext"`). Relative imports
  use an explicit `.js` extension even though the source file is `.ts`:
  `import { parseCriteria } from "./parseCriteria.js"`.
- Type-only imports use `import type { ... }` (or `export type { ... }`), kept separate
  from value imports of the same module when both are needed
  (`schema.ts:1-4` imports `GradeLabel` as a value and `MainItem` as a type from the same
  file in two statements).
- Functions and re-exports are declared with their normal `function`/`const` keyword and
  gathered into **one `export { ... }` statement at the bottom of the file** — not
  `export function foo()` inline, not `export default`. Example: `writeOutput.ts:83`,
  `parseCriteria.ts:95`, `parseBlocks.ts:298`.
- `interface`/`type`/`enum` declarations are the exception — those export inline at their
  declaration (`schema.ts`, `constants.ts`) since there's no orchestration step to append
  a barrel export after.
- A module can re-export another module's symbols to widen its own public surface, e.g.
  `writeOutput.ts:11` re-exports `assembleFactorTable`/`detectTableType` so callers only
  need one import path.

## Types

- Fixed Chinese-label vocabularies (grade names, table types, units, presence markers,
  the 主要項目 taxonomy) are TypeScript `enum`s whose *values* are the literal Chinese
  strings — the enum doubles as the single source of truth for matching against raw PDF
  text and for producing output. See `constants.ts`.
- Variant data (`Criteria`) is a discriminated union of `interface`s tagged by a `type`
  string literal (`"range" | "enum" | "boolean"`), not a class hierarchy or an
  all-optional-fields object.
- Every criteria/grade shape keeps a `raw: string` field holding the untouched source
  text alongside its parsed value — never discard the original when deriving a typed
  value from it.

## Naming

- `camelCase` for functions and locals, `PascalCase` for `interface`/`type`/`enum` names
  and their members, `SCREAMING_SNAKE_CASE` for module-level constants
  (`GRADE_LABELS`, `MIN_BAND_GAP`, `KEY_MAPPING_PATH`).
- Regex constants end in `_RE` (`MARKER_RE`, `NUMBER_RE`, `CJK_RE`).
- A file's one orchestrating function is named after the file/pipeline stage
  (`parseBlocksFromLines` in `parseBlocks.ts`, `writeOutputDocument` in
  `writeOutput.ts`) and is the last thing defined before the export statement.

## Function decomposition

Break a pipeline stage into small, single-purpose helper functions, each returning a
plain object of its named outputs, then compose them in one top-level function that
reads like a list of steps. `parseBlocks.ts` is the clearest example:
`extractGradeRows` → `collectResidualFragments` → `classifyResidualColumns` →
`computeBlockBoundaries` → `buildBlocks`, composed in `parseBlocksFromLines`. Prefer this
over one long function with internal sections.

## Comments

Default to no comment — names should carry the "what." Write one only when it captures a
non-obvious **why**: a heuristic's justification, a tolerance value's origin, a
workaround for a specific input observed in a real PDF. Good examples already in the
codebase:

```ts
// A block's own name/header characters can start a hair above its 比准地 noise line
// (ordinary baseline jitter, not a real page-header boundary) — give the cutoff the
// same slack clusterLines uses for grouping a line's items...
const FIRST_CONTENT_Y_SLACK = 3;
```

```ts
// Real column boundaries (anchor↔item, item↔note) are tens of points apart; a few
// points is just glyph jitter... Without this floor, a page missing the 主要項目
// anchor column collapses to only 2 x's worth of gaps... (see the 使用分區﹝編定﹞
// regression test).
const MIN_BAND_GAP = 20;
```

Every magic number that encodes a tolerance, threshold, or heuristic gets pulled into a
named constant with a comment like this above it — not inlined bare into an `if`.

## Errors & control flow

- No `try/catch` scattered through the pipeline. Recoverable per-item problems (unknown
  table type, unmatched category, bad grade count, missing key-mapping entry) are handled
  by `console.warn(...)` + skip/fallback (`UNKNOWN` bucket, keep original Chinese key,
  `continue`) — the pipeline degrades a single item, it never throws for bad input data.
- The **only** catch site is `main()` in `index.ts`, which logs and `process.exit(1)`s.
  Everything below it is straight-line code that trusts its inputs once validated.
- Non-null assertions (`!`) are acceptable, and used freely, when the invariant was just
  established earlier in the same function (e.g. indexing `rows[idx]!` right after
  checking `idx` came from that same array) — not as a general suppressor of type errors.

## Output & side effects

- Written JSON is always pretty-printed: `JSON.stringify(doc, null, 2)`.
- Debug artifacts are written mid-pipeline to fixed paths from `DEBUG_OUTPUT_PATHS`
  (`constants.ts`) rather than ad hoc strings at each call site.
- Progress goes to `console.log`, problems go to `console.warn` — nothing writes to
  `console.error` except the final `main().catch`.

## Tests

- `node:test` + `node:assert/strict`, one file per source module under `test/`, named
  `<sourceFile>.test.ts`.
- Small typed builder helpers (`item(str, x, y)`, `mkLine(y, items)`) at the top of the
  test file construct fixtures instead of hand-writing object literals inline.
- When a helper intentionally bypasses another module to keep a test a true unit test,
  say so: `// Lines are hand-grouped here (rather than routed through clusterLines) so
  this stays an isolated unit test of parseBlocksFromLines's own logic...`.
- A fixture that mirrors a real PDF case gets a doc comment saying so (`/** A 2-level
  (優/劣) block, field-for-field identical to 都市計畫內外 in the real sample PDF. */`) so a
  future reader knows it's not an arbitrary example.

## Project-specific gotcha worth preserving in new code

The Chinese→English key translation (`references/zh_en_key_mapping.json`) is applied
**only** at the final `writeOutputDocument` stage, never earlier in the pipeline
(`extractTextItems`, `parseBlocks`, `assembleFactorTable` all work in raw Chinese).
Keep any new pipeline stage working in the original Chinese keys and defer translation
to the write step — translating early would make every intermediate stage (and its
tests/debug JSON) depend on the mapping table being complete and correct.
