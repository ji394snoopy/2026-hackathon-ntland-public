// Local dev runner for fill-regional-analysis (表5 影響地價區域因素分析明細表 PDF).
// Pure pdf-lib, no AWS / DB. POST { purpose, ...content } -> filled PDF (base64), written to
// infra/tmp/fill-regional-analysis.pdf.
//
// Run:
//   cd infra
//   node --import ./scripts/register-ts.mjs lambda/fill-regional-analysis/invoke-local.ts
//   open tmp/fill-regional-analysis.pdf
//
// Endpoint: POST (JSON body = { purpose, ...content } or { purpose, content }).
//   purpose ∈ agricultural | commercial | industrial | other | residential  (必填,選對應範本)
//   content 是 fillEngine 的 content tree;只帶 { purpose } -> 該用地類別的空白範本。
// 改 purpose 就改下面 EXAMPLE.purpose;完整 content schema 見 input/coordinates-<purpose>.json。
//
// input/produce-regional-factors.json is produce-regional-factors's own output shape
// (flat { regionalFactors: RegionalFactorRow[], regionalTotal, caseCode, comparisonCases,
// regionalFactorRemarks }), not fillEngine's content-tree shape. lambda.ts's
// normalizeContent.ts reshapes it (via regionalRowsToAnalysisContent, the same mapper
// export-report/lambda.ts uses ahead of this lambda) before it reaches planDraws, so this
// runner just posts the sample as-is — no reshaping needed here.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { postEvent, runLocal } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";

const EXPORT_DIR = resolve(import.meta.dirname, "export");

const samplePath = fileURLToPath(new URL("./input/produce-regional-factors.json", import.meta.url));
const sample: Record<string, unknown> = JSON.parse(readFileSync(samplePath, "utf-8"));

const EXAMPLE = { purpose: "residential", content: sample };

const res = await runLocal(handler, postEvent(EXAMPLE), "fill-regional-analysis");

// On success, also drop the filled PDF in export/ for inspection/reuse.
if (res.statusCode === 200) {
  mkdirSync(EXPORT_DIR, { recursive: true });
  const outFile = resolve(EXPORT_DIR, `fill-regional-analysis-${Date.now()}.pdf`);
  writeFileSync(outFile, Buffer.from(res.body, "base64"));
  console.log(`[fill-regional-analysis] wrote PDF -> ${outFile}`);
}
