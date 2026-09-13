// Local dev runner for factor-standard-extract (基準明細表 PDF -> 級距/修正率 JSON, Bedrock 帶 PDF).
// NEEDS AWS creds + Bedrock access to jp.anthropic.claude-sonnet-4-6.
//
// The handler takes the 評價基準明細表 PDF as base64 (raw body, or { pdfBase64 }). This runner
// reads one off disk — defaulting to input/factor-standard.pdf. Override with FS_PDF=<path>.
//
// Run:
//   cd infra
//   AWS_PROFILE=PROFILE AWS_REGION=us-east-1 \
//     node --import ./scripts/register-ts.mjs lambda/factor-standard-extract/invoke-local.ts
//   # or a specific PDF:
//   FS_PDF=/path/to/基準明細表.pdf AWS_PROFILE=... AWS_REGION=... node ... invoke-local.ts
//
// 回:抽出的結構化級距/修正率 JSON(200),模型/上游失敗 502,壞 body 400。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { postEvent, runLocal } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";

// Default to the local input PDF. Set FS_PDF to use another.
const DEFAULT_PDF = resolve(import.meta.dirname, "input", "factor-standard.pdf");
const pdfPath = process.env.FS_PDF ?? DEFAULT_PDF;
const EXPORT_DIR = resolve(import.meta.dirname, "export");

const pdfBase64 = readFileSync(pdfPath).toString("base64");
console.log(`[factor-standard-extract] using PDF: ${pdfPath} (${pdfBase64.length} b64 chars)`);

// Handler accepts the raw base64 string as the whole body, or { pdfBase64 }. Use the raw form.
const res = await runLocal(handler, postEvent(pdfBase64), "factor-standard-extract");

// On success, also drop the extracted JSON in export/ for inspection/reuse.
if (res.statusCode === 200) {
  mkdirSync(EXPORT_DIR, { recursive: true });
  const outFile = resolve(EXPORT_DIR, `factor-standard-extract-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(JSON.parse(res.body), null, 2));
  console.log(`[factor-standard-extract] wrote result -> ${outFile}`);
}
