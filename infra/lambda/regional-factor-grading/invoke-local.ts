// Local dev runner for regional-factor-grading (表5 區域因素評分, Bedrock 純文字).
// NEEDS AWS creds + Bedrock access to jp.anthropic.claude-sonnet-4-6.
//
// The handler takes { meta, survey, benchmark } (same shape as the CLI's sample-data.json);
// `survey` must be non-empty (區域因素評分 grades off the district survey). Those samples are
// input data, not a handler assets, so this runner reads them off disk — defaulting to the
// 4 district survey samples co-located with this lambda (input/sample-data-P001-00.json
// through input/sample-data-P004-00.json), invoking the handler once per section in
// sequence. Override with SAMPLE=<path> to grade a single file instead.
//
// Run:
//   cd infra
//   AWS_PROFILE=PROFILE AWS_REGION=us-east-1 \
//     node --import ./scripts/register-ts.mjs lambda/regional-factor-grading/invoke-local.ts
//
// 回:{ meta, benchmark, regionalFactors: {...}, totalScore }(同 CLI graded.json)，each section
// printed and, on success, written to export/regional-factor-grading-<sectionId>-<ts>.json.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { postEvent, runLocal } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";

const INPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "input");
const EXPORT_DIR = resolve(import.meta.dirname, "export");

// Default to the 4 district survey samples (區段編號 P001-00 .. P004-00). Set SAMPLE to grade
// just one file instead.
const SECTION_IDS = ["P001-00", "P002-00", "P003-00", "P004-00"];
const samplePaths = process.env.SAMPLE
  ? [process.env.SAMPLE]
  : SECTION_IDS.map((id) => join(INPUT_DIR, `sample-data-${id}.json`));

const batchTs = Date.now();

for (const samplePath of samplePaths) {
  const sample = JSON.parse(readFileSync(samplePath, "utf-8")) as { meta?: { sectionId?: string } };
  const sectionId = sample.meta?.sectionId ?? "unknown-section";
  console.log(`\n[regional-factor-grading] using sample: ${samplePath} (sectionId=${sectionId})`);

  const res = await runLocal(handler, postEvent(sample), `regional-factor-grading-${sectionId}`);

  // On success, also drop the graded result in export/ for inspection/reuse.
  if (res.statusCode === 200) {
    mkdirSync(EXPORT_DIR, { recursive: true });
    const outFile = resolve(EXPORT_DIR, `regional-factor-grading-${sectionId}-${batchTs}.json`);
    writeFileSync(outFile, JSON.stringify(JSON.parse(res.body), null, 2));
    console.log(`[regional-factor-grading] wrote result -> ${outFile}`);
  } else {
    console.error(`[regional-factor-grading] ${sectionId} failed with status ${res.statusCode}, skipping export`);
  }
}
