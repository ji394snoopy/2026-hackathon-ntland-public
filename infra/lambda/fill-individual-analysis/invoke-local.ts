// Local dev runner for fill-individual-analysis (表4 比較法調查估價表 個別因素 PDF).
// Pure pdf-lib, no AWS / DB. POST a content tree -> filled PDF (base64), written to
// infra/lambda/fill-individual-analysis/export/.
//
// Run:
//   cd infra
//   node --import ./scripts/register-ts.mjs lambda/fill-individual-analysis/invoke-local.ts
//   open lambda/fill-individual-analysis/export/fill-individual-analysis-<ts>.pdf
//
// Endpoint: POST (JSON body = the content tree, same shape as the CLI comparison.json).
// Empty body -> blank template.
//
// input/produce-comparison.json is produce-comparison's own output shape
// ({ comparison, comparisonForm, computed } — see ../produce-comparison/mergeComparison.ts),
// not fillEngine's content-tree shape. lambda.ts's normalizeContent.ts reshapes it (via
// the same comparisonFormToContentTree mapper export-report/lambda.ts uses ahead of this
// lambda) before it reaches planDraws, so this runner just posts the sample as-is — no
// reshaping needed here.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { postEvent, runLocal } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";

const EXPORT_DIR = resolve(import.meta.dirname, "export");

const samplePath = fileURLToPath(new URL("./input/produce-comparison.json", import.meta.url));
const EXAMPLE_CONTENT: Record<string, unknown> = JSON.parse(readFileSync(samplePath, "utf-8"));

const res = await runLocal(handler, postEvent(EXAMPLE_CONTENT), "fill-individual-analysis");

// On success, also drop the filled PDF in export/ for inspection/reuse.
if (res.statusCode === 200) {
  mkdirSync(EXPORT_DIR, { recursive: true });
  const outFile = resolve(EXPORT_DIR, `fill-individual-analysis-${Date.now()}.pdf`);
  writeFileSync(outFile, Buffer.from(res.body, "base64"));
  console.log(`[fill-individual-analysis] wrote PDF -> ${outFile}`);
}
